#!/usr/bin/env sh
# Docker Compose for the hosted demo: docker/compose.yml with the demo overlay and the `full`
# profile, from the deployment directory (two levels up), whose `.env` holds the settings.
#   docker/demo/compose.sh pull
#   docker/demo/compose.sh up -d --wait --no-build --remove-orphans
#   docker/demo/compose.sh logs -f api
set -eu
cd "$(dirname "$0")/../.."
exec docker compose --project-directory . -f docker/compose.yml -f docker/demo/compose.yml \
  --profile full "$@"
