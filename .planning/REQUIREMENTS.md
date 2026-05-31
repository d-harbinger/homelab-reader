# Requirements — homelab-reader completion milestone

Scope: harden the shipped app to "complete" — close authorization gaps,
enforce the documented OPDS auth, make the container resource-safe under real
multi-user load, and establish the test suite. Derived from
`.planning/codebase/CONCERNS.md` (every item cited to `file:line` there).

## v1 Requirements

### Authorization (AUTHZ)

- [x] **AUTHZ-01**: Only an admin can trigger a library rescan — `POST /api/scan` rejects non-admin sessions with 403
- [x] **AUTHZ-02**: An unauthenticated or expired-session request to a data route (notes, highlights, progress) receives a 401, not a 500
- [x] **AUTHZ-03**: A user cannot read or mutate another user's notes, highlights, or progress (proven by automated tests, not just current code)
- [x] **AUTHZ-04**: Admin-only routes (`/api/users`, `/api/users/[id]`, `/api/locations`, `/api/fs`, `/api/scan`) reject non-admin and unauthenticated callers (proven by automated tests)

### OPDS authentication (OPDS)

- [x] **OPDS-01**: OPDS endpoints (`/api/opds`, `/api/opds/all`, `/api/opds/recent`) require valid per-user credentials via HTTP Basic or Bearer, per `docs/OPDS-AUTH-CONTRACT.md`
- [x] **OPDS-02**: An unauthenticated OPDS request receives a 401 with a `WWW-Authenticate` challenge; valid credentials return the feed
- [x] **OPDS-03**: Reading progress reported through the OPDS-authenticated path is attributed to that user's account
- [x] **OPDS-04**: The OPDS auth scheme interoperates with android-reader as specified in the cross-repo contract (verified against the contract doc)

### Resource safety & robustness (ROBUST)

- [ ] **ROBUST-01**: SQLite runs in WAL mode with a busy_timeout and a single writer connection, so concurrent reader saves and the background scanner do not surface `SQLITE_BUSY` / "database is locked"
- [ ] **ROBUST-02**: A cold-start scan of a large library processes files through a concurrency-limited queue rather than firing every file event at once
- [ ] **ROBUST-03**: Downloading a book streams the file with HTTP Range support instead of buffering the whole file in memory
- [ ] **ROBUST-04**: PDF import reads each file once for both metadata and cover (no second open of the same path)
- [ ] **ROBUST-05**: A malformed EPUB/PDF that fails extraction surfaces a visible "failed to import" signal in the UI instead of being silently dropped

### Test suite (TEST)

- [x] **TEST-01**: A Vitest harness is configured with a `test` script and runs in the project's verification flow
- [x] **TEST-02**: Route-level tests cover per-user isolation (AUTHZ-03) and the authorization gates (AUTHZ-04, AUTHZ-01)
- [ ] **TEST-03**: Scanner tests cover the three `scanFile` branches (moved/hash-match, same-path content-changed, new file) and malformed-archive handling, using fixture files

## v2 Requirements (deferred)

- Login rate limiting / lockout (before any internet exposure)
- Transactional first-admin creation (close the setup TOCTOU window fully)
- OPDS feed pagination (past a few thousand titles)
- Confine `/api/fs` browse root to mounted volumes
- Per-user data export / backup API (android-reader annotation sync)

## Out of Scope

- Per-user library scoping (who sees which books) — current model is a shared household library
- EPUB reader refactor (`EpubReader.tsx`) — fragile but working; not completion work
- Postgres migration — not warranted at household scale

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTHZ-01 | Phase 1 | Complete |
| AUTHZ-02 | Phase 1 | Complete |
| AUTHZ-03 | Phase 1 | Complete |
| AUTHZ-04 | Phase 1 | Complete |
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| OPDS-01 | Phase 2 | Complete |
| OPDS-02 | Phase 2 | Complete |
| OPDS-03 | Phase 2 | Complete |
| OPDS-04 | Phase 2 | Complete |
| ROBUST-01 | Phase 3 | Pending |
| ROBUST-02 | Phase 3 | Pending |
| ROBUST-03 | Phase 3 | Pending |
| ROBUST-04 | Phase 3 | Pending |
| ROBUST-05 | Phase 3 | Pending |
| TEST-03 | Phase 3 | Pending |

**Coverage: 16/16 v1 requirements mapped to exactly one phase. No orphans, no duplicates.**
