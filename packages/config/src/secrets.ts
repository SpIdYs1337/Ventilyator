import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

async function key(root: string, create: boolean): Promise<Buffer> {
  if (await realpath(root) !== root) throw new Error('Non-canonical storage root');
  const dir = join(root, '.keys');
  await mkdir(dir, { mode: 0o700, recursive: true });
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Key directory must not be a symlink');
  const path = join(dir, 'mail.key');
  if (create) try {
    const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(randomBytes(32)); await file.sync(); } finally { await file.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  for (let attempt = 0; attempt < 10; attempt++) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const value = await file.readFile(); if (value.length === 32) return value; if (value.length !== 0 || !create) throw new Error('Invalid mail key'); } finally { await file.close(); }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Mail key initialization did not finish');
}
export async function encryptSecret(root: string, organizationId: string, value: string): Promise<string> {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', await key(root, true), iv);
  cipher.setAAD(Buffer.from(organizationId));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString('base64url')).join('.');
}
export async function decryptSecret(root: string, organizationId: string, value: string): Promise<string> {
  const parts = value.split('.').map(s => Buffer.from(s, 'base64url'));
  if (parts.length !== 3) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', await key(root, false), parts[0]!);
  decipher.setAAD(Buffer.from(organizationId)); decipher.setAuthTag(parts[1]!);
  return Buffer.concat([decipher.update(parts[2]!), decipher.final()]).toString('utf8');
}
export async function mailCa(): Promise<Buffer | undefined> {
  return process.env.MAIL_CA_FILE ? readFile(process.env.MAIL_CA_FILE) : undefined;
}
