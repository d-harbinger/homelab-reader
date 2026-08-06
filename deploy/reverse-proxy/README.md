# Reverse proxy (Caddy) — activation runbook

One TLS front door for the homelab app stack, and the retreat of each app from
a network-wide plaintext port to a loopback bind behind it.

This directory holds the proxy that fronts every self-hosted app on the
services host, not just this one. It lives here because the shape was worked
out here; nothing in it is specific to the reading library.

## Read this first: the pairing is the point

Bringing up TLS is only half the change.

The apps are currently published on a broad bind, so each one answers on the
services host's local-network address over plain HTTP. Putting a proxy in front
adds an encrypted path — it does not remove the unencrypted one. Anything on
the local network can keep talking to the app's raw port in the clear, and
will, because that is the address it already has.

**TLS without the bind retreat is decoration.** Both halves have to land, in
this order, per app:

1. the app becomes reachable through the proxy, over TLS, by name, and
2. the app stops publishing its port anywhere except loopback.

Stage 4 is the first half; stage 5 is the second. An app that stops at stage 4
is no safer than before, only more convenient. The stages are split anyway,
because splitting them is what makes each one reversible on its own.

The transport underneath matters less than it sounds. Traffic between mesh
nodes is already encrypted by the mesh, so a phone off the home network was
never sending credentials in clear across the internet. The exposure this
closes is the local network: everything on it can read every request to every
app, and the reading library's catalog feed authenticates with HTTP Basic,
which puts a credential on the wire on every request. A network that is not
assumed friendly is the whole premise — no discount for being at home.

## How it fits together

```
device ──tls──> Caddy (:443) ──internal docker network──> <app>:3000
                     │
                     └── each app publishes only on loopback, for debugging
```

Caddy owns 443 on the services host. Each app joins a shared Docker network and
Caddy reaches it by container name on its internal port. The app's published
host port drops to loopback: still there for a shell on the box, unreachable
from anywhere else.

Names come from a single zone, held in `.env` as `PROXY_ZONE`, so no
site-specific name is committed:

| Site | Container | Internal port | Host port before cutover |
|---|---|---|---|
| `dashboard.<zone>` | `chimera` | 3000 | 5454 |
| `kitchen.<zone>` | `chef-calc-pro` | 3000 | 5455 |
| `reader.<zone>` | `homelab-reader` | 3000 | 5456 |
| `music.<zone>` | `homelab-music` | 3000 | 5457 |
| `globe.<zone>` | `open-earth-viewer` | 4321 | 5458 |
| `books.<zone>` | `homelab-banking` | 3000 | 5459 — commented out until it runs |

The bind variable differs per app for historical reasons. All six take the same
kind of answer:

| App | Bind variable |
|---|---|
| chimera | `CHIMERA_BIND` |
| chef-calc-pro | `CHEF_CALC_PRO_BIND` |
| homelab-reader | `HOMELAB_HOST_BIND` |
| homelab-music | `MUSIC_HOST_BIND` |
| open-earth-viewer | `OEV_BIND` |
| homelab-banking | `BANKING_BIND` |

## What this does not cover

**File sharing.** The services host also serves SMB, which is not HTTP and
cannot be fronted by this proxy. Its exposure on the local network is a
separate decision and is not improved by anything in this document. On the mesh
it is already unreachable — the access policy grants it to nothing.

---

## Stage 0 — record the starting state

From a shell on the services host:

```sh
ss -ltnp | grep -E ':545[4-9]'      # which app ports listen, and on what address
docker network ls | grep homelab-proxy
```

Expect the app ports bound broadly, and no shared network yet. Keep the output:
stage 5's verification is this same command producing loopback addresses.

Then, from a local-network client that is **not** a mesh member, confirm the
plaintext path that is about to be closed actually exists:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' http://<services-host>:5456/
```

A response here is the problem being solved. Stage 5 turns it into a refusal.

## Stage 1 — bring the proxy up, changing nothing else

```sh
cd deploy/reverse-proxy
docker network create homelab-proxy          # once, ever
cp .env.example .env                         # then fill in PROXY_ZONE and PROXY_BIND
docker compose config -q                     # exit 0 = the file parses and resolves
docker compose up -d
docker compose logs -f caddy
```

`PROXY_BIND` is a real decision, not a formality:

- `0.0.0.0` — the proxy answers on the local network and over the mesh. Choose
  this if any local-network client needs the apps.
- the services host's own mesh address — the proxy answers **only** to enrolled
  devices, and the access policy governs which of them. Tighter, and it means
  local-network clients either join the mesh or lose access. Worth choosing
  deliberately rather than by omission.

Every app still answers on its own port exactly as before. Nothing has been
taken away yet.

**Verify:** from the services host itself, ask the proxy for a name it serves.
It will fail to reach the app — no app has joined the shared network yet — and
that failure is the expected result. What is being checked is that Caddy
answered at all, over TLS:

```sh
curl -kIsS https://reader.<zone>/ --resolve reader.<zone>:443:127.0.0.1 | head -1
```

A `502` proves the proxy is up, terminating TLS, and routing by name.
Connection refused means it is not listening; read `docker compose logs caddy`.

**Reverse this stage:** `docker compose down`. Nothing else was touched.

## Stage 2 — make the names resolve

The names have to resolve on both kinds of client, and they resolve to
different addresses on each. That is fine; the certificate covers the name, not
the address.

**Over the mesh.** The coordination server can push extra DNS records to every
enrolled device. In its `config.yaml`:

```yaml
dns:
  extra_records:
    - { name: "reader.<zone>", type: "A", value: "<services-host mesh address>" }
    - { name: "dashboard.<zone>", type: "A", value: "<services-host mesh address>" }
    # …one per site in the Caddyfile
