# Security audit — homelab-reader — 2026-06-01

Workspace-wide audit campaign, security pass. This document records what was
reviewed, the findings, and recommended fixes. No source code was changed in
this pass: the repository has another session's in-progress feature work
(OPDS mobile-client authentication, per the README "next milestone" and
`OVERNIGHT_PLAN.md`), so this pass is read-only. Every finding below is for a
human to action.

## Scope and method

homelab-reader is a self-hosted Next.js 15 (App Router) book server with a
SQLite/Prisma database, NextAuth v5 credential auth, a filesystem scanner, a
web reader, and an OPDS catalog for mobile clients. It has a real server attack
surface, so this was a full security pass: every untrusted-input path was traced
for injection, path traversal, server-side request forgery, broken
authorization, cross-site scripting, insecure deserialization, secret leakage,
and known-vulnerable dependencies.

Surfaces reviewed:

- Authentication and session: `src/auth.ts`, `src/auth.config.ts`,
  `src/middleware.ts`, `src/lib/current-user.ts`, `src/lib/users.ts`,
  first-run setup (`src/app/setup/page.tsx`).
- OPDS token auth: `src/lib/opds-auth.ts`, `src/app/api/opds/*`,
  `src/app/api/opds-tokens/*`.
- Filesystem-touching routes: `src/app/api/fs/route.ts`,
  `src/app/api/books/[id]/file/route.ts`, `src/app/api/covers/[id]/route.ts`,
  `src/lib/scanner/*`.
- Per-user data REST: notes, highlights, progress (`src/app/api/{notes,highlights,progress}/*`).
- Admin REST: users, locations, scan (`src/app/api/{users,locations,scan}/*`).
- Outbound network: `src/lib/metadata/openlibrary.ts`.
- Raw SQL: `src/lib/prisma.ts`.
- Secret handling: `.gitignore`, tracked files, `scripts/set-password.mjs`.
- Dependency advisories: `npm audit`.

Baseline verification at audit time: `npx tsc --noEmit` clean;
`npx vitest run` 9 files / 81 tests pass.

## What is sound

- **Per-user data isolation (no IDOR).** Notes, highlights, and progress all
  scope reads and writes by the session user id and verify ownership before
  update/delete (e.g. `src/app/api/notes/[id]/route.ts:28-31`). A user cannot
  reach another user's rows.
- **Admin authorization.** User, location, and scan management all call
  `requireAdmin()` (`src/lib/current-user.ts:44`) and map the typed errors to
  401/403. The last-admin guard prevents locking out user management
  (`src/app/api/users/[id]/route.ts:31-39,90-98`).
- **OPDS token auth.** Tokens are high-entropy `randomBytes(32)` base64url,
  stored only as SHA-256 hex, returned in plaintext exactly once on mint and
  never logged or re-listed (`src/app/api/opds-tokens/route.ts`). Verification
  is an indexed hash lookup plus a constant-time confirm
  (`src/lib/opds-auth.ts:73-91`). Basic and Bearer are both parsed, splitting
  on the first colon so colon-bearing tokens survive.
- **No SQL injection.** All queries go through Prisma's parameterized API. The
  only raw call is `$queryRawUnsafe` with two hardcoded constant PRAGMA strings
  and no interpolation (`src/lib/prisma.ts:34-40`).
- **No command/subprocess execution** anywhere in `src/`. No `child_process`,
  `exec`, `spawn`, or `eval`.
- **No SSRF.** The only outbound fetch targets a fixed `https://openlibrary.org`
  host with URL-encoded query params; the host is never user-controlled
  (`src/lib/metadata/openlibrary.ts:108-122`).
- **No XSS sink.** No `dangerouslySetInnerHTML` / `innerHTML` in the codebase.
  OPDS XML output escapes text and attribute values (`src/lib/opds.ts:125-137`).
  Note/highlight bodies are per-user and length-bounded; they are not rendered
  cross-user.
- **Cover path traversal defended.** `resolveCoverPath` resolves against the
  covers directory and rejects any path that escapes it
  (`src/lib/scanner/covers.ts:20-27`). The book-file route serves only
  `path.resolve(book.filePath)` from a database row written by the scanner from
  admin-configured roots — never a request-supplied path
  (`src/app/api/books/[id]/file/route.ts:118`). The HTTP Range parser clamps and
  validates all offsets against the file size before use (`parseRange`).
- **Secret handling.** `.env` / `.env.local` are gitignored and untracked; only
  `.env.example` is committed. `scripts/set-password.mjs` is a host-only
  recovery tool with no injection surface.
- **First-run setup is single-use.** The setup page redirects to `/login` once
  any user exists and re-checks `userCount()` inside the server action before
  creating the admin (`src/app/setup/page.tsx:24,32`).

## Findings

### HIGH — OPDS book download path is outside the OPDS auth boundary

