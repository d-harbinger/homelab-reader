import { describe, expect, it } from "vitest";
import { buildOrganizePlan } from "./organize-plan";

const ROOT = "/library";

describe("buildOrganizePlan", () => {
  it("moves a root-level book into its shelf folder", () => {
    const plan = buildOrganizePlan(
      [{ filePath: "/library/dump.pdf", genre: "Networking & Sysadmin" }],
      [ROOT],
    );
    expect(plan.moves).toEqual([
      ["/library/dump.pdf", "/library/Networking & Sysadmin/dump.pdf"],
    ]);
    expect(plan.dirs).toEqual(["/library/Networking & Sysadmin"]);
    expect(plan.alreadyPlaced).toBe(0);
    expect(plan.outsideRoots).toBe(0);
  });

  it("moves a book out of a wrong folder, counts placed books, skips foreign paths", () => {
    const plan = buildOrganizePlan(
      [
        { filePath: "/library/dump/beej.pdf", genre: "Programming" },
        { filePath: "/library/Programming/kr.pdf", genre: "Programming" },
        { filePath: "/elsewhere/orphan.epub", genre: "Fiction" },
      ],
      [ROOT],
    );
    expect(plan.moves).toEqual([
      ["/library/dump/beej.pdf", "/library/Programming/beej.pdf"],
    ]);
    expect(plan.alreadyPlaced).toBe(1);
    expect(plan.outsideRoots).toBe(1);
  });

  it("resolves nested roots to the deepest match", () => {
    const plan = buildOrganizePlan(
      [{ filePath: "/library/inner/book.epub", genre: "Fiction" }],
      ["/library", "/library/inner"],
    );
    // The deepest root wins: the book sits directly under /library/inner,
    // so its shelf folder is created there, not under /library.
    expect(plan.moves).toEqual([
      ["/library/inner/book.epub", "/library/inner/Fiction/book.epub"],
    ]);
  });

  it("sanitizes path separators out of custom shelf names", () => {
    const plan = buildOrganizePlan(
      [{ filePath: "/library/a.pdf", genre: "AC/DC Manuals" }],
      [ROOT],
    );
    expect(plan.moves[0][1]).toBe("/library/AC-DC Manuals/a.pdf");
  });

  it("root paths with trailing slashes still match", () => {
    const plan = buildOrganizePlan(
      [{ filePath: "/library/a.pdf", genre: "Fiction" }],
      ["/library/"],
    );
    expect(plan.moves).toHaveLength(1);
  });
});
