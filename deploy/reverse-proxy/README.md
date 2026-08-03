# Reverse proxy (Caddy) — starting point

A reference setup for fronting homelab-reader (and other homelab services) with
a single Caddy reverse proxy, so each app is reached by hostname over HTTPS
instead of a per-service host port. **Nothing here is wired into the live stack
yet** — it is a template to adopt deliberately.

## Why

- One entry point, automatic HTTPS, no more juggling/remembering host ports.
- Host port collisions (the reason reader moved off 3333) simply stop existing —
  apps talk to the proxy over an internal Docker network by service name.
- HTTPS is the right place to satisfy the OPDS auth contract (HTTP Basic sends
  the token on every request, so it wants TLS).

## How it fits together

```
client ──https──> Caddy (:443) ──internal docker net──> homelab-reader:3000
                       └────────────────────────────────> chimera:3000
```

Caddy owns 80/443 on the host. Each app joins a shared external network and
**stops publishing its own host port**; Caddy reaches it by container name.

## Adopt it

1. **Create the shared network (once):**
   ```bash
   docker network create homelab-proxy
   ```

2. **Join each app to that network.** In the app's compose file, add:
   ```yaml
   services:
     homelab-reader:
       networks: [default, homelab-proxy]
   networks:
     homelab-proxy:
       name: homelab-proxy
       external: true
   ```
   Once it routes through Caddy, you can drop the app's `ports:` block. With
   `HOMELAB_HOST_BIND=127.0.0.1` (the right answer behind a proxy), a published
   port stays local to the host for direct debugging; only
   `HOMELAB_HOST_BIND=0.0.0.0` exposes it on the network.

3. **Tell the app its public URL** (so auth/redirects are correct). In the app's
   `.env`:
   ```
   NEXTAUTH_URL=https://reader.home.lan
   AUTH_TRUST_HOST=true
   ```

4. **Point hostnames at the proxy host.** Add DNS records (or `/etc/hosts` on each
   client) mapping `reader.home.lan` (and `chimera.home.lan`) to the homelab's IP.

5. **Start the proxy:**
   ```bash
   cd deploy/reverse-proxy
   docker compose up -d
   ```

6. **Trust Caddy's local CA** (because of `local_certs` in the Caddyfile): export
   the root from the running container and add it to each client's trust store —
   ```bash
   docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
   ```
   — or just accept the browser warning on a LAN. For a real public domain,
   delete the `local_certs` block and Caddy uses Let's Encrypt automatically.

## Remote access

Prefer a mesh VPN (Tailscale / WireGuard) over forwarding 80/443 to the public
internet. With a VPN, the same `*.home.lan` names work from anywhere and nothing
is exposed — which matches a zero-trust posture far better than port-forwarding.
