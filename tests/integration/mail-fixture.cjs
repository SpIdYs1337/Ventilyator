const { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const tls = require('node:tls');
const net = require('node:net');

async function mailFixture({ smtpUser, smtpPassword, imapPassword }) {
  const directory = mkdtempSync('/tmp/ventilyator-mail-test-');
  const run = args => execFileSync('openssl', args, { cwd: directory, stdio: 'ignore', timeout: 20000 });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '1', '-subj', '/CN=Ventilyator isolated test CA']);
  run(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=ventilyator-api']);
  writeFileSync(join(directory, 'extensions'), 'subjectAltName=DNS:ventilyator-api,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'extensions']);
  const options = { key: readFileSync(join(directory, 'server.key')), cert: readFileSync(join(directory, 'server.pem')) };
  const caPath = process.env.MAIL_CA_FILE;
  if (!caPath || !caPath.endsWith('/platform-test-ca.pem')) throw new Error('Test CA path must be configured explicitly');
  mkdirSync(join(process.env.STORAGE_ROOT, '.keys'), { recursive: true, mode: 0o700 });
  copyFileSync(join(directory, 'ca.pem'), caPath);
  const messages = []; let authentications = 0;
  const sockets = new Set();
  function track(socket) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.setTimeout(20000, () => socket.destroy()); }
  function smtp(socket, encrypted, greeting = true) {
    track(socket); let buffer = '', data = false, authenticated = false, recipient = '';
    if (greeting) socket.write('220 fixture ESMTP\r\n');
    const receive = chunk => {
      buffer += chunk.toString(); if (buffer.length > 200000) return socket.destroy();
      if (data) { const end = buffer.indexOf('\r\n.\r\n'); if (end < 0) return; messages.push({ recipient, body: buffer.slice(0, end) }); buffer = buffer.slice(end + 5); data = false; socket.write('250 queued locally\r\n'); }
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (/^EHLO|^HELO/i.test(line)) socket.write(encrypted ? '250-fixture\r\n250 AUTH PLAIN\r\n' : '250-fixture\r\n250 STARTTLS\r\n');
        else if (/^STARTTLS/i.test(line) && !encrypted) { socket.write('220 Ready for TLS\r\n'); socket.removeListener('data', receive); const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(options) }); smtp(secure, true, false); return; }
        else if (/^AUTH PLAIN /i.test(line)) { const values = Buffer.from(line.split(' ').slice(2).join(''), 'base64').toString().split('\0'); authenticated = encrypted && values.at(-2) === smtpUser && values.at(-1) === smtpPassword; if (authenticated) authentications++; socket.write(authenticated ? '235 Authenticated\r\n' : '535 Invalid credentials\r\n'); }
        else if (/^MAIL FROM/i.test(line)) socket.write(authenticated ? '250 OK\r\n' : '530 Authentication required\r\n');
        else if (/^RCPT TO/i.test(line)) { recipient = line; socket.write(authenticated ? '250 OK\r\n' : '530 Authentication required\r\n'); }
        else if (/^DATA$/i.test(line)) { if (authenticated) { data = true; socket.write('354 End with dot\r\n'); } else socket.write('530 Authentication required\r\n'); }
        else if (/^QUIT/i.test(line)) socket.end('221 Goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    };
    socket.on('data', receive);
  }
  const implicit = tls.createServer(options, socket => smtp(socket, true));
  const starttls = net.createServer(socket => smtp(socket, false));
  const imap = tls.createServer(options, socket => {
    track(socket); socket.write('* OK IMAP4rev1 fixture\r\n'); let buffer = '', pending;
    function authenticate(tag, encoded) { const values = Buffer.from(encoded, 'base64').toString().split('\0'); socket.write(`${tag} ${values.at(-1) === imapPassword ? 'OK Authenticated' : 'NO [AUTHENTICATIONFAILED] Invalid credentials'}\r\n`); }
    socket.on('data', chunk => {
      buffer += chunk.toString(); if (buffer.length > 10000) return socket.destroy(); let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (pending) { authenticate(pending, line); pending = undefined; continue; }
        const [tag, command, ...args] = line.split(' ');
        if (command?.toUpperCase() === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n${tag} OK Capabilities\r\n`);
        else if (command?.toUpperCase() === 'AUTHENTICATE') { if (args[1]) authenticate(tag, args[1]); else { pending = tag; socket.write('+ \r\n'); } }
        else if (command?.toUpperCase() === 'LOGIN') { const password = args.at(-1)?.replace(/^"|"$/g, ''); socket.write(`${tag} ${password === imapPassword ? 'OK Authenticated' : 'NO [AUTHENTICATIONFAILED] Invalid credentials'}\r\n`); }
        else if (command?.toUpperCase() === 'LOGOUT') socket.end(`* BYE\r\n${tag} OK Logout\r\n`);
        else if (command?.toUpperCase() === 'LIST') socket.write(`* LIST (\\Noselect) "/" ""\r\n${tag} OK List\r\n`);
        else socket.write(`${tag} OK Complete\r\n`);
      }
    });
  });
  for (const server of [implicit, starttls, imap]) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
  return { smtpPort: implicit.address().port, starttlsPort: starttls.address().port, imapPort: imap.address().port, messages, authentications: () => authentications, close: async () => { for (const socket of sockets) socket.destroy(); await Promise.all([implicit, starttls, imap].map(server => new Promise(resolve => server.close(resolve)))); rmSync(directory, { recursive: true, force: true }); rmSync(caPath, { force: true }); } };
}
module.exports = { mailFixture };
