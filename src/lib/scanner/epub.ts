import yauzl from "yauzl";
import { XMLParser } from "fast-xml-parser";
import path from "node:path";

export interface EpubExtraction {
  title?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  description?: string;
  publishedAt?: Date;
  isbn?: string;
  subjects: string[];
  cover?: { buffer: Buffer; ext: string };
}

// Minimal EPUB parser: no heavy lib, just zip + XML.
// 1. Open as ZIP.
// 2. Read META-INF/container.xml → discover the OPF rootfile path.
// 3. Parse the OPF (Open Packaging Format) for <metadata> + <manifest>.
// 4. Find the cover image: EPUB 3 uses `properties="cover-image"`,
//    EPUB 2 uses a `<meta name="cover" content="ITEM_ID">` pointer.
// 5. Extract the cover bytes if present.
export async function extractEpub(filePath: string): Promise<EpubExtraction> {
  const entries = await readZipEntries(filePath);

  const container = entries.get("META-INF/container.xml");
  if (!container) {
    throw new Error("EPUB missing META-INF/container.xml");
  }
  const opfPath = findOpfPath(container.toString("utf8"));
  if (!opfPath) {
    throw new Error("EPUB container.xml did not reference an OPF");
  }

  const opfBytes = entries.get(opfPath);
  if (!opfBytes) {
    throw new Error(`EPUB OPF not found at ${opfPath}`);
  }

  const parsed = parseOpf(opfBytes.toString("utf8"));
  const coverHref = resolveCoverHref(parsed, opfPath);

  let cover: EpubExtraction["cover"] | undefined;
  if (coverHref) {
    const coverBytes = entries.get(coverHref);
    if (coverBytes) {
      const ext = path.extname(coverHref).slice(1) || "jpg";
      cover = { buffer: coverBytes, ext };
    }
  }

  return {
    title: parsed.title,
    authors: parsed.authors,
    language: parsed.language,
    publisher: parsed.publisher,
    description: parsed.description,
    publishedAt: parsed.publishedAt,
    isbn: parsed.isbn,
    subjects: parsed.subjects,
    cover,
  };
}

// ── zip helpers ────────────────────────────────────────────────────────────

function readZipEntries(filePath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open failed"));
      const out = new Map<string, Buffer>();
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // directory
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) {
            reject(e ?? new Error("zip read failed"));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            out.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => resolve(out));
      zip.on("error", reject);
    });
  });
}

// ── XML helpers ────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

function findOpfPath(containerXml: string): string | undefined {
  const doc = xmlParser.parse(containerXml);
  const rootfiles = doc?.container?.rootfiles?.rootfile;
  const first = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  return first?.["@full-path"];
}

interface ParsedOpf {
  title?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  description?: string;
  publishedAt?: Date;
  isbn?: string;
  subjects: string[];
  manifest: ManifestItem[];
  coverIdHint?: string;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType?: string;
  properties?: string;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string") return node.trim() || undefined;
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    const t = (node as Record<string, unknown>)["#text"];
    return typeof t === "string" ? t.trim() || undefined : undefined;
  }
  return undefined;
}

function parseOpf(opfXml: string): ParsedOpf {
  const doc = xmlParser.parse(opfXml);
  const pkg = doc?.package;
  const meta = pkg?.metadata ?? {};

  const title = textOf(meta["dc:title"]) ?? textOf(meta.title);

  const creatorNodes = asArray(meta["dc:creator"] ?? meta.creator);
  const authors = creatorNodes
    .map((c) => textOf(c))
    .filter((s): s is string => Boolean(s));

  const language = textOf(meta["dc:language"]) ?? textOf(meta.language);
  const publisher = textOf(meta["dc:publisher"]) ?? textOf(meta.publisher);
  const description =
    textOf(meta["dc:description"]) ?? textOf(meta.description);

  const dateNode = textOf(meta["dc:date"]) ?? textOf(meta.date);
  let publishedAt: Date | undefined;
  if (dateNode) {
    const d = new Date(dateNode);
    if (!isNaN(d.getTime())) publishedAt = d;
  }

  // ISBN often appears as <dc:identifier opf:scheme="ISBN">...</dc:identifier>
  let isbn: string | undefined;
  const idNodes = asArray(meta["dc:identifier"] ?? meta.identifier);
  for (const idNode of idNodes) {
    const txt = textOf(idNode);
    if (!txt) continue;
    const scheme =
      typeof idNode === "object" && idNode !== null
        ? ((idNode as Record<string, unknown>)["@opf:scheme"] as string | undefined)
        : undefined;
    if (scheme?.toLowerCase() === "isbn" || /^\d{10}(\d{3})?$/.test(txt.replace(/-/g, ""))) {
      isbn = txt.replace(/[^0-9Xx]/g, "");
      break;
    }
  }

  // <dc:subject> → genre/topic tags. EPUB allows multiple; some bundle
  // them with commas/semicolons in a single tag, which we fan out so
  // each becomes its own Tag row.
  const subjectNodes = asArray(meta["dc:subject"] ?? meta.subject);
  const subjects: string[] = [];
  for (const node of subjectNodes) {
    const txt = textOf(node);
    if (!txt) continue;
    for (const part of txt.split(/[,;/]|\s—\s/)) {
      const cleaned = part.trim();
      if (cleaned && cleaned.length <= 64) subjects.push(cleaned);
    }
  }

  // EPUB 2 cover hint: <meta name="cover" content="ITEM_ID"/>
  let coverIdHint: string | undefined;
  const metaTags = asArray(meta.meta);
  for (const m of metaTags) {
    if (typeof m !== "object" || m === null) continue;
    const name = (m as Record<string, unknown>)["@name"] as string | undefined;
    const content = (m as Record<string, unknown>)["@content"] as
      | string
      | undefined;
    if (name?.toLowerCase() === "cover" && content) {
      coverIdHint = content;
      break;
    }
  }

  // Manifest
  const manifestNodes = asArray(pkg?.manifest?.item);
  const manifest: ManifestItem[] = manifestNodes.map((m) => {
    const o = m as Record<string, unknown>;
    return {
      id: String(o["@id"] ?? ""),
      href: String(o["@href"] ?? ""),
      mediaType: o["@media-type"] as string | undefined,
      properties: o["@properties"] as string | undefined,
    };
  });

  return {
    title,
    authors,
    language,
    publisher,
    description,
    publishedAt,
    isbn,
    subjects,
    manifest,
    coverIdHint,
  };
}

function resolveCoverHref(parsed: ParsedOpf, opfPath: string): string | undefined {
  // EPUB 3: explicit properties="cover-image"
  const epub3 = parsed.manifest.find((m) =>
    m.properties?.split(/\s+/).includes("cover-image"),
  );
  // EPUB 2: <meta name="cover"> pointed at an item id
  const epub2 = parsed.coverIdHint
    ? parsed.manifest.find((m) => m.id === parsed.coverIdHint)
    : undefined;
  // Last resort: an image item with id matching /cover/i
  const fallback =
    !epub3 && !epub2
      ? parsed.manifest.find(
          (m) =>
            /^image\//.test(m.mediaType ?? "") && /cover/i.test(m.id),
        )
      : undefined;

  const item = epub3 ?? epub2 ?? fallback;
  if (!item) return undefined;

  // href is relative to the OPF file's directory.
  const opfDir = path.posix.dirname(opfPath);
  const resolved =
    opfDir === "." || opfDir === ""
      ? item.href
      : path.posix.join(opfDir, item.href);
  return resolved;
}
