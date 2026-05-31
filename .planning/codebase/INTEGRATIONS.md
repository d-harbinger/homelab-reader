# External Integrations

**Analysis Date:** 2026-05-31

This is a self-hosted, LAN-local book server. It deliberately has **no
third-party SaaS, no outbound network calls, and no cloud services**. All
"integrations" are local: the filesystem, the SQLite database, and the OPDS
catalog protocol that bridges to the sibling `android-reader` client.

## APIs & External Services

**Third-party SaaS / cloud APIs:**
- None. No Stripe/AWS/Supabase/analytics SDKs. No outbound HTTP clients in `src/`. The CSP in `next.config.ts` pins `connect-src 'self'` and `default-src 'self'`, enforcing no external network egress from the browser.

**Outbound serving protocol — OPDS 1.2:**
- The app *exposes* an OPDS 1.2 catalog (it is the server, not a consumer). Generator: `src/lib/opds.ts`. Routes: `src/app/api/opds/route.ts` (root navigation), `src/app/api/opds/all/route.ts`, `src/app/api/opds/recent/route.ts`.
- Consumers are OPDS-aware reader clients (the sibling `android-reader`, plus generic clients like KOReader/Moon+/Aldiko noted in `src/lib/opds.ts`). They discover books and download via the acquisition link `/api/books/[id]/file`.

## Data Storage

**Databases:**
- SQLite via Prisma.
  - Connection: `DATABASE_URL` env var (e.g. `file:../data/homelab-reader.db` in dev, `file:/app/data/homelab-reader.db` in Docker).
  - Client: `@prisma/client`, singleton in `src/lib/prisma.ts` (cached on `globalThis` outside production).
  - Schema: `prisma/schema.prisma` — models `User`, `Book`, `Author`, `Tag`, `Progress`, `Note`, `Highlight`, `ScanLocation`.
  - Migrations: `prisma/migrations/` (`20260521170330_initial`, `20260525120000_add_user_role`). Provider locked to `sqlite` (`migration_lock.toml`). Applied at boot via `prisma migrate deploy` in `docker-entrypoint.sh`.

**File Storage:**
- Local filesystem only.
  - Source library: read-only mount at `BOOKS_PATH` (Docker `/app/books`, bind-mounted read-only). The scanner never writes here.
  - Generated covers: `data/covers/<bookId>.<ext>` (`src/lib/scanner/covers.ts`, `COVERS_DIR`), served by `src/app/api/covers/[id]/route.ts`. Path-escape guarded in `resolveCoverPath`.
  - Source file bytes served (download/read) by `src/app/api/books/[id]/file/route.ts` — only paths recorded by the scanner are served; no user-supplied paths.

**Caching:**
- No external cache (no Redis/Memcached). Client-side SWR (`swr`) caches API responses in the browser. HTTP `Cache-Control: private, max-age=3600` on file responses.

## Authentication & Identity

**Auth Provider:**
- Self-managed via NextAuth (Auth.js) v5 — no external identity provider.
  - Strategy: Credentials provider (username + password), JWT session (`src/auth.config.ts` `session.strategy: "jwt"` — Credentials providers cannot use DB sessions).
  - Verification: bcrypt compare against `User.passwordHash` (`src/auth.ts`).
  - Roles: `admin` / `reader` (`User.role`, default `reader`). First account created via first-run `/setup` becomes admin; admins manage accounts via `/api/users`.
  - Route gate: `src/middleware.ts` runs `authConfig.authorized` on all routes except `api/auth`, Next internals, and static assets. `/login` and `/setup` are open while signed out; `/api/opds` is currently exempt from the cookie gate (its own token auth is a planned phase).
  - `trustHost: true` — required for self-hosted LAN deployment behind an arbitrary host/port.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry/error-reporting SDK.

**Logs:**
- `console.*` to stdout/stderr (e.g. `[scanner] …` messages in `src/lib/scanner/watcher.ts`). Prisma query logging set to `error`/`warn` in dev, `error` only in prod (`src/lib/prisma.ts`). In Docker, read via `docker compose logs -f homelab-reader`.

**Health:**
- `/api/scan/status` endpoint (`src/app/api/scan/status/route.ts`) reports watcher status; used as the Docker healthcheck probe.

## CI/CD & Deployment

**Hosting:**
- Self-hosted Docker on a homelab box. `docker compose up -d --build` → host port 3333. Container hardened (non-root uid 1001, `cap_drop: ALL`, `no-new-privileges`).

**CI Pipeline:**
- None detected (no `.github/workflows`, no CI config). Deployment is manual `git pull` + `docker compose up -d --build`; the entrypoint applies migrations on boot.

## Environment Configuration

**Required env vars (see `.env.example`):**
- `DATABASE_URL` - SQLite DB file path.
- `BOOKS_PATH` - filesystem folder the scanner adopts on first run (Docker: `/app/books`).
- `AUTH_SECRET` - NextAuth signing secret; auto-generated and persisted to the data volume if unset (`docker-entrypoint.sh`).
- `AUTH_TRUST_HOST` - `true` for LAN/reverse-proxy deployment.
- `NEXTAUTH_URL` - listen URL.

**Secrets location:**
- `.env` / `.env.local` (gitignored, never committed). In Docker, `AUTH_SECRET` persists at `/app/data/.auth-secret` (mode 077) inside the named data volume. Repo ships a privacy guard (`scripts/hooks/pre-commit`, `scripts/audit-privacy.sh`, `.gitleaks.toml`) to keep secrets/PII out of commits.

## Webhooks & Callbacks

**Incoming:**
- None. No external webhook receivers.

**Outgoing:**
- None. No outbound webhooks or callbacks.

## Planned Integration (contract only, not yet implemented)

- **OPDS per-user API token auth** — documented in `docs/OPDS-AUTH-CONTRACT.md`. Cross-repo wire contract with `android-reader`: HTTP Basic (`base64(username:token)`) with Bearer as alternative, tokens hashed at rest, `401` + `WWW-Authenticate: Basic realm="homelab-reader OPDS"` on failure. Today the OPDS routes are unauthenticated (exempted in `src/auth.config.ts`); the token guard, Prisma token model, and mint/revoke UI land in a later phase.

---

*Integration audit: 2026-05-31*
