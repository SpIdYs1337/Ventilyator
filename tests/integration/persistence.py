#!/usr/bin/env python3
"""Development-only persistence and readiness checks against the local Docker stack."""
import http.client
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[2]
if os.environ.get('VENTILYATOR_TEST_ENV') != 'development':
    raise SystemExit('Set VENTILYATOR_TEST_ENV=development; do not run against production')
compose = ['docker', 'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml']
password = Path(os.environ['ADMIN_PASSWORD_FILE']).read_text().strip()
email = os.environ['ADMIN_EMAIL']
cookie = ''

def cmd(*args, capture=False):
    return subprocess.run([*compose, *args], cwd=root, check=True, capture_output=capture, text=True)

def request(path, body=None):
    c = http.client.HTTPConnection('127.0.0.1', 8080, timeout=8)
    headers = {'Host': 'localhost:8080', 'Origin': 'http://localhost:8080', 'X-Ventilyator-Request': '1', 'Content-Type': 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    c.request('POST' if body is not None else 'GET', '/api' + path, json.dumps(body) if body is not None else None, headers)
    r = c.getresponse()
    status, data, cookies = r.status, r.read(), r.getheader('Set-Cookie')
    c.close()
    return status, data, cookies

def ready():
    for _ in range(45):
        try:
            if request('/health/ready')[0] == 200:
                return
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(1)
    raise RuntimeError('Readiness did not recover')

marker = '.persistence-' + uuid.uuid4().hex
path = '/app/storage/objects/' + marker
try:
    status, _, header = request('/auth/login', {'email': email, 'password': password})
    assert status == 201 and header
    cookie = header.split(';', 1)[0]
    assert request('/auth/me')[0] == 200
    cmd('exec', '-T', 'ventilyator-api', 'node', '-e', f"require('fs').writeFileSync({json.dumps(path)},'Ventilyator persistence',{{flag:'wx',mode:384}})", capture=True)
    # Recreate all application and data-service containers, retaining bind mounts.
    cmd('up', '-d', '--force-recreate', '--no-build', '--wait', '--wait-timeout', '120')
    ready()
    assert request('/auth/me')[0] == 200, 'PostgreSQL user or Redis session did not survive recreation'
    cmd('exec', '-T', 'ventilyator-api', 'node', '-e', f"if(require('fs').readFileSync({json.dumps(path)},'utf8')!=='Ventilyator persistence')process.exit(1)", capture=True)
    print('PASS PostgreSQL identity, Redis session and filesystem bytes survive container recreation', flush=True)
    cmd('stop', 'ventilyator-worker')
    assert request('/health/live')[0] == 200
    assert request('/health/ready')[0] == 503
    print('PASS readiness fails when worker is stopped while liveness remains healthy', flush=True)
finally:
    cmd('start', 'ventilyator-worker')
    ready()
    cmd('exec', '-T', 'ventilyator-api', 'node', '-e', f"require('fs').rmSync({json.dumps(path)},{{force:true}})", capture=True)
    if cookie:
        request('/auth/logout', {})
print('PASS worker restart restores readiness; temporary marker and test session removed')
