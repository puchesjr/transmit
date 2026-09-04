#!/bin/sh
# Migrate, then serve. RUN_MIGRATIONS=false skips the migration step for a
# deployment that runs it as a separate job. ORIGIN defaults to the public
# site URL so adapter-node builds correct absolute URLs behind a proxy.
set -eu
: "${ORIGIN:=${PUBLIC_SITE_URL:-}}"
export ORIGIN
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  ./node_modules/.bin/tsx scripts/migrate.ts
fi
exec node build/index.js
