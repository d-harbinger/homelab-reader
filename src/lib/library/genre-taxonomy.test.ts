import { describe, expect, it } from "vitest";
import { classifyGenre, GENRES, shelfPickerOptions, UNSORTED } from "./genre-taxonomy";

// The normalizer's contract: noisy real-world subject strings (embedded
// EPUB dc:subject and OpenLibrary subjects both look like these) land on
// exactly one bookstore shelf, specific rules beat general ones, and
// no-signal books return null for the caller to shelve as Unsorted.
describe("classifyGenre", () => {
  it("shelves real-world messy subjects", () => {
    const cases: Array<[string[], string]> = [
      [["COMPUTERS — Networking — General", "TCP/IP (Computer network protocol)"], "Networking & Sysadmin"],
      [["Computer security", "Computers"], "Security & Privacy"],
      [["Operating systems (Computers)", "Linux"], "Operating Systems"],
      [["Windows server", "PowerShell (Computer program language)"], "Operating Systems"],
      [["Machine learning", "Python (Computer program language)"], "AI & Machine Learning"],
      [["Web site development", "JavaScript (Computer program language)"], "Web Development"],
      [["Database management", "SQL (Computer program language)"], "Data & Databases"],
      [["Cloud computing", "Docker"], "Cloud & DevOps"],
      [["Software engineering", "Design patterns"], "Software Engineering"],
      [["Electronic digital computers", "Programming"], "Programming"],
      [["Fiction, science fiction, general"], "Science Fiction & Fantasy"],
      [["Detective and mystery stories"], "Mystery & Thriller"],
      [["Fiction", "Literature"], "Fiction"],
      [["Cooking (Bread)", "Baking"], "Cooking & Food"],
      [["World War, 1939-1945", "History"], "History"],
      [["Biography & Autobiography"], "Biography & Memoir"],
      [["Mathematics", "Number theory"], "Mathematics"],
      [["Juvenile fiction", "Dragons"], "Science Fiction & Fantasy"],
      [["Self-help techniques", "Habits"], "Self-Improvement"],
      [["Survival skills", "Wilderness survival"], "Outdoors & Survival"],
    ];
    for (const [subjects, expected] of cases) {
      expect(classifyGenre(subjects), subjects.join(" | ")).toBe(expected);
    }
  });

  it("prefers the specific shelf when general subjects are also present", () => {
    // "Computers" alone is the generic bucket, but security wins when both appear.
    expect(classifyGenre(["Computers", "Computer security"])).toBe("Security & Privacy");
    // "Fiction" is present, but sci-fi is the more specific shelf.
    expect(classifyGenre(["Fiction", "Science fiction"])).toBe("Science Fiction & Fantasy");
  });

  it("returns null with no usable signal", () => {
    expect(classifyGenre([])).toBeNull();
    expect(classifyGenre(["", "  "])).toBeNull();
    expect(classifyGenre(["zzz nothing matches this"])).toBeNull();
  });

  it("taxonomy shelf names are unique and Unsorted is reserved", () => {
    expect(new Set(GENRES).size).toBe(GENRES.length);
    expect(GENRES).not.toContain(UNSORTED);
  });
});

// The picker shows the taxonomy alphabetized; GENRES keeps its
// specific-before-general matching order for classifyGenre.
describe("shelfPickerOptions", () => {
  const alphabetized = (list: string[]) =>
    [...list].sort((a, b) => a.localeCompare(b));

  it("returns every taxonomy shelf, alphabetized", () => {
    const options = shelfPickerOptions(null);
    expect(new Set(options)).toEqual(new Set(GENRES));
    expect(options).toEqual(alphabetized(options));
  });

  it("keeps an off-taxonomy shelf selectable, in alphabetical position", () => {
    const options = shelfPickerOptions("Aviation");
    expect(options).toContain("Aviation");
    expect(options).toHaveLength(GENRES.length + 1);
    expect(options).toEqual(alphabetized(options));
  });

  it("does not duplicate a shelf already in the taxonomy", () => {
    expect(shelfPickerOptions("Fiction")).toHaveLength(GENRES.length);
  });
});
