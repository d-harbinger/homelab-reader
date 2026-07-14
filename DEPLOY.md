# Deploying homelab-reader

The deployment contract for running homelab-reader as a self-hosted
container. It follows the workspace deploy lifecycle
(`dev-tools/docs/deploy-lifecycle.md`): one ruled road, one server runbook,
the environment contract, the backup/restore story, and a rollback line.

homelab-reader is a Next.js app backed by SQLite (via Prisma). The database,
cover cache, and generated auth secret live in a Docker named volume; the book
library is bind-mounted read-only from the host. That split is what makes the
redeploy safe: code is replaced, data is not.

## Release road — Road A (pull + build on the server)

**Ruled road: Road A — pull the source on the server and build the image
there.** The push to the default branch is the deploy input; the pre-push
ship-boundary gate is therefore the deploy gate. No image registry is involved.

> **Status: recommended default, owner confirmation pending** (2026-07-12
> deploy-consistency audit, item 5). homelab-reader has run Road A by practice;
> this line writes it down. The road is confirmed in the owner's morning batch.

Why Road A fits this app: it holds a personal library and its notes as the
record of truth, it runs on one homelab box, and it has no release-tag or
multi-server distribution need that would justify a registry image (Road B).

## Server runbook

### First-time setup

Interactive path — `./launch.sh` asks where the books live and which network to
serve, saves the answers to `.env`, and starts the app. After setup it doubles
as the on-site menu (start/restart, status, recent logs, update), and every
action is safe to run repeatedly. The manual steps below are the canonical
equivalent.

```sh
# 1. Clone the repo onto the server (any directory).
git clone https://github.com/d-harbinger/homelab-reader.git
cd homelab-reader

# 2. Activate the privacy-guard commit hook (once per clone).
git config core.hooksPath scripts/hooks

# 3. Point the container at the library. Persist it in .env (gitignored):
echo 'BOOKS_HOST_PATH=/srv/books' > .env
#    (If unset, it falls back to ./books inside the repo directory.)

# 4. Build and start.
docker compose up -d --build

# 5. Open the app at http://<server>:5456
#    The first scan takes roughly a minute per ~100 books (cover rendering).
```

Copy `.env.example` to `.env` for the full set of tunable variables (see the
env contract below). `.env` is gitignored and never committed.

### Redeploy invariant

Every redeploy is the same five steps — nothing more. If an update ever needs
extra steps, that is a defect in this document, not a fact of the deployment.

```sh
# 1. Pull the ruled source.
git pull

# 2. Rebuild and restart. The old container is replaced; the data volume
#    and the read-only book mount are untouched.
docker compose up -d --build

# 3. Migrations self-apply. The entrypoint runs `prisma migrate deploy`
#    against the volume DB before the server boots. If a migration fails the
#    container refuses to start and prints a diagnostic banner — it never
#    boots in a half-migrated state, and migrate deploy never resets data.

# 4. Healthcheck. Compose has a built-in check hitting /api/scan/status;
#    confirm the container reports healthy.
docker compose ps

# 5. LAN reachability. Confirm the client that matters can reach it.
curl -fsS http://<server>:5456/api/scan/status && echo OK
```

### Day-to-day operations

```sh
docker compose logs -f homelab-reader   # tail logs
docker compose restart homelab-reader   # restart only
docker compose down                     # stop (keeps the data volume)
docker compose up -d --build            # apply code changes
```

**Adding books** — drop `.epub` or `.pdf` files into the host folder that
`BOOKS_HOST_PATH` points at. The scanner picks them up within a few seconds. To
force a full rescan, use "Rescan" (top-right in the UI). To remove a book,
delete the file from disk; the scanner reconciles on the next boot or rescan.
The scanner never writes into the library mount.

## Environment contract

Set these in `.env` next to `docker-compose.yml` on the server. The container
always listens on internal port 3000; the host publish address and port map to
it.

| Variable | Default (as committed today) | Purpose |
|---|---|---|
| `HOMELAB_HOST_BIND` | `127.0.0.1` | Host interface the container publishes on. `127.0.0.1` (the committed default) restricts access to the machine itself; set `0.0.0.0` to make it reachable from other devices on the local network (the usual homelab case — e.g. feeding android-reader over OPDS). See the breaking-change note below. |
| `HOMELAB_PORT` | `5456` | Host port. Follows the sibling scheme (chimera 5454, chef-calc-pro 5455, homelab-reader 5456). |
| `BOOKS_HOST_PATH` | `./books` | Host directory holding the library; bind-mounted read-only at `/app/books`. |
| `AUTH_SECRET` | *(auto-generated)* | NextAuth secret. If unset, the entrypoint generates one and persists it to the data volume on first run. Set explicitly with `openssl rand -base64 32` to control it. |

The published port line in `docker-compose.yml` is
`"${HOMELAB_HOST_BIND:-127.0.0.1}:${HOMELAB_PORT:-5456}:3000"`. The bind address
is the real firewall here — a Docker published port bypasses the host firewall,
so the interface it binds to is what limits who can reach the app.

