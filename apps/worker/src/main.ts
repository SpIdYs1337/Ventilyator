import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { createDatabase } from '@ventilyator/database';
import { readConfig } from '@ventilyator/config';

async function main() {
  const config = readConfig();
  const db = createDatabase(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
  redis.on('error', () => console.error('Ventilyator worker: Redis unavailable'));
  await db.$connect();
  const worker = new Worker('ventilyator-system', async job => {
    if (job.name !== 'health-probe') throw new Error('Unsupported job type');
    await db.$queryRaw`SELECT 1`;
    return { application: 'Ventilyator', processed: true };
  }, { connection: { url: config.REDIS_URL }, concurrency: 2 });
  worker.on('error', () => console.error('Ventilyator worker queue error'));
  worker.on('failed', () => console.error('Ventilyator worker job failed'));
  await worker.waitUntilReady();
  const heartbeat = async () => {
    try { await db.$queryRaw`SELECT 1`; await redis.set('ventilyator:worker:heartbeat', new Date().toISOString(), 'EX', 20); }
    catch { console.error('Ventilyator worker heartbeat failed'); }
  };
  await heartbeat();
  const timer = setInterval(() => { void heartbeat(); }, 5000);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await worker.close();
    await redis.del('ventilyator:worker:heartbeat');
    await redis.quit();
    await db.$disconnect();
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
  console.log('Ventilyator worker ready');
}
main().catch(() => { console.error('Ventilyator worker initialization failed'); process.exitCode = 1; });
