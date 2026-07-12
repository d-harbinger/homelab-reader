# OPDS authentication — cross-repo contract

Coordination artifact between **homelab-reader** (OPDS server) and **android-reader**
(OPDS client). It pins the *wire contract* so the two sides can be built independently —
separate repos, two machines — and meet in the middle. Proposed by machine-A (the
homelab-reader side); the android-reader side may counter here or via
`claude-settings/docs/handoff.md`.

## The scheme: per-user API token ("app password")

OPDS is consumed by a machine client, not a browser, so it does **not** use the web
NextAuth cookie session. Each user mints one or more **API tokens** in the homelab-reader
web UI — a stateless, revocable credential the mobile client stores and sends on every
request. Doesn't reuse the login password; revocable without changing it.

## Wire contract — the part both sides MUST agree on

- **Transport.** The client sends **HTTP Basic** on every OPDS request:
  `Authorization: Basic base64(username ":" token)`. The server MUST also accept
  `Authorization: Bearer <token>` as an alternative.
- **Token format.** Opaque, URL-safe, ≥32 bytes of entropy (base64url, no padding).
  A secret — never logged, shown in plaintext only once at mint time.
- **Protected endpoints.** All OPDS routes: `/api/opds`, `/api/opds/recent`,
  `/api/opds/all`, the progress path `POST /api/opds/progress` (write) and
  `GET /api/opds/progress?bookId=...` (read), and any future OPDS path.
- **Success.** `200` + the OPDS feed, exactly as today.
- **Failure.** `401 Unauthorized` with `WWW-Authenticate: Basic realm="homelab-reader OPDS"`
  so standard OPDS clients prompt for credentials.
- **Transport security.** LAN deployment; HTTPS strongly recommended (Basic sends the token
  each request). Plain http on a trusted LAN is the operator's call — the contract is unchanged.

## homelab-reader (server, machine-A) owns

- Prisma model for tokens, **hashed at rest** (store the hash, not the token).
- A guard on the OPDS routes: accept Basic or Bearer, constant-time compare, `401` otherwise,
  bump `lastUsedAt`.
- Web UI to mint (copy-once), label, list, and revoke tokens.

## android-reader (client, machine-B) owns

- Settings to enter `server URL + username + token`.
- Store the token in Android encrypted storage (Keystore / EncryptedSharedPreferences) —
  never plaintext prefs.
- Send `Authorization: Basic …` on every OPDS request; on `401`, surface a re-auth prompt
  rather than failing silently.

## Negotiable / open

- **Basic vs Bearer:** server supports both; client should pick **Basic** (best OPDS-client
  compatibility). Speak up if android-reader prefers Bearer.
- **Token scope:** **global per user** for v1 (one token unlocks the whole catalog).
  Per-library scoping is a later milestone.
- **Username field:** the user's homelab-reader account username (Bearer works with the token
  alone, server-side).

— machine-A, 2026-05-30. Counter or accept in `claude-settings/docs/handoff.md`.
