#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export DOCKER_CONFIG="${DOCKER_CONFIG:-/workspace/.cache/docker}"
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build --wait --wait-timeout 120
python3 - <<'PY'
import http.client
c = http.client.HTTPConnection('127.0.0.1', 8080, timeout=10)
c.request('GET', '/api/health/ready')
r = c.getresponse()
assert r.status == 200, 'API readiness failed'
r.read()
c.request('GET', '/')
r = c.getresponse()
assert r.status == 200 and b'Ventilyator' in r.read(), 'Frontend unavailable'
print('Ventilyator development stack: API ready, frontend served.')
PY
