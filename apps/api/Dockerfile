# API image: the API, the standalone worker and the database migrations. Build from the repo root
# (the pnpm workspace):
#   docker build -f apps/api/Dockerfile -t testtix/api .
# One image, three commands (docker/compose.yml, `full` profile, runs each as its own service):
#   (default)                     the API on PORT (3000)
#   node dist/worker.js           the background worker, health checks on WORKER_PORT (3001)
#   prisma migrate deploy && node dist/seed/main.js --if-empty
#                                 applies migrations, then seeds an empty database

FROM node:24.16.0-alpine AS build
WORKDIR /repo
# pnpm comes from `packageManager` in package.json.
RUN corepack enable
# Download dependencies in their own layer, so source changes don't refetch them.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch
COPY . .
# `generate` writes the Prisma client into src/ before the build compiles it (turbo does the same).
RUN pnpm install --offline --frozen-lockfile --filter "@testtix/api..." \
  && pnpm --filter @testtix/api run generate \
  && pnpm --filter "@testtix/api..." run build \
  && pnpm --filter @testtix/api deploy --prod --legacy /out

FROM node:24.16.0-alpine
# GHCR links the package to the repository through `source`.
LABEL org.opencontainers.image.source="https://github.com/azeljkovic/testtix" \
  org.opencontainers.image.description="TestTix API, background worker and database migrations" \
  org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WORKER_PORT=3001 PATH=/app/node_modules/.bin:$PATH
WORKDIR /app
# Owned by root and read-only for the `node` user the processes run as.
COPY --from=build /out ./
USER node
EXPOSE 3000 3001
# Checks the API. The worker's service overrides it with WORKER_PORT (docker/compose.yml).
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
