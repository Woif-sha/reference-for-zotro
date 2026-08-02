import { decodeHTML } from "entities";

import { normalizeDoi } from "./parse";

export type TrustedLandingMetadata = Readonly<{
  title?: string;
  authors: readonly string[];
  venue?: string;
  publicationYear?: number;
  doi?: string;
  abstract?: string;
}>;

export function parseTrustedLandingMetadata(
  html: string,
): TrustedLandingMetadata {
  const metadata = collectMetaContent(html);
  const publicationDate = first(
    metadata,
    "citation_publication_date",
    "citation_date",
  );
  const year = publicationDate?.match(/\b(?:1[6-9]\d{2}|20\d{2}|21\d{2})\b/u);
  const abstract = cleanText(
    first(metadata, "citation_abstract") ?? extractAclAbstract(html),
  );
  const doi = normalizeDoi(first(metadata, "citation_doi"));
  return {
    title: cleanText(first(metadata, "citation_title")),
    authors: (metadata.get("citation_author") ?? [])
      .map(cleanText)
      .filter((author): author is string => Boolean(author)),
    venue: cleanText(
      first(
        metadata,
        "citation_conference_title",
        "citation_journal_title",
        "citation_book_title",
      ),
    ),
    publicationYear: year ? Number(year[0]) : undefined,
    doi,
    abstract,
  };
}

function collectMetaContent(html: string): Map<string, string[]> {
  const metadata = new Map<string, string[]>();
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = parseAttributes(match[0]);
    const name = (attributes.name ?? attributes.property)?.toLowerCase();
    const content = attributes.content;
    if (!name || content === undefined) continue;
    const values = metadata.get(name) ?? [];
    values.push(decodeHTML(content));
    metadata.set(name, values);
  }
  return metadata;
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu,
  )) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name && value !== undefined) attributes[name] = value;
  }
  return attributes;
}

function extractAclAbstract(html: string): string | undefined {
  return /<div\b[^>]*class\s*=\s*(?:"[^"]*\bacl-abstract\b[^"]*"|'[^']*\bacl-abstract\b[^']*'|[^\s>]*\bacl-abstract\b[^\s>]*)[^>]*>[\s\S]*?<span\b[^>]*>([\s\S]*?)<\/span>/iu.exec(
    html,
  )?.[1];
}

function first(
  metadata: Map<string, string[]>,
  ...names: readonly string[]
): string | undefined {
  return names
    .map((name) => metadata.get(name)?.find((value) => value.trim()))
    .find((value) => value !== undefined);
}

function cleanText(value: string | undefined): string | undefined {
  const cleaned = value
    ? decodeHTML(value.replace(/<[^>]*>/gu, " "))
        .replace(/\s+/gu, " ")
        .trim()
    : "";
  return cleaned || undefined;
}