```

Restart the coordination server for the change to take. Records can also live
in a separate JSON file via `extra_records_path`, which is re-read on change
and avoids a restart for later edits — worth using if the list will grow.

**On the local network.** Either add the same names to whatever resolver the
network runs, or add a hosts-file entry per client pointing at the services
host's local address. The hosts-file route is fine for two or three machines
and unpleasant beyond that.

**Verify:** from the phone over the mesh, and from a local-network client,
resolve one name and confirm each gets the address appropriate to where it is.

**Reverse this stage:** remove the records. Nothing depends on them yet.

## Stage 3 — trust the local certificate authority

Caddy issues these certificates from its own root, because the names are
private and no public authority can vouch for them. Until that root is trusted,
every client shows a warning and command-line tools refuse.

Export it once:

```sh
cd deploy/reverse-proxy
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

Install `caddy-root.crt` in each client's trust store. This is per-device, and
on a phone it is a settings flow rather than a command — budget a few minutes
per device. Do not commit the exported file.

**Verify:** the browser stops warning; on a command line, `curl` succeeds
**without** `-k`:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' --cacert ./caddy-root.crt https://reader.<zone>/
```

Accepting the browser warning instead is possible and is a bad habit to build:
it trains the reflex that makes a real certificate error invisible.

**Reverse this stage:** remove the root from the trust store.

## Stage 4 — route one app through the proxy

Do exactly one app, start to finish, before touching the next. The reading
library is the natural first, because its authentication is the most exposed
without TLS.

1. **Join the app to the shared network.** In the app's compose file:

   ```yaml
   services:
     homelab-reader:
       networks: [default, homelab-proxy]
   networks:
     homelab-proxy:
       name: homelab-proxy
       external: true
   ```

2. **Tell the app its public address**, so authentication redirects and cookies
   are issued for the name clients actually use. The variable differs per app —
   check that repo's `.env.example`. For the NextAuth-based apps it is:

   ```
   NEXTAUTH_URL=https://reader.<zone>
   AUTH_TRUST_HOST=true
   ```

   The globe viewer needs no such variable: it reads `X-Forwarded-Proto`, which
   Caddy sets, to decide whether its session cookie gets the `Secure` flag.

3. **Redeploy the app.** The published port is unchanged at this stage — the
   old path stays open on purpose, as the fallback.

**Verify:** the app loads over `https://<name>.<zone>/` from the phone and from
a local-network client, signs in, and keeps the session across a page load. A
sign-in that loops or lands back on the login page almost always means step 2's
public address is wrong or missing.

**Reverse this stage:** remove the network join and the public-address
variables, redeploy. The app is exactly where it was, and the old port never
stopped working.

## Stage 5 — retreat the bind, one app at a time

This is the stage that closes the plaintext path. Do it for the app just proven
in stage 4, immediately after, so the two halves stay paired.

In the app's `.env`, set its bind variable to loopback:

```
HOMELAB_HOST_BIND=127.0.0.1
```

Redeploy. The port is still published, but only on the host's own loopback
interface: reachable from a shell on the box for debugging, reachable from
nothing else.

**Verify — three checks, and all three matter:**

| From | Command | Expected |
|---|---|---|
| the services host | `ss -ltnp \| grep :5456` | bound to loopback, not a broad address |
| a local-network client, not a mesh member | `curl --max-time 5 http://<services-host>:5456/` | **connection refused, or a timeout** |
| the phone, over the mesh | open `https://reader.<zone>/` | still loads normally |

The middle row is the one this stage exists for. If it still answers, the
redeploy did not pick up the new bind — check the container was recreated
rather than merely restarted.

**Reverse this stage:** set the bind variable back and redeploy. One line, one
command, and the old path returns.

Then repeat stages 4 and 5 for the next app. Six apps, one at a time; a bad
evening costs one app, not the stack.

## Stage 6 — narrow the mesh access policy

Once every app is behind the proxy and bound to loopback, the per-app port
grants in the mesh access policy point at ports nothing can reach any more, and
a single grant for the proxy port replaces them.

That change lives with the policy, in the mesh repository's rollout document —
including the ordering that keeps a working path at every moment: add the proxy
grant and verify it **first**, remove the app grants **second**.

## Stage 7 — final sweep

The point of the exercise, confirmed rather than assumed. From a local-network
client that is not a mesh member:

```sh
for p in 5454 5455 5456 5457 5458; do
  printf '%s: ' "$p"
  curl --max-time 5 -sS -o /dev/null -w '%{http_code}\n' "http://<services-host>:$p/" || echo refused
done
```

Every line should refuse or time out. Any line returning a status code is an
app that got a proxy route but never a bind retreat — stage 4 without stage 5,
the exact half-finished state this document is arranged to prevent.

Then, from the phone over the mesh: every app loads over `https://` by name,
and nothing loads on a raw port.

## Where the checks have to run

Every verification here runs against the live network, from a device on it.
None can be performed from a build environment — a sandbox can confirm the
compose file parses and the Caddyfile is syntactically valid, and that is the
whole of what it can prove. Treat "the configuration is valid" and "the
plaintext path is closed" as different claims, and only report the second after
running stage 7.
