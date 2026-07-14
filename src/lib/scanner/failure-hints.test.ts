import { describe, expect, it } from "vitest";
import { explainImportFailure } from "./failure-hints";

describe("explainImportFailure", () => {
  it("maps the damaged-PDF family to a repair command", () => {
    const h = explainImportFailure("Invalid Root reference.", "pdf", "a b.pdf");
    expect(h.meaning).toMatch(/damaged/i);
    expect(h.command).toBe('qpdf "a b.pdf" "fixed-a b.pdf"');
  });

  it("recognizes password protection regardless of format", () => {
    const h = explainImportFailure("PasswordException: No password given", "pdf", "x.pdf");
    expect(h.meaning).toMatch(/password/i);
    expect(h.command).toContain("--decrypt");
  });

  it("maps broken EPUB containers to a re-export fix", () => {
    const h = explainImportFailure(
      "end of central directory record signature not found",
      "epub",
      "x.epub",
    );
    expect(h.meaning).toMatch(/container|zip/i);
    expect(h.fix).toMatch(/re-export/i);
  });

  it("always answers, even for unknown reasons", () => {
    const h = explainImportFailure("something novel", "pdf", "x.pdf");
    expect(h.meaning.length).toBeGreaterThan(0);
    expect(h.fix).toMatch(/replace/i);
    expect(h.command).toBeUndefined();
  });
});
