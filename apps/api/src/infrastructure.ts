import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDatabase } from '@ventilyator/database';
import { readConfig } from '@ventilyator/config';
import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { mkdir, open, unlink, lstat, realpath, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

@Injectable()
export class Infrastructure implements OnModuleDestroy {
  readonly config = readConfig();
  readonly db = createDatabase(this.config.DATABASE_URL);
  readonly redis = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: false });
  readonly queue = new Queue('ventilyator-system', { connection: { url: this.config.REDIS_URL }, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100, attempts: 3, backoff: { type: 'exponential', delay: 1000 } } });

  constructor() {
    this.redis.on('error', () => { /* Readiness reports service availability without logging connection strings. */ });
    this.queue.on('error', () => console.error('Ventilyator system queue unavailable'));
  }

  async initializeStorage() {
    const root = this.config.STORAGE_ROOT;
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error('Storage root must be a canonical absolute path without symlinks');
    for (const dir of ['objects', 'temporary', 'quarantine', 'previews', 'thumbnails']) {
      const path = join(root, dir);
      await mkdir(path, { recursive: true, mode: 0o700 });
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Storage directory cannot be a symlink');
    }
  }

  async storageReady() {
    const path = join(this.config.STORAGE_ROOT, 'temporary', `.health-${randomUUID()}`);
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile('Ventilyator'); await file.sync(); } finally { await file.close(); await unlink(path); }
    return (await statfs(this.config.STORAGE_ROOT)).bavail > 0;
  }

  async status() {
    const results = await Promise.allSettled([
      this.db.$queryRaw`SELECT 1`, this.redis.ping(), this.storageReady(), this.redis.get('ventilyator:worker:heartbeat'),
    ]);
    const ok = (i: number) => results[i]?.status === 'fulfilled';
    return { postgres: ok(0), redis: ok(1), storage: ok(2), worker: results[3]?.status === 'fulfilled' && results[3].value !== null };
  }

  async onModuleDestroy() { await this.queue.close(); this.redis.disconnect(); await this.db.$disconnect(); }
}