> ## ⚠️ Breaking default change — the committed bind is now loopback
>
> **What changed:** the committed default for `HOMELAB_HOST_BIND` flipped from
> `0.0.0.0` (all interfaces, reachable across the local network) to `127.0.0.1`
> (loopback — the machine itself only). This aligns homelab-reader with the
> workspace ship-boundary doctrine: ship closed, open on purpose.
>
> **Who this affects:** any existing deployment that reaches the app from
> another device — a browser on a laptop, android-reader pulling over OPDS.
> After a redeploy that picks up this change, the app will answer only on the
> server itself and every other device will see the connection refused.
>
> **What to do — set the LAN opt-in before redeploying.** On the server, add
> this one line to the `.env` next to `docker-compose.yml`, then redeploy:
>
> ```sh
> echo 'HOMELAB_HOST_BIND=0.0.0.0' >> .env
> docker compose up -d --build
> ```
>
> This restores network reachability. Confirm with the LAN-reachability check in
> the redeploy invariant above (`curl` from a device that matters). A
> first-time deployment following the runbook already copies `.env.example`,
> which documents this variable, so new installs simply set it during setup.

### `DATABASE_URL` and SQLite under concurrent use

The server runs a background folder scanner (chokidar) that writes to the
database while readers simultaneously save notes, highlights, and progress.
SQLite allows only one writer at a time, so this workload must be tuned or it
surfaces `SQLITE_BUSY` / "database is locked" errors. Two mechanisms work
together:

1. **WAL journal mode** and **`busy_timeout=5000`** are applied once at boot by
   `applySqlitePragmas()` (called from the instrumentation hook before the
   watcher starts). WAL lets readers proceed while a single writer is active;
   the busy timeout makes a contending statement wait up to five seconds for
   the lock to clear instead of failing immediately. WAL is durable in the
   database file, so it persists across restarts.

2. **`?connection_limit=1`** on `DATABASE_URL` tells Prisma to use a single
   pooled connection, serializing writers at the pool level so the application
   queues instead of fighting over the write lock.

The database URL must carry `?connection_limit=1`. Using placeholder paths
(substitute the actual data directory for the deployment):

```
# Local / project-relative (resolves relative to prisma/schema.prisma):
DATABASE_URL="file:../data/homelab-reader.db?connection_limit=1"

# Docker — the database lives on the mounted /app/data volume:
DATABASE_URL="file:/app/data/homelab-reader.db?connection_limit=1"
```

WAL also creates `-wal` and `-shm` sidecar files next to the database. The data
volume must be writable for these; a read-only data mount silently falls back
and re-introduces lock contention.

## Where the data lives (volume layout)

| Mount | Kind | Contents |
|---|---|---|
| `/app/data` | named volume `homelab-reader-data` | SQLite DB + `-wal`/`-shm` sidecars, cover cache, persisted `AUTH_SECRET` |
| `/app/books` | read-only bind mount (`BOOKS_HOST_PATH`) | the library — never written by the app |

The named volume is pinned via `name: homelab-reader` in the compose file so it
resolves to a stable identifier regardless of the host directory's name.
Everything the app generates lives in that one volume; the library on disk is
independent and read-only.

## Backup and restore

Because all mutable state is in the `homelab-reader-data` volume, backing up the
deployment means backing up that volume. The library itself is the original
files on disk — back those up with the rest of the host's storage.

```sh
# Back up the data volume (DB + covers + auth secret) to a tarball.
docker run --rm \
  -v homelab-reader-data:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/homelab-reader-data.tar.gz -C /data .

# Restore into a fresh (stopped) deployment.
docker compose down
docker run --rm \
  -v homelab-reader-data:/data \
  -v "$PWD":/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/homelab-reader-data.tar.gz -C /data"
docker compose up -d --build
```

For a consistent copy, stop the container first (`docker compose down`) so no
writer is mid-transaction; the `:ro` snapshot above is adequate for a running
box, but a stopped snapshot is the safe default.

**Start fresh (discard all app data, keep the library):**

```sh
docker compose down
docker volume rm homelab-reader_homelab-reader-data
docker compose up -d --build   # books re-scan from /app/books on boot
```

## Rollback

Road A rolls back to the previous commit with the data volume intact:

```sh
git checkout <previous-good-commit>
docker compose up -d --build
```

The volume is never touched by a rebuild, so a rollback restores the prior code
against the same data. The one caveat is schema migrations: `migrate deploy`
does not roll migrations back. If a bad deploy applied a new migration, roll the
code back and — if the older code cannot read the newer schema — restore the
data volume from the pre-deploy backup (above) before starting. Taking a volume
backup before any redeploy that includes a migration is the cheap insurance.

## What talks to the internet (privacy contract)

By default: **nothing.** A fresh install serves the library, reader,
notes, and shelves entirely from the box; no request ever leaves it.

There is exactly one optional outbound integration, and it is off until
a human turns it on:

- **OpenLibrary lookups** — fills in missing covers, authors, and
  shelves by querying `openlibrary.org` (a free service run by the
  nonprofit Internet Archive). When enabled, each lookup sends the
  book's **title, author, and ISBN** — plus, as with any internet
  request, the server's IP address — so OpenLibrary can see which books
  are looked up. Lookups fire only on two
  triggers, both visible in the UI: importing a book with thin embedded
  metadata, and the Sort page's "look shelves up online" button
  (batched and rate-limited out of respect for a community service).

The choice is asked once, in plain language, as the second step of
first-run setup, and can be changed at any time under **Settings →
Privacy** (admin only). The consent is stored in the database
(`AppSetting.onlineLookups`), so it survives updates and restarts and
travels with the data volume. When off, the lookup endpoints refuse to
run and the import-time enrichment is skipped — not hidden, disabled.

Any future feature that sends anything anywhere gets the same
treatment: named in this section, off by default, consented in the UI.
