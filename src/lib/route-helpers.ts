import {
  authError,
  getCurrentUser,
  requireAdmin,
  UnauthenticatedError,
  type CurrentUser,
} from "@/lib/current-user";
import { crossOriginRejection } from "@/lib/same-origin";

// Route-handler helpers (TEACHING #3). Two blocks of ceremony opened almost
// every mutating handler: an inline `try { req.json() } catch { 400 }` and a
// `try { await requireAdmin()/getCurrentUserId() } catch (e) { authError(e) }`.
// The helper (authError) was centralized but the *calling pattern* never was,
// so each new route re-pasted the boilerplate. These helpers centralize the
// calling pattern and standardize auth-before-DB ordering.

// parseJson is re-exported from its own auth-free module so most routes can
// import both helpers from one place, while a route that needs only parseJson
// (and must not transitively import next-auth) imports it from "@/lib/parse-json".
export { parseJson, type ParseJsonResult } from "@/lib/parse-json";

// The wrapped-handler shape. Next.js 15 App Router calls route exports with
// (request, context) where context carries `params: Promise<…>` for dynamic
// segments. The wrappers resolve auth first, then invoke the inner handler with
// the resolved user prepended, followed by the original (req, ctx) so handlers
// keep full access to the request and route params. The context type is a
// generic so dynamic [id] routes get `{ params: Promise<{ id: string }> }`
// typed through without a cast, and static routes leave it unused.
type UserHandler<C> = (
  user: CurrentUser,
  req: Request,
  ctx: C,
) => Promise<Response> | Response;

// The Next.js 15 dynamic [id] route context: params arrive as a Promise.
export type IdContext = { params: Promise<{ id: string }> };

// A static route's context (no dynamic segments). Default C for the wrappers.
// Next.js 15's generated route-type check (`ParamCheck<RouteContext>`) rejects a
// second handler param typed `undefined`, so the wrappers declare a context-
// shaped default — `params: Promise<{}>` — that satisfies the validator for the
// non-dynamic exports while dynamic [id] routes pass `IdContext` explicitly.
type StaticContext = { params: Promise<Record<string, never>> };

// The exported route handler. Two pulls act on this one symbol: Next.js's
// generated route-type validator reads the LAST call signature and demands
// (req: Request, ctx) with no `undefined` slipping in; the existing route tests
// invoke handlers at their original arity — `GET()`, `GET(req)`, `PATCH(req,
// ctx)`. The overload set serves both: the under-arity signatures keep the
// tests' calls valid, and the final full-arity signature is the one Next reads.
interface RouteExport<C> {
  (): Promise<Response>;
  (req: Request): Promise<Response>;
  (req: Request, ctx: C): Promise<Response>;
}

// withUser(handler): resolve the signed-in user FIRST. Signed out -> 401
// (handler never runs). Otherwise the handler runs with the resolved user.
// This standardizes auth-before-DB ordering: routes that previously ran a
// book-existence or body-parse step before resolving auth now reject signed-out
// callers with 401 before touching the database (auth-first is strictly
// tighter — a signed-out caller could never have proceeded anyway).
export function withUser<C = StaticContext>(
  handler: UserHandler<C>,
): RouteExport<C> {
  return (async (req?: Request, ctx?: C): Promise<Response> => {
    // Before auth: a cross-origin write is refused whether or not the borrowed
    // cookie is valid, so the check costs nothing and answers nothing about the
    // session. See src/lib/same-origin.ts for why SameSite does not cover this.
    const crossOrigin = crossOriginRejection(req);
    if (crossOrigin) return crossOrigin;

    const user = await getCurrentUser();
    if (!user) return authError(new UnauthenticatedError());
    return handler(user, req as Request, ctx as C);
  }) as RouteExport<C>;
}

// withAdmin(handler): resolve an admin session FIRST. Signed out -> 401, signed
// in without the admin role -> 403 (handler never runs in either case).
export function withAdmin<C = StaticContext>(
  handler: UserHandler<C>,
): RouteExport<C> {
  return (async (req?: Request, ctx?: C): Promise<Response> => {
    const crossOrigin = crossOriginRejection(req);
    if (crossOrigin) return crossOrigin;

    let admin: CurrentUser;
    try {
      admin = await requireAdmin();
    } catch (e) {
      return authError(e);
    }
    return handler(admin, req as Request, ctx as C);
  }) as RouteExport<C>;
}