- **Location:** `src/app/api/books/[id]/file/route.ts` (whole file);
  `src/auth.config.ts:43`; `src/lib/opds.ts:113-115`.
- **Status:** **FIXED 2026-06-01.** The recommended dual-auth was implemented (see
  "Resolution" below). The book-file and cover routes now authenticate in-route
  via `authenticateReaderRequest` (`src/lib/reader-auth.ts`) — a valid cookie
  session **or** a valid OPDS token — and the same change exempts only
  `/api/books/[id]/file` and `/api/covers/[id]` from the cookie gate, so the
  routes are never briefly open. Verified: tsc clean, lint clean, 87/87 vitest
  (incl. new `tests/reader-auth.test.ts` + 2 route gates in
  `tests/authz-gates.test.ts`), production build green.
- **What it is.** The OPDS acquisition feed advertises each book's download link
  as `/api/books/[id]/file` (`src/lib/opds.ts:113-115`), and the client handoff
  doc explicitly directs android-reader to download book bytes from
  `GET /api/books/[id]/file` using its OPDS token
  (`docs/ANDROID-READER-HANDOFF.md:33-35,51-52`). However, the middleware
  exemption only covers paths under `/api/opds`
  (`src/auth.config.ts:43`); `/api/books/[id]/file` is therefore gated by the
  browser **cookie** session, and the route itself performs **no** in-route
  authentication. Two consequences:
  1. **Functional break of the documented contract.** A mobile OPDS client that
     sends only a token header (Basic/Bearer, no cookie) fails the
     `authorized()` gate and is redirected to `/login`; the download cannot
     complete. The catalog is browsable over OPDS but the book bytes are not
     fetchable over OPDS.
  2. **Latent authorization gap on the eventual fix.** The natural fix —
     extending the OPDS exemption to cover the file route — would make
     `/api/books/[id]/file` fully unauthenticated unless an `authenticateOpds`
     guard is added *in the route* at the same time, because the route has no
     auth of its own today.
- **Fix (recommended).** Authenticate this route explicitly rather than relying
  on the middleware cookie gate. Accept *either* a valid cookie session
  (`getCurrentUser()`) *or* a valid OPDS token (`authenticateOpds(req)`); return
  401 (with the OPDS challenge for the token path) when neither is present. Do
  this in the same change that exempts the path from the cookie-only middleware
  gate, so the route is never briefly open. Mirror the same dual-auth shape the
  cover route would need if covers are fetched over OPDS (see below). Add a
  regression test to `tests/authz-gates.test.ts`, which currently does not
  exercise the file route at all.

### MEDIUM — Cover route relies solely on the cookie gate; same OPDS mismatch

- **Location:** `src/app/api/covers/[id]/route.ts` (whole file);
  `src/lib/opds.ts:105-111`.
- **Status:** **FIXED 2026-06-01** — resolved together with the HIGH finding
  above (same dual-auth guard + middleware exemption).
- **What it is.** The OPDS feed links covers at `/api/covers/[id]`
  (`src/lib/opds.ts:105-111`). Like the file route, the cover route has no
  in-route auth and sits behind the cookie-only middleware gate, so an OPDS
  client cannot load cover thumbnails with its token, and the route's only
  protection is the cookie session. Lower severity than the book-file finding
  because cover images are lower-sensitivity than full book bytes, but it is the
  same architectural mismatch and should be fixed together.
- **Fix (recommended).** Same dual-auth approach as the file route, applied when
  OPDS cover delivery is wired up.

### MEDIUM — Known-vulnerable transitive dependency: `@xmldom/xmldom` via `epubjs`

- **Location:** `package-lock.json` — `epubjs@0.3.x` → `@xmldom/xmldom`.
- **Status:** flagged (fix requires a breaking major upgrade — out of scope for
  a patch-only pass).
- **What it is.** `npm audit` reports two HIGH advisories against
  `@xmldom/xmldom` (XML injection via unsafe CDATA serialization
  [GHSA-wh4c-j3r5-mjhp]; uncontrolled recursion DoS [GHSA-2v35-w6hq-6mfw]) plus
  several related node-injection advisories. The only `npm audit fix` path is
  `epubjs@0.4.2`, a **breaking** change. epubjs is the client-side EPUB reader.
  Practical exposure here is bounded: the parsed XML is the user's own EPUB
  content rendered in that same user's reader (not attacker-to-victim across
  accounts), and the reader runs client-side. Still worth tracking.
- **Fix (recommended).** Do not auto-upgrade. Plan an `epubjs@0.4.x` migration
  as its own change with reader regression testing, since the reader behavior
  (cover/section landing, theming, flow) is sensitive here. Confirm
  install + build + reader smoke test stay green before adopting.

### MEDIUM — Known-vulnerable transitive dependency: `postcss` via `next`

