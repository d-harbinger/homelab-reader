# android-reader ⇄ homelab-reader — OPDS client handoff

Companion to `docs/OPDS-AUTH-CONTRACT.md`. That document pinned the wire
contract; this one records that the **server side (homelab-reader) is now
implemented**, states exactly what is live, and seeds the client-side work so
the android-reader repo can start its own automation against a real target.

## The two-device story (why this exists)

android-reader (a Readium-based EPUB reader for GrapheneOS) reads on mobile;
homelab-reader serves the LAN library and bridges to android-reader over OPDS.
Same library, same notes shape, same privacy posture. This milestone is the
OPDS auth + sync layer that connects them — the Readium reading core already
exists on the client.

## Server status — as implemented (homelab-reader milestone v1.0)

The contract is now **enforced in code** (source-complete; host behavioral
verification was still pending at the time of writing — confirm against a
running instance before relying on it):

- **Protected endpoints.** All OPDS routes require per-user auth:
  `GET /api/opds`, `/api/opds/all`, `/api/opds/recent`.
- **Transport.** The server accepts BOTH `Authorization: Basic
  base64(username ":" token)` AND `Authorization: Bearer <token>`.
- **Failure.** No/invalid credentials → `401` with
  `WWW-Authenticate: Basic realm="homelab-reader OPDS"`.
- **Tokens.** Opaque, URL-safe, ≥32 bytes (base64url). A user mints them in the
  web UI at `/settings/tokens` — shown in plaintext exactly once, hashed at rest
  (SHA-256), labelled, listable, and revocable. Constant-time compared server-side.
- **Progress attribution.** `POST /api/opds/progress` (token-authenticated)
  records reading position against the token owner's account, and
  `GET /api/opds/progress?bookId=...` reads it back for that account — so
  position can round-trip over the OPDS path.
- **Book bytes.** `GET /api/books/[id]/file` now supports HTTP **Range** —
  `206 Partial Content` + `Content-Range`, `Accept-Ranges: bytes`, RFC 7233
  suffix ranges — i.e. resumable / partial downloads.

## What android-reader (client) owns — the work to build

From the contract's client responsibilities:

1. **Settings** — enter server URL + username + token.
2. **Secure storage** — keep the token in Android encrypted storage (Keystore /
   EncryptedSharedPreferences); never plaintext prefs.
3. **Auth header** — send `Authorization: Basic base64(username ":" token)` on
   every OPDS request (Basic is preferred for OPDS-client compatibility; Bearer
   also works server-side).
4. **Re-auth flow** — on `401`, surface a re-auth prompt rather than failing
   silently.
5. **Catalog browse** — fetch and parse the OPDS feeds (`/api/opds` → `/all`,
   `/recent`); list titles, authors, covers.
6. **Acquire + read** — download a book via `/api/books/[id]/file`, using Range
   requests for resumable downloads on flaky mobile networks; open in Readium.
7. **Progress sync** — report position with `POST /api/opds/progress` and read
   it back with `GET /api/opds/progress?bookId=...` so the same position follows
   the reader across devices.

## Suggested GSD seed for android-reader

**Milestone:** "OPDS sync with homelab-reader" — wire the existing Readium
reader to the homelab-reader library over the now-live OPDS auth contract.

Candidate phases (coarse):

1. **Auth & settings** — server URL / username / token entry, encrypted token
   storage, Basic auth header on every request, the 401 re-auth flow.
2. **Catalog browse** — fetch + parse the OPDS feeds, render the library
   (titles, covers).
3. **Acquire & read** — Range-aware download from `/file`, hand off to Readium.
4. **Progress sync** — report position (`POST /api/opds/progress`) and read it
   back (`GET /api/opds/progress?bookId=...`).

## Open / negotiable (carried from the contract)

- **Basic vs Bearer** — the client should pick **Basic** (best OPDS-client
  compatibility); flag it here or in the contract doc if Bearer is preferred.
- **Token scope** — global-per-user for v1 (one token unlocks the whole
  catalog); per-library scoping is a later milestone.
- **Transport security** — HTTPS recommended (Basic sends the token each
  request); plain http on a trusted LAN is the operator's call.

## Starting the automation

From the android-reader repo (a sibling of this one), map the existing codebase
first, then seed a milestone against this handoff:

```
/gsd:map-codebase
/gsd:new-milestone        # reference ../homelab-reader/docs/ANDROID-READER-HANDOFF.md
```

The server contract is the fixed target; the client milestone above is the
proposed shape. Counter or refine on the android-reader side.
