// The path this app is served under.
//
// Empty when the app owns its origin, which is the default and the shape its
// own container runs in. "/media" (for example) when a reverse proxy mounts it
// at a sub-path, as the eotw-box gift tier does. Next.js fixes the value at
// build time (`basePath` in next.config.ts reads the same variable), so one
// image serves one path; the Dockerfile's NEXT_PUBLIC_BASE_PATH build argument
// sets it.
//
// Next.js prefixes <Link>, router.push and redirect() itself. A string handed
// to fetch(), new Audio(), an <img src> or an <a href> is a plain HTTP request
// and gets no prefix from the framework, so every such site is written as
// `${BASE}/...`. NEXT_PUBLIC_ makes the value visible to client components.
export const BASE: string = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** Remove the base from a request pathname, so "/media/setup" reads "/setup". */
export function stripBase(pathname: string): string {
  if (!BASE) return pathname;
  if (pathname === BASE) return "/";
  return pathname.startsWith(BASE + "/") ? pathname.slice(BASE.length) : pathname;
}
