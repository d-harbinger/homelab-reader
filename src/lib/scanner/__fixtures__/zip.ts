// ═══════════════════════════════════════════════════════════════
//  A minimal ZIP writer, for building deliberately malformed EPUBs.
//
//  WHY THIS EXISTS. `extractEpub` takes a file path rather than a
//  string, so its input cannot be generated the way the other parser
//  surfaces in this repository are tested. It needs real archives on
//  disk. The repository has a zip *reader* (yauzl) and no writer, and a
//  hardening fixture is not a reason to add a runtime dependency — so
//  the handful of structures below are assembled by hand from the
//  format itself, using only `node:zlib`.
//
//  It writes what the tests need and nothing more: no zip64, no
//  encryption, no data descriptors, no multi-disk. Entries are stored
//  or raw-deflated, which between them cover both an ordinary book and
//  a decompression bomb.
//
//  Format reference: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local file
//  header), 4.3.12 (central directory header) and 4.3.16 (end of
//  central directory record).
// ═══════════════════════════════════════════════════════════════

import { deflateRawSync } from "node:zlib";

export interface ZipEntryInput {
  readonly name: string;
  readonly data: Buffer | string;
  /**
   * Deflate rather than store. The only reason to want this is size
   * amplification: a bomb is a small compressed entry with a large
   * declared uncompressed size.
   */
  readonly compress?: boolean;
}

/** CRC-32, because yauzl verifies it and a wrong one reads as a corrupt entry. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a zip archive in memory.
 *
 * Entry names are written as raw UTF-8 bytes with no sanitising, which is
 * deliberate: an archive that names an entry `../../x` is exactly the kind
 * this pass has to be able to hand to the parser.
 */
export function buildZip(entries: readonly ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const stored = entry.compress ? deflateRawSync(raw) : raw;
    const method = entry.compress ? 8 : 0;
    const sum = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date — 1980-01-01
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, stored);
    centrals.push(central);
    offset += local.length + stored.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBytes, end]);
}

/** The container.xml an ordinary EPUB carries, pointing at `opfPath`. */
export function containerXml(opfPath: string): string {
  return (
    `<?xml version="1.0"?>` +
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
    `<rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles>` +
    `</container>`
  );
}

export interface OpfInput {
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly subjects?: readonly string[];
  readonly identifier?: string;
  readonly date?: string;
  readonly language?: string;
  /** Manifest items, verbatim, so a test can write a hostile href. */
  readonly items?: readonly { id: string; href: string; mediaType?: string; properties?: string }[];
  /** EPUB 2 cover pointer. */
  readonly coverId?: string;
}

/** A well-formed OPF carrying whatever metadata the caller wants tested. */
export function opfXml(input: OpfInput = {}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const meta: string[] = [];
  if (input.title !== undefined) meta.push(`<dc:title>${esc(input.title)}</dc:title>`);
  for (const a of input.authors ?? []) meta.push(`<dc:creator>${esc(a)}</dc:creator>`);
  for (const s of input.subjects ?? []) meta.push(`<dc:subject>${esc(s)}</dc:subject>`);
  if (input.identifier !== undefined) {
    meta.push(`<dc:identifier opf:scheme="ISBN">${esc(input.identifier)}</dc:identifier>`);
  }
  if (input.date !== undefined) meta.push(`<dc:date>${esc(input.date)}</dc:date>`);
  if (input.language !== undefined) meta.push(`<dc:language>${esc(input.language)}</dc:language>`);
  if (input.coverId !== undefined) meta.push(`<meta name="cover" content="${esc(input.coverId)}"/>`);

  const items = (input.items ?? [])
    .map(
      (i) =>
        `<item id="${esc(i.id)}" href="${esc(i.href)}"` +
        (i.mediaType ? ` media-type="${esc(i.mediaType)}"` : "") +
        (i.properties ? ` properties="${esc(i.properties)}"` : "") +
        `/>`,
    )
    .join("");

  return (
    `<?xml version="1.0"?>` +
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0">` +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">` +
    meta.join("") +
    `</metadata>` +
    `<manifest>${items}</manifest>` +
    `</package>`
  );
}

/** A complete, ordinary EPUB: container plus OPF at `OEBPS/content.opf`. */
export function ordinaryEpub(opf: OpfInput = {}, extra: readonly ZipEntryInput[] = []): Buffer {
  return buildZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: containerXml("OEBPS/content.opf") },
    { name: "OEBPS/content.opf", data: opfXml(opf) },
    ...extra,
  ]);
}
