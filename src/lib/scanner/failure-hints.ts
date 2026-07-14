// Plain-language guidance for import failures. The parser errors the
// scanner records ("Invalid Root reference.", zip central-directory
// noise) are meaningful to a developer and to nobody else; the banner
// pairs each failure with what it means and the exact way out. Pure
// string mapping — unit-tested, no I/O.
//
// `command` is a host-side fix the user can copy, built from the file's
// BASENAME only (the client never sees full paths); it is meant to be
// run inside the folder that holds the file.

export interface FailureHint {
  /** One plain sentence: what is actually wrong with the file. */
  meaning: string;
  /** One plain sentence: what to do about it. */
  fix: string;
  /** Optional copyable host-side command (run in the file's folder). */
  command?: string;
}

export function explainImportFailure(
  reason: string,
  format: string,
  fileName: string,
): FailureHint {
  const r = reason.toLowerCase();

  if (/password|encrypt/.test(r)) {
    return {
      meaning: "The file is password-protected, so its contents can't be read.",
      fix: "Remove the password with a PDF tool on another machine, then replace the file here — it re-imports automatically.",
      command: `qpdf --decrypt --password=PASSWORD "${fileName}" "fixed-${fileName}"`,
    };
  }

  if (
    format === "pdf" &&
    /invalid root|xref|trailer|corrupt|malformed|unexpected end|missing.*eof/.test(r)
  ) {
    return {
      meaning:
        "The file is damaged — usually an interrupted download or copy, not a format problem.",
      fix: "Re-download a fresh copy if possible; otherwise repair the file's structure and replace it — it re-imports automatically.",
      command: `qpdf "${fileName}" "fixed-${fileName}"`,
    };
  }

  if (
    format === "epub" &&
    /zip|central directory|end of|container|mimetype/.test(r)
  ) {
    return {
      meaning: "The EPUB's container (it's a zip underneath) is damaged or incomplete.",
      fix: "Re-export it from its source (in Calibre: Convert → EPUB to EPUB rebuilds it), then replace the file — it re-imports automatically.",
    };
  }

  return {
    meaning: "The file's contents couldn't be read by the importer.",
    fix: "Re-download or re-export the file and replace it here — it re-imports automatically. If it keeps failing, the file itself is likely broken at the source.",
  };
}
