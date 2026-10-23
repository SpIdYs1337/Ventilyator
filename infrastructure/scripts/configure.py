#!/usr/bin/env python3
"""Создаёт локальную конфигурацию без заранее известных паролей, не перезаписывает .env."""
import argparse
import os
from pathlib import Path
import secrets
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--development', action='store_true')
parser.add_argument('--data-root', default='/srv/ventilyator')
parser.add_argument('--host', default='ventilyator.company.local')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
data = Path(args.data_root).resolve()
host = 'http://localhost:8080' if args.development else f'https://{args.host}'
if any(c in str(data) + host for c in '\n\r\"\'`$# '):
    parser.error('Host and path must not contain shell or dotenv metacharacters')
if not urlparse(host).hostname:
    parser.error('Invalid host')
pg, redis = secrets.token_hex(32), secrets.token_hex(32)
content = f'''APP_HOST={args.host}
APP_ORIGIN={host}
HTTP_PORT={8080 if args.development else 80}
HTTPS_PORT=443
TLS_CERT=internal
TLS_KEY=
DATA_ROOT={data}
POSTGRES_PASSWORD={pg}
REDIS_PASSWORD={redis}
DATABASE_URL=postgresql://ventilyator:{pg}@ventilyator-postgres:5432/ventilyator
REDIS_URL=redis://:{redis}@ventilyator-redis:6379/0
NODE_ENV={'development' if args.development else 'production'}
SESSION_MAX_DAYS=30
'''
fd = os.open(root / '.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(content)
print('Создан .env (0600). Значения секретов не выводятся.')
print('Каталоги данных подготовьте командой prepare-host.sh с правами администратора.')