- **Location:** `package-lock.json` — `next` → `postcss <8.5.10`.
- **Status:** flagged (no clean fix — `npm audit fix --force` proposes an absurd
  `next@9.3.3` downgrade).
- **What it is.** `npm audit` reports a MODERATE advisory (PostCSS XSS via
  unescaped `</style>` in stringify output, GHSA-qx2v-qp2m-jg93) against the
  `postcss` version pinned transitively under Next.js. PostCSS runs at
  **build time** on the project's own CSS, so runtime exposure is minimal. The
  proposed automated fix would downgrade Next.js by six majors and is not
  acceptable.
- **Fix (recommended).** Wait for a Next.js patch release that bumps its bundled
  `postcss`, then take it via a normal Next.js patch/minor upgrade with a build
  check. Do not force-resolve.

### INFO — Admin filesystem browser can list any readable directory

- **Location:** `src/app/api/fs/route.ts:20`.
- **Status:** flagged (by design; documented).
- **What it is.** `GET /api/fs?path=…` does `path.resolve(...)` on an
  admin-supplied path and lists its subdirectories, so an admin can enumerate
  any directory the server process can read. This is intentional — the admin
  picks a library folder by browsing the server filesystem — and is admin-gated
  via `requireAdmin()`. In production the visible tree is whatever is mounted
  into the container, which bounds it. Recorded for awareness, not as a defect.
- **Hardening (optional).** If tighter scoping is ever wanted, constrain browse
  roots to a configured allowlist (e.g. under the books mount) rather than the
  whole filesystem.

### INFO — First-run setup has a negligible race window

- **Location:** `src/app/setup/page.tsx:32`.
- **Status:** flagged (negligible; LAN-only).
- **What it is.** The admin-creation server action re-checks `userCount() > 0`
  before creating the admin, but two simultaneous first-run submissions could in
  principle both pass the check before either inserts. The window exists only
  before the very first account is created, on a LAN-only deployment, so the
  practical risk is negligible. A unique constraint or transaction would close
  it fully if ever desired.

## Runtime hardening (recommendations only — not changed)

Per campaign rules, container and runtime configuration were not modified. For a
future hardening pass, consider documenting/confirming: binding the service to
the intended LAN interface only, enforcing the `AUTH_SECRET` presence at boot,
and HTTPS/reverse-proxy termination given that OPDS tokens travel as HTTP Basic
credentials. These are deployment concerns, flagged for a human.

## Resolution — dual-auth on binary-content routes (2026-06-01)

The HIGH (book-file auth boundary) and the paired MEDIUM (cover route) were
fixed in a follow-up change, on explicit maintainer instruction, after the
read-only pass:

- **New guard `authenticateReaderRequest(req)`** in `src/lib/reader-auth.ts`:
  resolves a request to a user via **either** a valid NextAuth cookie session
  (`getCurrentUser()`) **or** a valid per-user OPDS token (`authenticateOpds()`),
  returning `null` when neither is present. It lives in its own module rather
  than `opds-auth.ts` so the token module stays free of the `next-auth` import
  graph (which otherwise breaks `opds-auth.ts`'s edge/test loading).
- **Both routes self-guard before any DB lookup.**
  `src/app/api/books/[id]/file/route.ts` and
  `src/app/api/covers/[id]/route.ts` now call the guard first and answer
  `opdsChallenge()` (401 + `WWW-Authenticate`) when it returns `null` — so an
  unauthenticated caller cannot even probe which book ids exist.
- **Middleware exemption added in the same change** (`src/auth.config.ts`):
  `/api/covers/` and `/api/books/[id]/file` (narrow `endsWith("/file")` match —
  the rest of `/api/books` stays cookie-gated) leave the cookie gate so a
  token-only OPDS client is no longer bounced to `/login`. Because the routes
  self-guard, the exemption never leaves them open. This closes the "latent
  authorization gap on the eventual fix" called out in the HIGH finding.
- **Regression tests:** `tests/reader-auth.test.ts` proves the cookie and token
  accept-paths (and rejects none/unknown) against a real ephemeral SQLite DB;
  `tests/authz-gates.test.ts` adds two route-level cases asserting both routes
  answer a 401 challenge when signed out with no token.

Outstanding from this finding set: the two transitive dependency advisories
(`@xmldom/xmldom` via `epubjs`; `postcss` via `next`) still require breaking
upgrades and were not touched.

## Verification

Read-only pass (initial): `npx tsc --noEmit` clean; `npx vitest run` 9 files /
81 tests pass; `npm audit` 5 advisories (2 high, 3 moderate), all transitive.

Dual-auth fix (2026-06-01): `npx tsc --noEmit` clean; `npx next lint` clean;
`npx vitest run` **10 files / 87 tests pass**; `npm run build` (production,
webpack) green.
