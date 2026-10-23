#!/usr/bin/env python3
"""Generate a machine-local Docker build override using existing proxy and CA bindings."""
import json
import os
from pathlib import Path
import socket
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[2]
build = {}
proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
if proxy:
    host = urlsplit(proxy).hostname
    if not host:
        raise SystemExit('Invalid proxy hostname')
    build['args'] = {key: '${' + key + ':-}' for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY')}
    build['extra_hosts'] = [f'{host}:{socket.gethostbyname(host)}']
ca = os.environ.get('CODEX_PROXY_CERT')
if ca:
    if not Path(ca).is_file():
        raise SystemExit('Corporate CA file is unavailable')
    build['secrets'] = ['corporate_ca']
result = {'services': {service: {'build': build} for service in ['ventilyator-api', 'ventilyator-worker', 'ventilyator-migrate', 'ventilyator-web']}}
if ca:
    result['secrets'] = {'corporate_ca': {'file': '${CODEX_PROXY_CERT:?}'}}
(root / '.local').mkdir(exist_ok=True)
(root / '.local/cloud-build.yml').write_text(json.dumps(result, indent=2) + '\n')
print('Cloud build override saved (existing proxy and trusted CA; no secret values copied).')
