// Minimal OPDS 1.2 catalog generator.
//
// Spec: https://specs.opds.io/opds-1.2
// Content-type strings matter — Atom-aware readers (KOReader, Moon+,
// Aldiko Next, etc.) dispatch off them.

export const OPDS_NAV =
  "application/atom+xml;profile=opds-catalog;kind=navigation";
export const OPDS_ACQ =
  "application/atom+xml;profile=opds-catalog;kind=acquisition";

const MIME: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
};

export interface OpdsBookEntry {
  id: string;
  title: string;
  authors: string[];
  language: string | null;
  description: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  format: "epub" | "pdf";
  coverPath: string | null;
}

export interface OpdsLink {
  rel: string;
  href: string;
  type: string;
  title?: string;
}

interface OpdsFeedOpts {
  id: string;
  title: string;
  selfHref: string;
  links?: OpdsLink[];
  entries: string[];
}

export function feedXml(opts: OpdsFeedOpts): string {
  const now = new Date().toISOString();
  const baseLinks: OpdsLink[] = [
    { rel: "self", href: opts.selfHref, type: OPDS_NAV },
    { rel: "start", href: "/api/opds", type: OPDS_NAV },
    ...(opts.links ?? []),
  ];

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:dc="http://purl.org/dc/terms/">`,
    `  <id>${xmlText(opts.id)}</id>`,
    `  <title>${xmlText(opts.title)}</title>`,
    `  <updated>${now}</updated>`,
    `  <author><name>homelab-reader</name></author>`,
    ...baseLinks.map((l) => `  ${linkXml(l)}`),
    ...opts.entries,
    `</feed>`,
  ].join("\n");
}

export function navEntryXml(opts: {
  id: string;
  title: string;
  href: string;
  summary?: string;
  acquisition?: boolean;
}): string {
  const now = new Date().toISOString();
  const linkType = opts.acquisition ? OPDS_ACQ : OPDS_NAV;
  return [
    `  <entry>`,
    `    <id>${xmlText(opts.id)}</id>`,
    `    <title>${xmlText(opts.title)}</title>`,
    `    <updated>${now}</updated>`,
    opts.summary
      ? `    <content type="text">${xmlText(opts.summary)}</content>`
      : "",
    `    <link rel="subsection" href="${xmlAttr(opts.href)}" type="${linkType}"/>`,
    `  </entry>`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function bookEntryXml(b: OpdsBookEntry): string {
  const acquisitionMime = MIME[b.format] ?? "application/octet-stream";
  const lines: string[] = [
    `  <entry>`,
    `    <id>urn:homelab-reader:book:${xmlText(b.id)}</id>`,
    `    <title>${xmlText(b.title)}</title>`,
    `    <updated>${b.updatedAt.toISOString()}</updated>`,
  ];
  for (const name of b.authors) {
    lines.push(`    <author><name>${xmlText(name)}</name></author>`);
  }
  if (b.language) lines.push(`    <dc:language>${xmlText(b.language)}</dc:language>`);
  if (b.publishedAt)
    lines.push(`    <dc:issued>${b.publishedAt.toISOString()}</dc:issued>`);
  if (b.description)
    lines.push(`    <summary type="text">${xmlText(b.description)}</summary>`);
  if (b.coverPath) {
    lines.push(
      `    <link rel="http://opds-spec.org/image" href="/api/covers/${xmlAttr(b.id)}" type="image/jpeg"/>`,
    );
    lines.push(
      `    <link rel="http://opds-spec.org/image/thumbnail" href="/api/covers/${xmlAttr(b.id)}" type="image/jpeg"/>`,
    );
  }
  lines.push(
    `    <link rel="http://opds-spec.org/acquisition" href="/api/books/${xmlAttr(b.id)}/file" type="${acquisitionMime}"/>`,
  );
  lines.push(`  </entry>`);
  return lines.join("\n");
}

function linkXml(l: OpdsLink): string {
  const titleAttr = l.title ? ` title="${xmlAttr(l.title)}"` : "";
  return `<link rel="${xmlAttr(l.rel)}" href="${xmlAttr(l.href)}" type="${xmlAttr(l.type)}"${titleAttr}/>`;
}

function xmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
