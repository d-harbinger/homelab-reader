FROM node:22-alpine AS base

# ── Dependencies ──────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma/
ENV DATABASE_URL="file:/app/data/homelab-reader.db"
RUN npm ci --fetch-retries=5 --fetch-retry-maxtimeout=180000
RUN npx prisma generate

# ── Build ─────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="file:/app/data/homelab-reader.db"
# prebuild hook regenerates prisma client and copies pdfjs worker into
# /public. Both are required for the runtime image.
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Standalone output: server.js + traced node_modules.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma — schema for migrate deploy, generated client for runtime.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Self-contained prisma CLI tree for `migrate deploy` at first boot.
# next/standalone trims node_modules; the CLI needs its full transitive
# tree (effect, c12, etc.), so we copy from the deps stage.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules /app/prisma-cli/node_modules

# Mutable data dir for the SQLite DB. Schema-relative path resolution
# (file:../data/homelab-reader.db from /app/prisma/) lands here.
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Library mount point — empty in the image, bind-mounted at runtime.
# Read-only — the scanner never writes here.
RUN mkdir -p /app/books && chown nextjs:nodejs /app/books

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV BOOKS_PATH="/app/books"

ENTRYPOINT ["./docker-entrypoint.sh"]
