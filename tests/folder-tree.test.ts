// Unit tests for deriving a browsable folder/shelf tree from the on-disk paths
// of books (relative to the scan roots). Pure: no DB, no fs. This is what turns
// "a huge wall" into the python/ai/... shelves the user already has on disk.
import { describe, it, expect } from "vitest";
import { buildFolderTree } from "@/lib/library/folder-tree";

describe("buildFolderTree", () => {
  it("groups books by their on-disk folder under the scan root", () => {
    const tree = buildFolderTree(
      [
        { filePath: "/books/python/a.pdf" },
        { filePath: "/books/python/web/b.pdf" },
        { filePath: "/books/ai/c.epub" },
        { filePath: "/books/loose.epub" },
      ],
      ["/books"],
    );

    expect(tree.totalCount).toBe(4);
    expect(tree.bookCount).toBe(1); // loose.epub sits directly under the root

    expect(tree.children.map((c) => c.name)).toEqual(["ai", "python"]); // sorted

    const python = tree.children.find((c) => c.name === "python")!;
    expect(python.path).toBe("python");
    expect(python.bookCount).toBe(1); // a.pdf directly in python/
    expect(python.totalCount).toBe(2); // + web/b.pdf below it

    const web = python.children[0];
    expect(web.name).toBe("web");
    expect(web.path).toBe("python/web");
    expect(web.totalCount).toBe(1);
  });

  it("handles trailing-slash roots and multiple roots", () => {
    const tree = buildFolderTree(
      [{ filePath: "/a/x/1.pdf" }, { filePath: "/b/y/2.pdf" }],
      ["/a/", "/b"],
    );
    expect(tree.totalCount).toBe(2);
    expect(tree.children.map((c) => c.name)).toEqual(["x", "y"]);
  });

  it("uses the longest matching root when scan roots nest", () => {
    const tree = buildFolderTree([{ filePath: "/books/sub/python/a.pdf" }], [
      "/books",
      "/books/sub",
    ]);
    // longest root "/books/sub" -> relative "python/a.pdf" -> shelf "python"
    expect(tree.children.map((c) => c.name)).toEqual(["python"]);
  });
});
