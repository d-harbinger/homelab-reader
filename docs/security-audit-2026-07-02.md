# Security audit — 2026-07-02

Container privilege and hardening review of homelab-reader, benchmarked against
comparable self-hosted book servers (Kavita, Calibre-web) and 2025–2026 container
hardening guidance. Written as a standing reference; the slop/code audit lives
separately in `TEACHING.md`.

Each finding: **State** (what is true today) · **Why it matters** · **Verdict**
(aligned / gap / decision-for-operator).

---

## Scope and method

- **Reviewed:** `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`, the
  Content-Security-Policy and headers in `next.config.ts`, the authentication
  model (NextAuth credentials, first-run admin, per-user isolation), the
  filesystem-browse jail, and the dependency alert surface.
- **Verified live, not just read:** the production image was built and run in an
  isolated environment (loopback-bound port, throwaway data volume), and the full
  reader flow was driven end-to-end. Migrations applied, the scanner indexed a
  test library, both the PDF and EPUB readers rendered, and the browser console
  was checked for policy violations. This distinguishes "the config claims X"
  from "X actually holds at runtime."
- **Benchmarked against:** the LinuxServer.io Kavita image (the de-facto standard
  packaging for self-hosted book servers), Kavita's own remote-access guidance,
  and general container-hardening consensus for 2025–2026. Sources listed at the
  end.

## Threat model

homelab-reader is a **local-network appliance for a trusted network** — a
household or small team behind a router. The router performs network address
translation (NAT), so inbound traffic from the public internet does not reach the
service unless an operator explicitly forwards a port to it. Every judgment below
is calibrated to that model. The service is **not** intended to sit directly on
the public internet, and does not need to be hardened for that as long as it is
not placed there.

A useful frame: containers are not virtual machines. The application runs as an
ordinary process on the host's shared kernel; a "container" is that process given
a restricted *view* of the system through kernel **namespaces** (its own
filesystem root, process list, and network stack). The security question is
therefore: *if the application were compromised, how far could it reach?* The
findings below measure the size of that blast radius.

---

## Findings — container hardening (ranked by leverage)

### 1. Runs unprivileged, with all capabilities dropped and escalation blocked — ALIGNED (above peer norm)

- **State.** The runtime image creates a system user `nextjs` (uid 1001) and
  switches to it with `USER` before the app runs (`Dockerfile`). Compose drops
  **all Linux capabilities** (`cap_drop: ALL`) and sets
  `no-new-privileges: true`.
- **Why it matters.** By default a container runs as **root** (user id 0); a
  breakout from a root process lands as root on the host. Running unprivileged
  shrinks that. **Capabilities** are the ~40 individual powers that together make
  up root (bind low ports, load kernel modules, change file ownership, and so
  on); dropping all of them means even a process that somehow regained root inside
  the container could perform no privileged kernel operation. `no-new-privileges`
  closes the escalation path where a process gains *more* rights than it started
  with.
- **Verdict.** Aligned with — and stronger than — the reference peer. The
  LinuxServer.io Kavita image runs the app unprivileged via user/group remapping
  but documents **no** capability dropping and **no** `no-new-privileges`. This
  project applies both by default.

### 2. Library is mounted read-only — ALIGNED (above peer norm)

- **State.** The library bind mount is read-only (`:ro` in `docker-compose.yml`);
  the scanner only ever reads. The sole writable persistent surface is a
  Docker-managed named volume holding the database, cover cache, and signing
  secret.
- **Why it matters.** A read-only mount means the kernel refuses any write to the
  book files regardless of what the application code attempts — a compromised
  process cannot delete, alter, or encrypt the library. The blast radius for the
  irreplaceable data (the books) is zero; only the reconstructible data (database,
  covers) is writable.
- **Verdict.** Aligned and stronger than peer. The Kavita reference image mounts
  its library read-write because it manages files in place; homelab-reader's
  read-only posture is a deliberate, safer design for a read-focused server.

### 3. Filesystem browsing is jailed to a single root — ALIGNED

- **State.** The in-app "add a library folder" picker is confined to a single
  configured root (`FS_BROWSE_ROOT`, defaulting to the container's library mount
  point). It cannot traverse to arbitrary host paths.
- **Why it matters.** Without a jail, an administrative file picker becomes a
  read-anything primitive over whatever the process can see. Confining it to the
  library root keeps the feature from being repurposed to read unrelated host
  files.
- **Verdict.** Aligned. A dedicated test suite covers the jail (uniform errors,
  no escape above the root).

