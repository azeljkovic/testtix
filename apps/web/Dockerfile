# Web image: the built single-page app, served by Caddy (apps/web/Caddyfile), which also forwards
# /api/* and port 3000 to the API replicas. Build from the repo root (the pnpm workspace):
#   docker build -f apps/web/Dockerfile -t testtix/web .

FROM node:24.16.0-alpine AS build
WORKDIR /repo
# pnpm comes from `packageManager` in package.json.
RUN corepack enable
# Download dependencies in their own layer, so source changes don't refetch them.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@testtix/web..." \
  && pnpm --filter "@testtix/web..." run build

FROM caddy:2.11.9-alpine
# GHCR links the package to the repository through `source`.
LABEL org.opencontainers.image.source="https://github.com/azeljkovic/testtix" \
  org.opencontainers.image.description="TestTix web app, served by Caddy in front of the API" \
  org.opencontainers.image.licenses="MIT"
# Runs as an unprivileged user; Caddy keeps its state in XDG_DATA_HOME / XDG_CONFIG_HOME.
RUN addgroup -S -g 10001 web && adduser -S -D -H -u 10001 -G web web \
  && chown web:web /config /data
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
USER web
EXPOSE 8080 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/"]
