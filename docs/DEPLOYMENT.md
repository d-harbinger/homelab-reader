# Deployment

Operational notes for running homelab-reader as a self-hosted container.

## SQLite under concurrent use

The server runs a background folder scanner (chokidar) that writes to the
database while readers simultaneously save notes, highlights, and progress.
SQLite allows only one writer at a time, so this workload must be tuned or it
surfaces `SQLITE_BUSY` / "database is locked" errors.

Three settings work together:

1. **WAL journal mode** and **`busy_timeout=5000`** are applied once at server
   boot by `applySqlitePragmas()` (called from the instrumentation hook before
   the watcher starts). WAL lets readers proceed while a single writer is
   active; the busy timeout makes a contending statement wait up to five
   seconds for the lock to clear instead of failing immediately. WAL is durable
   in the database file, so it persists across restarts.

2. **`?connection_limit=1`** on `DATABASE_URL` tells Prisma to use a single
   pooled connection. This serializes writers at the connection-pool level so
   the application queues instead of fighting over the write lock.

### Required `DATABASE_URL` form

The database URL must carry `?connection_limit=1`. Using placeholder paths
(substitute the actual data directory for the deployment):

```
# Local / project-relative (resolves relative to prisma/schema.prisma):
DATABASE_URL="file:../data/homelab-reader.db?connection_limit=1"

# Docker — the database lives on the bind-mounted /data volume:
DATABASE_URL="file:/data/homelab-reader.db?connection_limit=1"
```

The Docker container bind-mounts a host directory to `/data` (database + cover
cache) and the library to `/books` (read-only). The exact host paths are
deployment-specific and are never committed; supply them via the compose file
or environment on the host.

WAL also creates `-wal` and `-shm` sidecar files next to the database. The
`/data` volume must be writable for these; a read-only `/data` mount silently
falls back and re-introduces lock contention.
