// Pure planning core for the organize-library export: given shelved
// books and the enabled scan roots, compute the mv operations that
// make the folder layout match the shelves. Kept free of DB and HTTP
// so the arithmetic is unit-testable; the route wraps it in auth and
// script formatting.
import path from "node:path";

export interface PlannableBook {
  filePath: string;
  genre: string;
}

export interface OrganizePlan {
  /** Absolute directories the script must create. */
  dirs: string[];
  /** [from, to] absolute path pairs. */
  moves: Array<[string, string]>;
  /** Books already inside their shelf's folder. */
  alreadyPlaced: number;
  /** Books outside every enabled root — never planned. */
  outsideRoots: number;
}

// Genre names become directory names; they're taxonomy-controlled but
// guard the separators anyway (a custom shelf could contain one).
export function genreDirName(genre: string): string {
  return genre.replace(/[/\\]/g, "-").trim();
}

export function buildOrganizePlan(
  books: PlannableBook[],
  rootPaths: string[],
): OrganizePlan {
  const roots = rootPaths
    .map((r) => r.replace(/\/+$/, ""))
    // Longest first so nested roots resolve to the deepest match.
    .sort((a, b) => b.length - a.length);

  const dirs = new Set<string>();
  const moves: Array<[string, string]> = [];
  let alreadyPlaced = 0;
  let outsideRoots = 0;

  for (const book of books) {
    const root = roots.find((r) => book.filePath.startsWith(r + path.sep));
    if (!root) {
      outsideRoots += 1;
      continue;
    }

    const rel = book.filePath.slice(root.length + 1);
    const topFolder = rel.includes(path.sep) ? rel.split(path.sep)[0] : "";
    const dir = genreDirName(book.genre);
    if (topFolder === dir) {
      alreadyPlaced += 1;
      continue;
    }

    dirs.add(path.join(root, dir));
    moves.push([book.filePath, path.join(root, dir, path.basename(book.filePath))]);
  }

  return {
    dirs: [...dirs].sort(),
    moves,
    alreadyPlaced,
    outsideRoots,
  };
}
