# homelab-reader

## What This Is

A self-hosted book server for technical libraries: it watches a folder of
EPUB/PDF files, extracts metadata and covers, and serves the library to PCs on
the LAN through a web reader and to the sibling `android-reader` app through an
OPDS feed. Multi-user, privacy-respecting, runs as a single Docker container on
a homelab.

## Core Value

A household can point the server at a folder of books and every device — PCs in
the browser, phones via android-reader/OPDS — reads the same library, with
each person's notes, highlights, and progress kept private to them.

## Requirements

### Validated

<!-- Shipped and relied upon. Inferred from existing code (.planning/codebase/). -->

- ✓ Library scanning — chokidar watch + EPUB/PDF metadata + cover render + DB reconcile on startup — existing
- ✓ In-app EPUB reader — epub.js, paginated/scroll, CFI progress, zoom/font — existing
- ✓ In-app PDF reader — PDF.js, page progress, zoom — existing
- ✓ Multi-user auth — NextAuth v5 credentials, bcrypt + JWT, first-run admin setup, admin-managed accounts — existing
- ✓ Library folder management + full-library search — existing
- ✓ Per-user notes & highlights — color-coded, inline annotations, side panel — existing
- ✓ Reading progress tracking — Continue Reading wiring — existing
- ✓ OPDS 1.2 catalog feed (metadata) — `/api/opds`, `/api/opds/all`, `/api/opds/recent` — existing
- ✓ Docker deployment — compose on port 3333, read-only books mount, hardened runtime — existing

### Active

<!-- Remaining work to call the project complete. Hypotheses until shipped. -->

**Authorization correctness (live gaps on a multi-user, LAN-exposed server):**
- [ ] Admin-gate `/api/scan` POST so only admins can trigger a rescan
- [ ] Map auth failures to 401 (not 500) in notes/highlights/progress routes
- [ ] Regression tests proving per-user isolation and admin gates hold

**OPDS authentication (the android-reader bridge — documented, not enforced):**
- [ ] Per-user HTTP Basic/Bearer auth on the OPDS handlers (they are middleware-exempt, so the check lives in the route)
- [ ] Attribute reading progress to the authenticated OPDS user

**Resource safety & robustness (homelab container, multi-reader + background writer):**
- [ ] SQLite concurrency tuning — WAL + busy_timeout + single-connection — to stop `SQLITE_BUSY` collisions
- [ ] Concurrency-limited scanner queue so a cold-start import can't spike memory or contend on the DB
- [ ] Stream the book-file download (Range support) instead of buffering whole files in memory
- [ ] Read each PDF once for metadata + cover instead of re-opening the file
- [ ] Surface a "failed to import" signal to the UI instead of silently dropping a malformed book

**Test suite (none exists today):**
- [ ] Vitest harness with route-level and scanner tests covering the isolation, authz, and idempotency paths above

### Out of Scope

<!-- Explicit boundaries with reasoning. -->

- Login rate limiting / lockout — deferred to a future "internet-exposure" milestone; bcrypt cost 12 + LAN-only binding mitigate today (`src/auth.ts`)
- Transactional first-admin creation — TOCTOU window is already closed in practice by the double-check + `username @unique`; low value now (`src/app/setup/page.tsx`)
- OPDS feed pagination — only matters past a few thousand titles; library is household-scale (`src/app/api/opds/all/route.ts`)
- Confining `/api/fs` browse to mounted volumes — admin-only behind a trust boundary; hardened container limits blast radius (`src/app/api/fs/route.ts`)
- Per-user library scoping (who can see which books) — current model is a shared household library; not a goal this milestone
- Per-user data export / backup API — real future need for android-reader sync, but a milestone of its own; not required to call the server "complete"
- EPUB reader refactor (`EpubReader.tsx`, 710 lines) — fragile but working; refactor is not completion work
- Postgres migration — not warranted at household scale; SQLite tuning covers the load

## Context

- **Brownfield.** The app is feature-complete on the happy path (~24 commits). A full
  codebase map lives in `.planning/codebase/` (STACK, ARCHITECTURE, STRUCTURE,
  CONVENTIONS, TESTING, CONCERNS). "Completion" here is hardening — closing
  authorization gaps, enforcing the documented OPDS auth, making the container
  resource-safe under real multi-user load, and adding the test suite that
  currently does not exist — not new end-user features.
- **Two-device story.** android-reader on mobile, homelab-reader on the LAN,
  bridged by OPDS. The OPDS auth contract (commit `4cb6ec3`,
  `docs/OPDS-AUTH-CONTRACT.md`) is the agreed cross-repo interface; this
  milestone implements the server side of it.
- **Strong conventions already in place.** Typed error subclasses mapped to
  status codes via an `authError` helper, hand-shaped JSON responses, `@/*`
  import alias, kebab-case libs / PascalCase components. New code matches this.
- **Live, not hypothetical.** The app already ships multi-user auth and a
  LAN-exposed Docker image, so the authorization and isolation gaps in
  CONCERNS.md are real exposure, not scaffold notes.

## Constraints

- **Tech stack**: Next.js 15 (App Router) + React 19, Prisma + SQLite, NextAuth v5, TailwindCSS v4 — stay on the existing stack; no framework swaps
- **Build**: webpack for production builds (Turbopack stays dev-only until it + Next standalone output GA together)
- **Security**: never write device serials, MACs, private IPs, home-dir paths, real names, or per-clone tokens into any file or commit; privacy pre-commit hook is the safety net, not the primary defense
- **Compatibility**: the OPDS auth implementation must match `docs/OPDS-AUTH-CONTRACT.md` so android-reader interoperates
- **DB migrations**: schema edits require `npx prisma migrate dev --name <descriptive>`; commit schema + migration together
- **Verification**: host/VM split — `npm run dev`, build, tests, and Prisma run on the host; edits happen here

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Completion = hardening, not new features | App is happy-path complete; the gaps are authz, OPDS auth, resource safety, and tests | — Pending |
| Add Vitest (not Jest/Playwright) | Lightweight, fast, native ESM/TS — matches a Next 15 + TS project; route + scanner unit/integration tests, not full E2E | — Pending |
| Implement OPDS auth in the route, not middleware | OPDS is deliberately middleware-exempt; per the contract the Basic/Bearer check belongs in the handler | — Pending |
| Tune SQLite (WAL + busy_timeout) rather than move to Postgres | Standard fix for Prisma + SQLite + a background writer at household scale | — Pending |
| Defer rate-limiting / pagination / export to future milestones | They matter at internet-exposure or large-library scale, neither of which is this milestone's goal | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-31 after initialization*
