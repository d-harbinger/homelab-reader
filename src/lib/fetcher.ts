// Shared SWR fetcher — the one default every client component passes to
// useSWR. It was previously re-declared verbatim in 8 files (page, search,
// and 6 managers/components); each useSWR call still supplies its own
// response type via the hook's generic, so this stays deliberately untyped
// at the JSON boundary (returns the parsed body as-is) to keep behavior
// identical to the inlined copies it replaces.
// SWR keys stay root-relative ("/api/books") so cache keys and mutate() calls
// never change; the base path, if any, is added here at the one place a key
// becomes a request.
import { BASE } from "@/lib/base-path";

export const fetcher = (url: string) => fetch(`${BASE}${url}`).then((r) => r.json());
