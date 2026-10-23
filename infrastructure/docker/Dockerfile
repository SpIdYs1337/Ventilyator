# syntax=docker/dockerfile:1.7
FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
# Optional trusted corporate CA is build-only and never disables TLS verification.
RUN --mount=type=secret,id=corporate_ca \
    if [ -f /run/secrets/corporate_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/corporate_ca; fi; \
    npm install --global pnpm@11.25.0

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN --mount=type=secret,id=corporate_ca --mount=type=cache,id=ventilyator-pnpm-store,target=/pnpm/store \
    if [ -f /run/secrets/corporate_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/corporate_ca; fi; \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN --mount=type=secret,id=corporate_ca \
    if [ -f /run/secrets/corporate_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/corporate_ca; fi; \
    pnpm build

FROM base AS backend
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

FROM caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d AS caddy-unprivileged
# Official image has a file capability for privileged ports. We use 8080/8443;
# remove it so the binary can execute with cap_drop: ALL and no-new-privileges.
RUN setcap -r /usr/bin/caddy
ENV XDG_CONFIG_HOME=/tmp/caddy-config XDG_DATA_HOME=/tmp/caddy-data
USER 1000:1000

FROM caddy-unprivileged AS proxy
COPY --chown=1000:1000 --chmod=0644 infrastructure/caddy/Caddyfile /etc/caddy/Caddyfile

FROM caddy-unprivileged AS web
COPY --from=build /app/apps/web/dist /srv/web
COPY --chown=1000:1000 --chmod=0644 infrastructure/caddy/web.Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
