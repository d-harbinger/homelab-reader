// Regression test: EPUBs whose container.xml references the OPF by a
// percent-encoded path ("OEBPS/My%20Book.opf") while the zip stores the
// literal decoded name ("OEBPS/My Book.opf"). Real-world EPUBs produced by
// some tooling do this; the extractor used to fail the whole import with
// "EPUB OPF not found" even though the entry existed.
//
// The fixture zip is built in-test (stored entries, no compression) so the
// binary layout is deterministic and no zip-writing dependency is needed.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractEpub } from "@/lib/scanner/epub";

// --- minimal stored-only zip writer -----------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries: Array<{ name: string; data: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const dataBuf = Buffer.from(data, "utf8");
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt32LE(0, 10); // dos time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18); // compressed size
    local.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method: stored
    central.writeUInt32LE(0, 12); // dos time/date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra/comment/disk/attrs all zero
    central.writeUInt32LE(offset, 42); // local header offset

    locals.push(local, nameBuf, dataBuf);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

// --- the fixture -------------------------------------------------------------

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/My%20Book.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Percent Encoded</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`;

function stageEpub(): string {
  const zip = makeZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: CONTAINER },
    // Stored under the DECODED name; container.xml references the ENCODED form.
    { name: "OEBPS/My Book.opf", data: OPF },
  ]);
  const dir = mkdtempSync(path.join(tmpdir(), "epub-pct-"));
  const file = path.join(dir, "book.epub");
  writeFileSync(file, zip);
  return file;
}

describe("extractEpub percent-encoded OPF path", () => {
  it("falls back to the decoded entry name instead of failing the import", async () => {
    const extraction = await extractEpub(stageEpub());
    expect(extraction.title).toBe("Percent Encoded");
    expect(extraction.authors).toEqual(["Test Author"]);
  });
});