### 4. Minimal runtime image via multi-stage build — ALIGNED

- **State.** The image is built in stages (dependencies → build → runtime); the
  final image ships only the compiled standalone application. Build tools, source,
  and the package manager are not present in the runtime layer.
- **Why it matters.** Every tool inside the image is something an attacker could
  use after a compromise. A runtime image without a compiler, package manager, or
  test toolchain offers fewer building blocks. It also keeps development-only
  vulnerabilities (see finding 7) out of what actually runs.
- **Verdict.** Aligned with current best practice.

### 5. Content-Security-Policy is restrictive and correct — ALIGNED (fixed this pass)

- **State.** Response headers set a Content-Security-Policy (a browser rule that
  limits where the page may load scripts, styles, fonts, and data from),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, a strict
  `Referrer-Policy`, and a `Permissions-Policy` disabling camera, microphone,
  geolocation, and similar. During this audit the policy was found to block the
  EPUB reader's own stylesheets and fonts (delivered as `blob:` URLs), stripping
  code formatting from technical books; the `style-src` and `font-src` directives
  were extended to allow `blob:`, matching the existing image/worker allowances
  and staying strictly narrower than the `unsafe-inline` already present.
- **Why it matters.** A tight policy limits the damage of any injected content and
  reduces clickjacking and content-sniffing risk. The fix restored intended
  rendering without broadening the script surface.
- **Verdict.** Aligned. Re-verified in the running container: the EPUB reader now
  renders with zero console policy violations.

---

## Findings — application and dependencies

### 6. Authentication and per-user isolation — ALIGNED

- **State.** Sessions use NextAuth credentials: passwords are stored **bcrypt**-
  hashed (a deliberately slow one-way hash), sessions are JSON Web Tokens signed
  by a per-deployment secret that the setup step generates with a
  cryptographically-random source. First run creates the administrator; the
  administrator manages further accounts; each account's notes, highlights, and
  progress are isolated, covered by an isolation test suite.
- **Why it matters.** Hashing means the database never holds recoverable
  passwords; signing means sessions cannot be forged without the secret;
  isolation means one account cannot read another's annotations.
- **Verdict.** Aligned. Operator responsibility: keep the signing secret private
  (it lives in the data volume) and set a strong administrator password — hashing
  protects the stored value, but a weak password is still guessable by anyone who
  can reach the login page.

### 7. Dependency alerts — TRIAGED AND CLEARED

- **State.** Two open alerts at audit time, both for **vite** (a build-time
  development tool), pulled in transitively by the test toolchain:
  - `GHSA-fx2h-pf6j-xcff` (high) — a `server.fs.deny` bypass on Windows
    alternate paths.
  - `GHSA-v6wh-96g9-6wx3` (medium) — an NTLMv2 hash disclosure via Windows UNC
    path handling.
- **Why it matters — and why the real-world exposure was low.** Both are
  **development-scope** and are **not present in the runtime image** (the
  multi-stage build ships no build tooling, per finding 4). Both are also
  **Windows-specific**, while the container base is Linux (Alpine). The practical
  risk to a running deployment was therefore minimal — but stale dependencies are
  the single most common cause of self-hosted-service compromise, so they were
  patched regardless.
- **Verdict.** Cleared. An npm `overrides` pin lifts the transitive `vite` to a
  patched release (resolved to 8.1.3, above the 8.0.16 fix). The full test suite
  (214 tests) stays green after the bump.

---

## Findings — operator decisions (not code defects)

These are not weaknesses in the software; they are choices only the operator can
make, and they carry more of the real-world risk than the container internals.

### 8. Network exposure is the decision that matters most — DECISION FOR OPERATOR

- **State.** By default the service binds all interfaces on its host port
  (`0.0.0.0`), making it reachable by any device on the local network. The bind
  address and port are configurable.
- **Why it matters.** The container internals are well contained; the practical
  risk is *who can route to the port*. On a trusted network behind a router this
  is normal and fine. The failure mode is forwarding the port through the router
  to the public internet.
- **Recommendation (matches Kavita community guidance).**
  1. **Do not forward the port to the public internet.** This single choice is
     what separates "contained" from "exposed."
  2. For remote access, prefer a **mesh VPN** (for example a Tailscale/headscale
     tailnet) over a forwarded port — it requires no public exposure and is the
     approach Kavita's own documentation recommends.
  3. Optionally bind to loopback only and place a reverse proxy (for example
     Caddy) in front for HTTPS on the local network.

