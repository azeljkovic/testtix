# Fake payment provider image. Build from the repo root (the pnpm workspace):
#   docker build -f apps/fake-payments/Dockerfile -t testtix/fake-payments .
# `pnpm infra:up` builds it through docker/compose.yml.

FROM node:24.16.0-alpine AS build
WORKDIR /repo
# pnpm comes from `packageManager` in package.json.
RUN corepack enable
# Download dependencies in their own layer, so source changes don't refetch them.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@testtix/fake-payments..." \
  && pnpm --filter "@testtix/fake-payments..." run build \
  && pnpm --filter @testtix/fake-payments deploy --prod --legacy /out

FROM node:24.16.0-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
