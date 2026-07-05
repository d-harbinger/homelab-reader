// Derive a browsable folder/shelf tree from books' on-disk paths.
//
// The library's baseline structure IS the directory layout the user already
// maintains (python/, ai/, …). Rather than invent a taxonomy, mirror it: group
// each book by the folder it lives in, relative to the scan root it falls under.
// Pure and deterministic — no DB, no fs — so the API layer can build it from a
// `book.findMany({ select: { filePath: true } })` and a list of ScanLocation paths.

export interface FolderNode {
  /** Folder name (last path segment). "" for the virtual root. */
  name: string;
  /** Path relative to the scan root, e.g. "python/web". "" for the root. */
  path: string;
  /** Books sitting directly in this folder. */
  bookCount: number;
  /** Books in this folder and everything below it. */
  totalCount: number;
  children: FolderNode[];
}

function newNode(name: string, path: string): FolderNode {
  return { name, path, bookCount: 0, totalCount: 0, children: [] };
}

// Directory segments of `filePath` relative to the longest matching root, with
// the filename dropped. null if the file isn't under any root.
function dirSegmentsUnderRoot(
  filePath: string,
  roots: string[],
): string[] | null {
  const normalized = roots
    .map((r) => r.replace(/\/+$/, ""))
    .sort((a, b) => b.length - a.length); // longest (most specific) first

  for (const root of normalized) {
    const prefix = `${root}/`;
    if (filePath.startsWith(prefix)) {
      const segs = filePath.slice(prefix.length).split("/");
      segs.pop(); // drop the filename
      return segs;
    }
  }
  return null;
}

// The directory part of `filePath` relative to the longest matching scan root
// (the filename dropped), as a "/"-joined relative path — e.g.
// "/books/python/web/b.epub" under root "/books" → "python/web". "" for a file
// sitting directly under a root; null if the file isn't under any root.
//
// Single source of truth for the "strip the root, drop the filename" rule used
// by the folder tree. Any consumer that needs a book's relative folder should
// import this rather than copy the logic, so the tree and its consumers can
// never disagree on what folder a book lives in.
export function relativeFolder(filePath: string, roots: string[]): string | null {
  const segs = dirSegmentsUnderRoot(filePath, roots);
  return segs === null ? null : segs.join("/");
}

export function buildFolderTree(
  books: { filePath: string }[],
  roots: string[],
): FolderNode {
  const root = newNode("", "");

  for (const book of books) {
    root.totalCount++;

    const segs = dirSegmentsUnderRoot(book.filePath, roots);
    if (!segs || segs.length === 0) {
      // Directly under a scan root (or unrooted) — counts at the top level.
      root.bookCount++;
      continue;
    }

    let node = root;
    for (const seg of segs) {
      // Case-insensitive grouping: the /api/books folder filter compiles to
      // SQLite LIKE, which is case-insensitive for ASCII, so "Python/" and
      // "python/" are one folder as far as filtering goes. Group them into one
      // node (first-seen spelling wins for display and path) or the rail's
      // counts disagree with the filtered results it drives.
      let child = node.children.find(
        (c) => c.name.toLowerCase() === seg.toLowerCase(),
      );
      if (!child) {
        const rel = node.path ? `${node.path}/${seg}` : seg;
        child = newNode(seg, rel);
        node.children.push(child);
      }
      child.totalCount++;
      node = child;
    }
    node.bookCount++;
  }

  const sortRecursive = (n: FolderNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sortRecursive);
  };
  sortRecursive(root);

  return root;
}
