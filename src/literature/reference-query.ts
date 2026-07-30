import { extractStableIdentifiers } from "./identifiers";
import type { PublicationChannel, ReferenceQuery } from "./gateway";
import type { ScholarlyIdentifiers } from "./providers/types";

export function parseReferenceQuery(lookupText: string): ReferenceQuery {
  const stable = extractStableIdentifiers(lookupText);
  const identifiers: ScholarlyIdentifiers = {
    ...(stable.doi ? { doi: stable.doi } : {}),
    ...(stable.arxiv ? { arxiv: stable.arxiv } : {}),
    ...extractBiomedicalIdentifiers(lookupText),
  };
  const quoted = findQuotedTitle(lookupText);
  const unquoted = quoted ? undefined : findUnquotedMetadata(lookupText);
  const title =
    quoted?.title.trim() || unquoted?.title.trim() || lookupText.trim();
  const authorRegion = quoted
    ? lookupText.slice(0, quoted.start)
    : (unquoted?.authorRegion ?? "");
  const authors = extractFamilyNames(authorRegion);
  const year = extractYear(lookupText);
  const venue = quoted
    ? extractVenue(lookupText.slice(quoted.end), year)
    : unquoted?.venue;
  return {
    identifiers,
    title,
    authors,
    year,
    venue,
    channel: classifyChannel(`${venue ?? ""} ${lookupText}`),
  };
}

function findUnquotedMetadata(
  value: string,
): { authorRegion: string; title: string; venue?: string } | undefined {
  const etAl = /\bet\s+al\.\s*/iu.exec(value);
  let boundary = etAl ? etAl.index + etAl[0].length : undefined;
  if (boundary === undefined) {
    const authorMatches = [
      ...value.matchAll(/(?:^|[\s;&])([\p{L}][\p{L}'’-]+),\s*(?:[\p{L}]\.?)/gu),
    ];
    const last = authorMatches.at(-1);
    if (last && (authorMatches.length > 1 || last.index <= 1)) {
      boundary = last.index + last[0].length;
    }
  }
  if (boundary === undefined) return undefined;
  const remainder = value.slice(boundary).replace(/^[\s,;]+/u, "");
  const titleMatch = /^(.+?)\.(?:\s+|$)/u.exec(remainder);
  if (!titleMatch?.[1]) return undefined;
  const afterTitle = remainder.slice(titleMatch[0].length);
  const year = extractYear(afterTitle);
  return {
    authorRegion: value.slice(0, boundary),
    title: titleMatch[1],
    venue: extractVenue(afterTitle, year),
  };
}

function findQuotedTitle(
  value: string,
): { title: string; start: number; end: number } | undefined {
  const match = /["“]([^"”]+)["”]/u.exec(value);
  if (!match || match.index === undefined) return undefined;
  return {
    title: match[1],
    start: match.index,
    end: match.index + match[0].length,
  };
}

function extractFamilyNames(value: string): string[] {
  return [
    ...value.matchAll(/(?:^|[\s;&])([\p{L}][\p{L}'’-]+),\s*(?:[\p{L}]\.?)/gu),
  ].map((match) => match[1]);
}

function extractYear(value: string): number | null {
  const years = [...value.matchAll(/\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b/gu)];
  const last = years.at(-1)?.[1];
  return last ? Number(last) : null;
}

function extractVenue(value: string, year: number | null): string | undefined {
  const beforeYear = year === null ? value : value.split(String(year), 1)[0];
  const venue = beforeYear
    .replace(/^[\s.,;:]+/u, "")
    .replace(/[\s,;:]+$/u, "")
    .trim();
  return venue || undefined;
}

function extractBiomedicalIdentifiers(value: string): ScholarlyIdentifiers {
  const pmid = /\bPMID\s*:\s*(\d+)\b/iu.exec(value)?.[1];
  const pmcid = /\b(PMC\d+)\b/iu.exec(value)?.[1];
  return {
    ...(pmid ? { pmid } : {}),
    ...(pmcid ? { pmcid: pmcid.toUpperCase() } : {}),
  };
}

function classifyChannel(value: string): PublicationChannel {
  const normalized = value.toLowerCase();
  const rules: Array<[PublicationChannel, RegExp]> = [
    ["dataset", /\bdata\s*set\b|\bdataset\b/u],
    ["software", /\bsoftware\b|\bsource code\b/u],
    ["preprint", /\bpreprint\b|\barxiv\b|\bbiorxiv\b|\bmedrxiv\b/u],
    ["repository", /\brepository\b/u],
    ["report", /\breport\b|\btechnical report\b/u],
    ["conference", /\bconference\b|\bproceedings\b|\bsymposium\b/u],
    ["chapter", /\bchapter\b/u],
    ["book", /\bbook\b|\bpress\b/u],
    ["standard", /\bstandard\b|\bieee std\b|\biso \d/iu],
    ["journal", /\bjournal\b|\btransactions\b|\bletters\b/u],
  ];
  return (
    rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "unknown"
  );
}
