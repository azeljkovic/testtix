#!/usr/bin/env bash
# Regenerates the OpenAPI spec and the web client types, then fails if either differs from what is
# committed. Run by CI and by `pnpm openapi:check`. Fix a failure with `pnpm openapi` and commit.
set -euo pipefail

GENERATED=(apps/api/openapi.json apps/web/src/api/generated)

pnpm openapi

# `git diff` ignores untracked files, so a newly generated file is checked separately.
untracked=$(git ls-files --others --exclude-standard -- "${GENERATED[@]}")
if ! git diff --exit-code -- "${GENERATED[@]}" || [[ -n "$untracked" ]]; then
  [[ -n "$untracked" ]] && printf 'Untracked generated files:\n%s\n' "$untracked"
  echo "::error::The OpenAPI spec or the generated web client is stale. Run 'pnpm openapi' and commit the result." >&2
  exit 1
fi
echo "OpenAPI spec and web client types are up to date."
