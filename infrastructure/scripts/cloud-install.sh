#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
export XDG_CACHE_HOME=/workspace/.cache
export XDG_STATE_HOME=/workspace/.cache/state
export XDG_DATA_HOME=/workspace/.cache/data
export npm_config_cache=/workspace/.cache/npm
export DOCKER_CONFIG=/workspace/.cache/docker
# Prepared snapshots retain this verified package store and Prisma engine.
# A new machine without that store needs access to the configured registries.
if [ -d /workspace/.cache/pnpm-store ]; then
  pnpm install --offline --frozen-lockfile --store-dir /workspace/.cache/pnpm-store
else
  pnpm install --frozen-lockfile --store-dir /workspace/.cache/pnpm-store --network-concurrency=8
fi
pnpm build
python3 infrastructure/scripts/cloud-build.py
echo 'Native dependencies prepared. Retained Docker images are started by cloud-start.sh.'