### 9. No transport encryption on its own — DECISION FOR OPERATOR

- **State.** The service speaks plain HTTP; there is no built-in TLS.
- **Why it matters.** On a trusted local network this is typically acceptable.
  Encryption in transit requires a reverse proxy terminating HTTPS, or access over
  an already-encrypted VPN.
- **Recommendation.** Add a reverse proxy for TLS, or reach the service over the
  VPN, if encrypted transport is wanted. Peer projects ship the same way (TLS is
  expected to be added by a proxy, not by the app).

### 10. No login rate-limiting yet — KNOWN GAP (deferred)

- **State.** The project's planning notes record login rate-limiting / lockout as
  deferred.
- **Why it matters.** Without it, the login endpoint does not slow repeated
  password guesses. On a trusted local network the risk is low; it would matter
  more under any exposure — another reason to keep the service off the public
  internet.
- **Recommendation.** Implement rate-limiting before any scenario that widens
  reachability beyond a trusted network.

### 11. No built-in backup of the data volume — KNOWN GAP

- **State.** Reading progress, notes, highlights, and accounts live in the named
  data volume. Docker volumes are not backed up automatically.
- **Why it matters.** The books themselves are safe (read-only source on disk),
  but the annotations and accounts exist only in the volume. Peer guidance treats
  an untested backup strategy as an availability risk in its own right.
- **Recommendation.** Schedule a periodic copy of the data volume (a database
  file plus covers) to separate storage, and test a restore.

---

## Peer comparison

| Hardening measure | homelab-reader | LinuxServer.io Kavita | Notes |
|---|---|---|---|
| Runs as non-root | Yes (from image build) | Yes (via user/group remap) | Both unprivileged |
| Drops all Linux capabilities | **Yes** | Not configured | homelab-reader stronger |
| `no-new-privileges` | **Yes** | Not configured | homelab-reader stronger |
| Library mounted read-only | **Yes** | No (read-write) | homelab-reader stronger |
| Minimal runtime image | Yes (multi-stage) | Yes | Comparable |
| Restrictive CSP + security headers | Yes | Not documented | homelab-reader stronger |
| Default network binding | All interfaces (LAN) | All interfaces (LAN) | Same; operator decision |
| TLS built in | No (proxy expected) | No (proxy expected) | Same industry norm |

Net: on the container internals, homelab-reader meets or exceeds the reference
peer on every measure, and matches the industry norm where it defers TLS and
network policy to the operator.

---

## Prioritized recommendations

1. **Keep the service on the local network or a VPN; never forward its port to
   the public internet.** Highest-leverage single control.
2. **Set a strong administrator password** and keep the signing secret private.
3. **Patch the dependency alerts** — done this pass (vite pinned to a patched
   release); keep the monthly update habit, since stale images are the most common
   compromise cause.
4. **Back up the data volume** on a schedule and test a restore.
5. **Add TLS via a reverse proxy** or use an encrypted VPN if transport encryption
   is wanted.
6. **Add login rate-limiting** before widening reachability beyond a trusted
   network.

---

## Verification gate

What was actually exercised for this audit, versus asserted:

- **Verified in a running container:** image build, migration apply, library scan,
  PDF and EPUB rendering, CSP behavior (before and after the fix), and that the
  test suite passes after the dependency bump (214 tests green).
- **Reviewed statically:** Dockerfile / compose privilege settings, the auth model,
  and the filesystem-browse jail.
- **Not tested here (operator-side):** live behavior of a reverse proxy, VPN
  reachability, and a data-volume backup/restore cycle. Those depend on the target
  deployment and are the operator's to confirm.

## Sources

- [kavita — LinuxServer.io](https://docs.linuxserver.io/images/docker-kavita/)
- [docker-calibre — LinuxServer.io (GitHub)](https://github.com/linuxserver/docker-calibre)
- [Remote Access — Reverse Proxy — Kavita Wiki](https://wiki.kavitareader.com/installation/remote-access/)
- [How to Self-Host Kavita 2026 — OSSAlt](https://ossalt.com/guides/how-to-self-host-kavita-digital-library-server-2026)
- [Docker Engine security — Docker Docs](https://docs.docker.com/engine/security/)
- [Docker Image Security Best Practices: SBOM, Non-Root, Provenance — BellSoft](https://bell-sw.com/blog/docker-image-security-best-practices-for-production/)
- [8 Container Security Best Practices for 2026 — Orca Security](https://orca.security/resources/blog/container-security-best-practices/)
