#!/usr/bin/env python3
"""Verify the production Caddy configuration with a temporary internal CA."""
import http.client
from pathlib import Path
import ssl
import subprocess
import time

root = Path(__file__).resolve().parents[2]
name = 'ventilyator-tls-check'
args = ['docker', 'run', '-d', '--name', name, '--network', 'ventilyator_frontend', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only', '--tmpfs', '/tmp', '-p', '127.0.0.1:8443:8443']
for value in ['APP_HOST=localhost', 'TLS_CERT=internal', 'TLS_KEY=', 'XDG_DATA_HOME=/tmp/caddy-data', 'NO_PROXY=localhost,127.0.0.1,ventilyator-api,ventilyator-web', 'no_proxy=localhost,127.0.0.1,ventilyator-api,ventilyator-web']:
    args += ['-e', value]
args += ['-v', str(root / 'infrastructure/caddy/Caddyfile') + ':/etc/caddy/Caddyfile:ro', 'ventilyator-proxy:0.1.0']
subprocess.run(args, check=True, capture_output=True)
try:
    ca = root / '.local/tls-ca.crt'
    for _ in range(20):
        cert = subprocess.run(['docker', 'exec', name, 'cat', '/tmp/caddy-data/caddy/pki/authorities/local/root.crt'], capture_output=True)
        if cert.returncode == 0:
            ca.write_bytes(cert.stdout)
            break
        time.sleep(1)
    else:
        raise RuntimeError('Caddy CA unavailable: ' + cert.stderr.decode()[:160])
    try:
        c = http.client.HTTPSConnection('localhost', 8443, context=ssl.create_default_context(), timeout=5)
        c.request('GET', '/api/health/live')
        c.getresponse()
    except ssl.SSLCertVerificationError:
        print('PASS untrusted CA is rejected')
    else:
        raise AssertionError('Untrusted CA was accepted')
    context = ssl.create_default_context(cafile=str(ca))
    c = http.client.HTTPSConnection('localhost', 8443, context=context, timeout=10)
    c.request('GET', '/api/health/ready')
    r = c.getresponse()
    data = r.read()
    assert r.status == 200, (r.status, data)
    print('PASS HTTPS readiness through Caddy with trusted CA and hostname verification')
finally:
    subprocess.run(['docker', 'rm', '-f', name], check=True, capture_output=True)
