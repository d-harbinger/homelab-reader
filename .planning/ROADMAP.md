# Roadmap: homelab-reader — completion milestone

## Overview

homelab-reader is a feature-complete, already-shipped book server: it scans a
folder of EPUB/PDF files, serves a multi-user web reader, and feeds the sibling
android-reader over OPDS. This milestone is hardening, not new features. It
closes the live authorization gaps on a LAN-exposed multi-user server, stands up
the test suite that currently does not exist, enforces the documented per-user
OPDS authentication so android-reader can authenticate, and makes the container
resource-safe under real multi-reader + background-writer load. The journey runs
from securing what is already exposed (authorization + its regression tests),
through the OPDS bridge (which builds on the auth model), to resource safety and
robustness (largely independent work).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Authorization Hardening + Test Harness** - Close the live authz gaps (admin gate, 401-not-500, per-user isolation) and stand up Vitest so the fixes ship with regression tests
- [ ] **Phase 2: OPDS Per-User Authentication** - Enforce the documented Basic/Bearer token auth on the OPDS routes and attribute progress to the authenticated OPDS user
- [ ] **Phase 3: Resource Safety & Robustness** - Tune SQLite, bound the scanner, stream downloads, single-read PDFs, and surface import failures — with scanner tests

## Phase Details

### Phase 1: Authorization Hardening + Test Harness
**Goal**: Every privileged or per-user route enforces the correct access decision, and a Vitest harness proves it so a future refactor can't silently reopen a gap.
**Depends on**: Nothing (first phase)
**Requirements**: AUTHZ-01, AUTHZ-02, AUTHZ-03, AUTHZ-04, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. `POST /api/scan` as a signed-in reader (non-admin) returns 403; as an admin it triggers a rescan.
  2. An unauthenticated or expired-session request to `/api/notes`, `/api/highlights`, or `/api/progress` returns 401 (with a JSON error body), not an unhandled 500.
  3. A request from user A for user B's notes/highlights/progress returns nothing belonging to B and cannot mutate B's rows — proven by a passing automated test.
  4. The admin-only routes (`/api/users`, `/api/users/[id]`, `/api/locations`, `/api/fs`, `/api/scan`) reject non-admin and unauthenticated callers — proven by passing automated tests.
  5. `npm test` runs a Vitest suite that is part of the verification flow and is green.
**Plans**: TBD

Plans:
- [ ] 01-01: TBD
- [ ] 01-02: TBD

### Phase 2: OPDS Per-User Authentication
**Goal**: OPDS clients (android-reader and standard readers) authenticate per user against the documented contract, and progress reported over OPDS is attributed to the right account.
**Depends on**: Phase 1 (builds on the authorization model and the test harness; reuses the per-user isolation patterns and Vitest route tests)
**Requirements**: OPDS-01, OPDS-02, OPDS-03, OPDS-04
**Success Criteria** (what must be TRUE):
  1. An OPDS request to `/api/opds`, `/api/opds/all`, or `/api/opds/recent` with no credentials returns 401 with a `WWW-Authenticate: Basic realm="homelab-reader OPDS"` challenge.
  2. The same request with a valid per-user token over HTTP Basic (`base64(username:token)`) or `Authorization: Bearer <token>` returns 200 and the OPDS feed.
  3. A user can mint, label, list, and revoke API tokens in the web UI; the plaintext token is shown only once and is stored hashed at rest.
  4. Reading progress reported through the OPDS-authenticated path is attributed to that token owner's account, not anonymously or to another user.
  5. The implemented scheme matches `docs/OPDS-AUTH-CONTRACT.md` (Basic + Bearer accepted, opaque ≥32-byte token, hashed at rest, never logged) so android-reader interoperates.
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Resource Safety & Robustness
**Goal**: The container holds up under concurrent readers plus the background scanner without DB-lock errors, memory spikes, or silently-dropped books — and the scanner's reconcile branches are covered by tests.
**Depends on**: Nothing functionally (independent of Phases 1–2); may run in parallel or last. Reuses the Vitest harness from Phase 1 for scanner tests.
**Requirements**: ROBUST-01, ROBUST-02, ROBUST-03, ROBUST-04, ROBUST-05, TEST-03
**Success Criteria** (what must be TRUE):
  1. SQLite runs in WAL mode with a busy_timeout and a single writer connection; concurrent reader saves during a background scan no longer surface `SQLITE_BUSY` / "database is locked".
  2. A cold-start scan of a large library processes files through a concurrency-limited queue rather than firing every file event at once, keeping memory bounded.
  3. Downloading a book streams the file with HTTP Range support (a ranged request returns 206 with the requested byte range) instead of buffering the whole file in memory.
  4. PDF import reads each file once for both metadata and cover, with no second open of the same path.
  5. A malformed EPUB/PDF that fails extraction surfaces a visible "failed to import" signal in the UI instead of being silently dropped.
  6. Scanner tests cover the three `scanFile` branches (moved/hash-match, same-path content-changed, new file) and malformed-archive handling, using fixture files, and pass under `npm test`.
**Plans**: TBD
**UI hint**: yes

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3. Phase 3 is functionally independent of 1–2 and may be parallelized if capacity allows.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Authorization Hardening + Test Harness | 0/TBD | Not started | - |
| 2. OPDS Per-User Authentication | 0/TBD | Not started | - |
| 3. Resource Safety & Robustness | 0/TBD | Not started | - |
