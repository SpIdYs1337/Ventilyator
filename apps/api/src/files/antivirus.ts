import { connect } from 'node:net';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
export async function scanFile(path: string): Promise<void> {
  if (process.env.ANTIVIRUS_REQUIRED !== 'true') return;
  if (!process.env.CLAMAV_HOST) throw new Error('Antivirus is required but not configured');
  const socket = connect({ host: process.env.CLAMAV_HOST, port: Number(process.env.CLAMAV_PORT ?? 3310) });
  socket.setTimeout(20000, () => socket.destroy(new Error('Scanner timeout')));
  const result = new Promise<string>((resolve, reject) => {
    let response = '';
    socket.on('data', chunk => { response += chunk.toString(); if (response.includes('\0') || response.includes('\n')) resolve(response); if (response.length > 4096) reject(new Error('Invalid scanner response')); });
    socket.on('error', reject); socket.on('end', () => resolve(response));
  });
  // Attach a rejection handler before writing; a scanner outage must fail closed.
  void result.catch(() => {});
  try {
    await once(socket, 'connect');
    socket.write(Buffer.from('zINSTREAM\0'));
    for await (const chunk of createReadStream(path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const size = Buffer.alloc(4); size.writeUInt32BE(buffer.length);
      socket.write(size); if (!socket.write(buffer)) await once(socket, 'drain');
    }
    socket.write(Buffer.alloc(4));
    if (!/^stream: OK(?:\0|\r?\n)?$/.test(await result)) throw new Error('File rejected by scanner');
  } finally { socket.destroy(); }
}
