// Shared SWR fetcher — the one default every client component passes to
// useSWR. It was previously re-declared verbatim in 8 files (page, search,
// and 6 managers/components); each useSWR call still supplies its own
// response type via the hook's generic, so this stays deliberately untyped
// at the JSON boundary (returns the parsed body as-is) to keep behavior
// identical to the inlined copies it replaces.
export const fetcher = (url: string) => fetch(url).then((r) => r.json());
