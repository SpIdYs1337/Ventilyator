import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { Prisma } from '@ventilyator/database';
import type { CurrentUser } from '@ventilyator/shared';
import { Infrastructure } from '../infrastructure';
import { ProjectsService } from '../work/projects.service';
import { TasksService } from '../work/tasks.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { scanFile } from './antivirus';

type Context = { taskId: string | null; pageId: string | null };
function sniff(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(data.toString('ascii', 0, 6))) return 'image/gif';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (data[0] === 80 && data[1] === 75 && data[2] === 3 && data[3] === 4) return 'application/zip';
  return 'application/octet-stream';
}
@Injectable()
export class FilesService {
  constructor(@Inject(Infrastructure) private readonly infra: Infrastructure, @Inject(ProjectsService) private readonly projects: ProjectsService, @Inject(TasksService) private readonly tasks: TasksService, @Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}
  private async context(user: CurrentUser, context: Context, write: boolean, tx: Prisma.TransactionClient = this.infra.db) {
    if (context.taskId) {
      const task = await tx.task.findFirst({ where: { id: context.taskId, organizationId: user.organizationId } });
      if (!task) throw new NotFoundException();
      const project = await this.projects.load(user, task.projectId, tx);
      await this.tasks.load(user, project.id, task.id, tx);
      if (write && (project.myRole === 'VIEWER' || project.archived)) throw new ForbiddenException();
      return project.id;
    }
    if (context.pageId) {
      const page = await tx.knowledgePage.findFirst({ where: { id: context.pageId, organizationId: user.organizationId } });
      if (!page) throw new NotFoundException();
      const space = await this.knowledge.space(user, page.spaceId, tx);
      await this.knowledge.page(user, space.id, page.id, tx);
      if (write && (space.myRole === 'VIEWER' || space.archived || page.archived)) throw new ForbiddenException();
      return space.id;
    }
    throw new NotFoundException();
  }
  private serialize<T extends { versions: { size: bigint }[] }>(object: T) { return { ...object, versions: object.versions.map(v => ({ ...v, size: Number(v.size) })) }; }
  async list(user: CurrentUser, context: Context, trash = false) {
    await this.context(user, context, false);
    const objects = await this.infra.db.storageObject.findMany({ where: { organizationId: user.organizationId, state: trash ? 'DELETED' : 'READY', attachment: context }, include: { versions: { orderBy: { number: 'desc' } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return objects.map(o => this.serialize(o));
  }
  async ticket(user: CurrentUser, context: Context, data: { name: string; size: number; objectId?: string }) {
    const contextId = await this.context(user, context, true);
    return this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contextId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${user.organizationId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('storage:physical'))`;
      await this.context(user, context, true, tx);
      const quota = await tx.storageQuota.findUnique({ where: { organizationId: user.organizationId } });
      const used = await tx.storageObjectVersion.aggregate({ where: { object: { organizationId: user.organizationId } }, _sum: { size: true } });
      const reserved = await this.reserved(tx, user.organizationId);
      if (Number(used._sum.size ?? 0) + reserved + data.size > Number(quota?.bytes ?? 10737418240n)) throw new ConflictException('Недостаточно квоты организации');
      const disk = await statfs(this.infra.config.STORAGE_ROOT);
      if (disk.bavail * disk.bsize < data.size + await this.reserved(tx) + 104857600) throw new ServiceUnavailableException('Недостаточно свободного места с учётом текущих загрузок');
      let object;
      if (data.objectId) {
        object = await tx.storageObject.findFirst({ where: { id: data.objectId, organizationId: user.organizationId, state: 'READY', attachment: context } });
        if (!object) throw new NotFoundException();
      } else {
        object = await tx.storageObject.create({ data: { organizationId: user.organizationId, name: data.name } });
        await tx.storageAttachment.create({ data: { objectId: object.id, organizationId: user.organizationId, ...context } });
      }
      const last = await tx.storageUpload.aggregate({ where: { objectId: object.id }, _max: { number: true } });
      if ((last._max.number ?? 0) >= 1000) throw new BadRequestException('Достигнут лимит версий файла');
      const upload = await tx.storageUpload.create({ data: { objectId: object.id, organizationId: user.organizationId, userId: user.id, expectedSize: data.size, number: (last._max.number ?? 0) + 1, expiresAt: new Date(Date.now() + 900000) } });
      return { id: upload.id, objectId: object.id, number: upload.number, expiresAt: upload.expiresAt };
    });
  }
  private async directory(id: string) {
    let current = join(this.infra.config.STORAGE_ROOT, 'objects');
    for (const segment of [id.slice(0, 2), id.slice(2, 4), id]) {
      current = join(current, segment); await mkdir(current, { recursive: true, mode: 0o700 });
      if ((await lstat(current)).isSymbolicLink() || await realpath(current) !== current) throw new Error('Unsafe object directory');
    }
    return current;
  }
  async upload(user: CurrentUser, id: string, req: Request) {
    const upload = await this.infra.db.storageUpload.findFirst({ where: { id, userId: user.id, organizationId: user.organizationId, status: 'PENDING', expiresAt: { gt: new Date() } }, include: { object: { include: { attachment: true } } } });
    if (!upload?.object.attachment) throw new NotFoundException();
    const context = upload.object.attachment;
    const contextId = await this.context(user, context, true);
    const claim = await this.infra.db.storageUpload.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'UPLOADING' } });
    if (!claim.count) throw new ConflictException('Загрузка уже начата');
    const temporary = join(this.infra.config.STORAGE_ROOT, 'temporary', `${id}.upload`);
    let final: string | undefined;
    const deadline = setTimeout(() => req.destroy(new Error('Upload timeout')), 120000);
    try {
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      const hash = createHash('sha256'); let size = 0; const head: Buffer[] = []; let headSize = 0;
      const meter = new Transform({ transform(chunk: Buffer, _, callback) { size += chunk.length; if (size > upload.expectedSize || size > 26214400) return callback(new Error('Upload exceeds declared size')); hash.update(chunk); if (headSize < 4096) { const part = chunk.subarray(0, 4096 - headSize); head.push(part); headSize += part.length; } callback(null, chunk); } });
      const sink = new Writable({ write(chunk: Buffer, _, callback) { file.writeFile(chunk).then(() => callback(), callback); } });
      try { await pipeline(req, meter, sink); await file.sync(); } finally { await file.close(); }
      if (size !== upload.expectedSize) throw new BadRequestException('Размер файла не совпал с заявленным');
      await scanFile(temporary);
      const directory = await this.directory(upload.objectId);
      final = join(directory, `v${String(upload.number).padStart(4, '0')}.bin`);
      await rename(temporary, final);
      await this.infra.db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contextId}))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`upload:${id}`}))`;
        await this.context(user, context, true, tx);
        if (!await tx.storageUpload.findFirst({ where: { id, status: 'UPLOADING', expiresAt: { gt: new Date() }, object: { state: { not: 'DELETED' } } } })) throw new ConflictException('Загрузка истекла или файл перемещён в корзину');
        await tx.storageObjectVersion.create({ data: { objectId: upload.objectId, number: upload.number, size, sha256: hash.digest('hex'), mimeType: sniff(Buffer.concat(head)) } });
        await tx.storageObject.update({ where: { id: upload.objectId }, data: { state: 'READY', deletedAt: null } });
        await tx.storageUpload.update({ where: { id }, data: { status: 'COMPLETE' } });
        await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `file.uploaded:${upload.objectId}:${upload.number}` } });
      });
      return { ok: true, objectId: upload.objectId };
    } catch (error) {
      await unlink(temporary).catch(() => {});
      if (final) await unlink(final).catch(() => {});
      await this.infra.db.storageUpload.updateMany({ where: { id }, data: { status: 'FAILED' } });
      if (error instanceof ForbiddenException || error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('Загрузка не завершена. Проверьте размер, диск и антивирус.');
    } finally {
      clearTimeout(deadline);
    }
  }
  async download(user: CurrentUser, id: string, version: number | undefined, inline: boolean, res: Response) {
    const object = await this.infra.db.storageObject.findFirst({ where: { id, organizationId: user.organizationId, state: 'READY' }, include: { attachment: true, versions: { ...(version ? { where: { number: version } } : {}), orderBy: { number: 'desc' }, take: 1 } } });
    if (!object?.attachment || !object.versions[0]) throw new NotFoundException();
    await this.context(user, object.attachment, false);
    const v = object.versions[0]; const directory = await this.directory(id);
    const path = join(directory, `v${String(v.number).padStart(4, '0')}.bin`);
    let file;
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); if ((await file.stat()).size !== Number(v.size)) throw new Error('Size mismatch'); }
    catch { if (file) await file.close(); throw new ServiceUnavailableException('Файл недоступен или нарушена целостность'); }
    const safeInline = inline && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(v.mimeType);
    res.setHeader('Content-Type', v.mimeType); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${safeInline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(object.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`);
    res.setHeader('Content-Length', Number(v.size)); res.setHeader('X-Content-SHA256', v.sha256);
    try { await pipeline(file.createReadStream(), res); } catch { res.destroy(); }
  }
  async update(user: CurrentUser, id: string, data: { name?: string; deleted?: boolean }) {
    const object = await this.infra.db.storageObject.findFirst({ where: { id, organizationId: user.organizationId }, include: { attachment: true } });
    if (!object?.attachment || !['READY', 'DELETED'].includes(object.state)) throw new NotFoundException();
    const contextId = await this.context(user, object.attachment, true);
    await this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${contextId}))`;
      await this.context(user, object.attachment!, true, tx);
      await tx.storageObject.update({ where: { id }, data: { ...(data.name ? { name: data.name } : {}), ...(data.deleted !== undefined ? { state: data.deleted ? 'DELETED' : 'READY', deletedAt: data.deleted ? new Date() : null } : {}) } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `file.updated:${id}` } });
    });
    return { ok: true };
  }
  async status(user: CurrentUser) {
    const [used, objects, versions, trash, pending, quota, disk] = await Promise.all([
      this.infra.db.storageObjectVersion.aggregate({ where: { object: { organizationId: user.organizationId } }, _sum: { size: true } }),
      this.infra.db.storageObject.count({ where: { organizationId: user.organizationId, state: 'READY' } }),
      this.infra.db.storageObjectVersion.count({ where: { object: { organizationId: user.organizationId } } }),
      this.infra.db.storageObject.count({ where: { organizationId: user.organizationId, state: 'DELETED' } }),
      this.infra.db.storageUpload.count({ where: { organizationId: user.organizationId, status: { in: ['PENDING', 'UPLOADING', 'FAILED'] } } }),
      this.infra.db.storageQuota.findUnique({ where: { organizationId: user.organizationId } }), statfs(this.infra.config.STORAGE_ROOT),
    ]);
    return { usedBytes: Number(used._sum.size ?? 0), objects, versions, trash, pending, quotaBytes: Number(quota?.bytes ?? 10737418240n), diskFreeBytes: disk.bavail * disk.bsize, antivirusRequired: process.env.ANTIVIRUS_REQUIRED === 'true' };
  }
  async quota(user: CurrentUser, bytes: number) {
    return this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quota:${user.organizationId}`}))`;
      const used = await tx.storageObjectVersion.aggregate({ where: { object: { organizationId: user.organizationId } }, _sum: { size: true } });
      const pending = await this.reserved(tx, user.organizationId);
      if (bytes < Number(used._sum.size ?? 0) + pending) throw new ConflictException('Квота меньше занятого и зарезервированного объёма');
      await tx.storageQuota.upsert({ where: { organizationId: user.organizationId }, create: { organizationId: user.organizationId, bytes }, update: { bytes } });
      await tx.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `storage.quota_updated:${bytes}` } });
      return { ok: true };
    });
  }
  async reconcile(user: CurrentUser) {
    const stale = await this.infra.db.storageUpload.findMany({ where: { organizationId: user.organizationId, status: { in: ['PENDING', 'UPLOADING', 'FAILED'] }, expiresAt: { lt: new Date() } }, take: 100 });
    let cleaned = 0;
    for (const upload of stale) await this.infra.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`upload:${upload.id}`}))`;
      const current = await tx.storageUpload.findFirst({ where: { id: upload.id, expiresAt: { lt: new Date() }, status: { in: ['PENDING', 'UPLOADING', 'FAILED'] } } });
      if (!current) return;
      const ready = await tx.storageObjectVersion.findUnique({ where: { objectId_number: { objectId: upload.objectId, number: upload.number } } });
      if (!ready) {
        await unlink(join(this.infra.config.STORAGE_ROOT, 'temporary', `${upload.id}.upload`)).catch(() => {});
        const directory = await this.directory(upload.objectId);
        await unlink(join(directory, `v${String(upload.number).padStart(4, '0')}.bin`)).catch(() => {});
      }
      await tx.storageUpload.update({ where: { id: upload.id }, data: { status: ready ? 'COMPLETE' : 'CLEANED' } });
      cleaned++;
    });
    await this.infra.db.auditEvent.create({ data: { organizationId: user.organizationId, userId: user.id, action: `storage.reconciled:${cleaned}` } });
    return { cleaned };
  }
  private async reserved(tx: Prisma.TransactionClient, organizationId?: string): Promise<number> {
    const rows = organizationId
      ? await tx.$queryRaw<{ bytes: bigint }[]>`SELECT COALESCE(SUM("expectedSize"),0)::bigint AS bytes FROM "StorageUpload" WHERE "organizationId"=${organizationId}::uuid AND (status='UPLOADING' OR (status='PENDING' AND "expiresAt">CURRENT_TIMESTAMP))`
      : await tx.$queryRaw<{ bytes: bigint }[]>`SELECT COALESCE(SUM("expectedSize"),0)::bigint AS bytes FROM "StorageUpload" WHERE status='UPLOADING' OR (status='PENDING' AND "expiresAt">CURRENT_TIMESTAMP)`;
    return Number(rows[0]?.bytes ?? 0);
  }
}
