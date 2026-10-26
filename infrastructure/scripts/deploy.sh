#!/usr/bin/env bash
# Run from the existing checkout after git pull; retain .env, DATA_ROOT and all accounts.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
test -f .env
docker compose config --quiet
docker compose build ventilyator-api ventilyator-web ventilyator-proxy
docker compose up -d --wait --wait-timeout 180 ventilyator-postgres ventilyator-redis
vnt_table=$(docker compose exec -T ventilyator-postgres psql -U ventilyator -d ventilyator -Atc "SELECT to_regclass('public.\"User\"') IS NOT NULL;")
if [[ "$vnt_table" == 't' ]]; then
  vnt_users=$(docker compose exec -T ventilyator-postgres psql -U ventilyator -d ventilyator -Atc 'SELECT COUNT(*) FROM "User";')
  if [[ "$vnt_users" =~ ^[1-9][0-9]*$ ]]; then
    python3 infrastructure/scripts/backup.py
  fi
fi
docker compose stop ventilyator-api ventilyator-worker
docker compose run --rm -T ventilyator-migrate
docker compose up -d --no-build --wait --wait-timeout 180
docker compose ps -a
printf '%s\n' 'Ventilyator запущен. Откройте настроенный локальный адрес в браузере.'
