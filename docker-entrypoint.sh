#!/bin/sh
set -e

SECRET_FILE="/app/data/.auth-secret"
PRISMA_CLI="/app/prisma-cli/node_modules/prisma/build/index.js"
SCHEMA="/app/prisma/schema.prisma"

# ── AUTH_SECRET: env wins, else load from volume, else generate + persist ──
if [ -z "${AUTH_SECRET:-}" ]; then
  if [ -f "$SECRET_FILE" ]; then
    AUTH_SECRET=$(cat "$SECRET_FILE")
    export AUTH_SECRET
    echo "[homelab-reader] AUTH_SECRET loaded from volume"
  else
    AUTH_SECRET=$(head -c 32 /dev/urandom | base64)
    umask 077
    printf '%s' "$AUTH_SECRET" > "$SECRET_FILE"
    export AUTH_SECRET
    echo "[homelab-reader] AUTH_SECRET generated and persisted to volume"
  fi
fi

banner_fail() {
  printf '\n'
  printf '╔════════════════════════════════════════════════════════════════╗\n'
  printf '║                                                                ║\n'
  printf '║   ⚠  homelab-reader: DATABASE MIGRATION FAILED                 ║\n'
  printf '║                                                                ║\n'
  printf '║   prisma migrate deploy returned non-zero against the volume   ║\n'
  printf '║   DB at /app/data/homelab-reader.db. Refusing to start the     ║\n'
  printf '║   server in a broken state.                                    ║\n'
  printf '║                                                                ║\n'
  printf '║   To diagnose:                                                 ║\n'
  printf '║     docker compose logs homelab-reader | head -40              ║\n'
  printf '║                                                                ║\n'
  printf '║   Common causes + fixes:                                       ║\n'
  printf '║   • Drifted DB (manual edits, partial migration): wipe and     ║\n'
  printf '║     restart — books re-scan from /app/books on next boot.      ║\n'
  printf '║   • Missing migration file: rebuild with --no-cache so the     ║\n'
  printf '║     prisma/migrations/ tree gets re-copied into the image.     ║\n'
  printf '║                                                                ║\n'
  printf '╚════════════════════════════════════════════════════════════════╝\n'
  printf '\n'
}

# migrate deploy is idempotent and never resets data. On any failure we
# exit so the container refuses to start in a broken state.
echo "[homelab-reader] Applying database migrations..."
if node "$PRISMA_CLI" migrate deploy --schema="$SCHEMA"; then
  echo "[homelab-reader] ✓ Database is current"
else
  banner_fail
  exit 1
fi

echo "[homelab-reader] Starting..."
exec node server.js
