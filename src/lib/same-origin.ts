import { NextResponse } from "next/server";

// Cross-origin write guard.
//
// The session cookie is SameSite=Lax (src/auth.config.ts). "Same site" is
// decided by the registrable domain and DELIBERATELY IGNORES THE PORT, so every
// application published from this host — this one on its port, the sibling
// apps on theirs — is same-site to every other. A page on any one of those
// origins, hostile or merely carrying an injected script, can therefore fire a
// state-changing POST at this application and the browser will attach this
// application's cookie to it. `Content-Type: text/plain` keeps such a request
// "simple", so there is no preflight to stop it, and `req.json()` parses the
// body regardless of the declared type.
//
// SameSite=Strict would not fix this either: it is still a site-level rule, and
// it breaks ordinary inbound links. The port-aware check has to happen on the
// server, against the ORIGIN of the page that made the request.
//
// The rule:
//   - Safe methods (GET/HEAD/OPTIONS) are not checked. They do not write.
//   - Otherwise, if the request states an origin — the `Origin` header, or the
//     origin part of `Referer` as a fallback — it MUST match this server's own
//     origin, port included, or the request is refused with 403.
//   - A request stating no origin at all is allowed through.
//
// That last branch is the one worth explaining, because it looks like a hole
// and is not. A cross-site forgery has to be driven by a browser, and browsers
// attach `Origin` to every request whose method is not GET/HEAD — form posts,
// fetch, sendBeacon alike. A page cannot suppress the header. So anything that
// arrives without one is not a browser acting on someone else's behalf; it is a
// direct client (curl, a script, an OPDS reader) which carries no ambient
// cookie to borrow in the first place. Rejecting those would break real machine
// clients while closing nothing.
//
// Server actions are NOT covered here and do not need to be: Next.js already
// validates Origin against Host for every action call.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Every host string that counts as "us", lowercased and INCLUDING THE PORT —
// the port is the whole point of this check.
//
//   - the Host header the client addressed us by,
//   - the host in the request URL as the framework reconstructed it,
//   - the host in AUTH_URL, so a deployment published under a public name
//     through a proxy still recognises its own front door.
function selfHosts(req: Request): string[] {
  const hosts: string[] = [];

  const hostHeader = req.headers.get("host");
  if (hostHeader) hosts.push(hostHeader.toLowerCase());

  try {
    hosts.push(new URL(req.url).host.toLowerCase());
  } catch {
    // A handler invoked with a non-URL request (unit tests do this) simply
    // contributes no host from this source.
  }

  const configured = process.env.AUTH_URL;
  if (configured) {
    try {
      hosts.push(new URL(configured).host.toLowerCase());
    } catch {
      // A malformed AUTH_URL is an operator error elsewhere; ignore it here
      // rather than fail every write.
    }
  }

  return hosts;
}

// The origin the request claims to come from, or null when it claims none.
// `Origin: null` — sent by sandboxed iframes and by some redirect chains — is
// returned as the literal string "null", which matches no host and is refused.
function statedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) return origin;

  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return referer; // unparseable: treat as a mismatch rather than as absent
  }
}

/**
 * Returns a 403 when the request is a cross-origin write, or null when it may
 * proceed. Called by the route wrappers, so a new route inherits the check
 * without its author having to remember it.
 */
export function crossOriginRejection(req?: Request): NextResponse | null {
  if (!req) return null;

  const method = (req.method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return null;

  const stated = statedOrigin(req);
  if (!stated) return null;

  let statedHost: string;
  try {
    statedHost = new URL(stated).host.toLowerCase();
  } catch {
    statedHost = ""; // "null" and other non-URLs match nothing below
  }

  if (statedHost && selfHosts(req).includes(statedHost)) return null;

  console.warn(`cross-origin ${method} refused: origin ${stated}`);
  return NextResponse.json({ error: "cross-origin" }, { status: 403 });
}
