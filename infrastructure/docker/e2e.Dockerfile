# Development-only browser runner. Not part of the production Compose stack.
FROM ventilyator-backend:0.1.0
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*
USER node
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
CMD ["pnpm", "test:e2e"]
