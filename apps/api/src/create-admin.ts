import { createDatabase } from '@ventilyator/database';
import { defaultRoles, permissionKeys } from '@ventilyator/shared';
import { emailSchema } from '@ventilyator/validation';
import { readFile } from 'node:fs/promises';
import * as argon2 from 'argon2';

async function main() {
  const url = process.env.DATABASE_URL;
  const passwordFile = process.env.ADMIN_PASSWORD_FILE;
  const email = emailSchema.parse(process.env.ADMIN_EMAIL);
  const name = process.env.ADMIN_NAME ?? 'Администратор';
  if (!url || !passwordFile) throw new Error('Set DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD_FILE (private file, not a command-line password)');
  const password = (await readFile(passwordFile, 'utf8')).replace(/\r?\n$/, '');
  if (password.length < 14 || password.length > 256) throw new Error('Password must be 14–256 characters');
  const db = createDatabase(url);
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(736182019)`;
      if (await tx.user.count()) throw new Error('Bootstrap is only allowed before the first user exists');
      const org = await tx.organization.create({ data: { name: process.env.ORGANIZATION_NAME ?? 'Моя организация' } });
      for (const key of permissionKeys) await tx.permission.upsert({ where: { key }, create: { key }, update: {} });
      const roles = [];
      for (const [roleName, permissions] of Object.entries(defaultRoles)) {
        roles.push(await tx.role.create({ data: { name: roleName, organizationId: org.id, permissions: { create: permissions.map(permission => ({ permission })) } } }));
      }
      await tx.user.create({ data: { name, email, passwordHash, organizationId: org.id, roles: { create: { roleId: roles[0]!.id } } } });
      await tx.auditEvent.create({ data: { organizationId: org.id, action: 'system.bootstrap' } });
    });
    console.log('Ventilyator: администратор создан. Повторная инициализация заблокирована.');
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Bootstrap failed'); process.exitCode = 1; });
