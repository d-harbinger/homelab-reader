import { withUser } from "@/lib/route-helpers";
import { getColorKey, putColorKeyEntry } from "@/lib/annotations/color-key";

// GET /api/highlight-key?bookId=... — the signed-in user's color key for a
// book, as a color→label map (only labeled colors appear).
export const GET = withUser((user, req) => getColorKey(user.id, req));

// PUT /api/highlight-key — set one color's label for a book.
// Body: { bookId, color, label } — an empty label clears the entry.
export const PUT = withUser((user, req) => putColorKeyEntry(user.id, req));
