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
  const citationTail = quoted ? lookupText.slice(quoted.end) : lookupText;
  const venue = quoted ? extractVenue(citationTail) : unquoted?.venue;
  return {
    identifiers,
    title: trimTitlePunctuation(title),
    authors,
    year,
    venue,
    channel: classifyChannel(venue ?? "", citationTail),
  };
}

function findUnquotedMetadata(
  value: string,
): { authorRegion: string; title: string; venue?: string } | undefined {
  const boundary = leadingFamilyNameAuthorsEnd(value);
  if (boundary === undefined) return undefined;
  const remainder = value.slice(boundary).replace(/^[\s,;]+/u, "");
  const titleMatch = /^(.+?)\.(?:\s+|$)/u.exec(remainder);
  if (!titleMatch?.[1]) return undefined;
  const afterTitle = remainder.slice(titleMatch[0].length);
  return {
    authorRegion: value.slice(0, boundary),
    title: titleMatch[1],
    venue: extractVenue(afterTitle),
  };
}

const LEADING_FAMILY_NAME_AUTHOR =
  /^([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)*),\s*((?:\p{L}\.(?:-\p{L}\.)?\s*)+)/u;

function leadingFamilyNameAuthorsEnd(value: string): number | undefined {
  let end = 0;
  let authorCount = 0;
  while (true) {
    const author = LEADING_FAMILY_NAME_AUTHOR.exec(value.slice(end));
    if (!author) return authorCount > 0 ? end : undefined;
    authorCount += 1;
    end += author[0].length;

    const remainder = value.slice(end);
    const etAl = /^(?:,\s*)?et\s+al\.\s*/iu.exec(remainder);
    if (etAl) return end + etAl[0].length;

    const separator = /^(?:,\s*|&\s*)/u.exec(remainder);
    if (
      !separator ||
      !LEADING_FAMILY_NAME_AUTHOR.test(remainder.slice(separator[0].length))
    ) {
      return end;
    }
    end += separator[0].length;
  }
}

function findQuotedTitle(
  value: string,
): { title: string; start: number; end: number } | undefined {
  const match = /["“”]([^"“”]+)["“”]/u.exec(value);
  if (!match || match.index === undefined) return undefined;
  return {
    title: match[1],
    start: match.index,
    end: match.index + match[0].length,
  };
}

function extractFamilyNames(value: string): string[] {
  const initialFirst = value
    .split(/\s*,\s*|\s+and\s+/iu)
    .map((part) =>
      /^(?:(?:\p{L}\.(?:-\p{L}\.)?)\s*)+([\p{L}][\p{L}'’\- ]*)$/u.exec(
        part.trim().replace(/^and\s+/iu, ""),
      ),
    )
    .map((match) => match?.[1]?.trim().split(/\s+/u).at(-1))
    .filter((family): family is string => Boolean(family));
  if (initialFirst.length > 0) return initialFirst;

  return [
    ...value.matchAll(/(?:^|[\s;&])([\p{L}][\p{L}'’-]+),\s*(?:[\p{L}]\.?)/gu),
  ].map((match) => match[1]);
}

function extractYear(value: string): number | null {
  const metadata = value
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/giu, " ")
    .replace(/\barxiv\s*:\s*\S+/giu, " ");
  const years = [...metadata.matchAll(/\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b/gu)];
  const last = years.at(-1)?.[1];
  return last ? Number(last) : null;
}

function extractVenue(value: string): string | undefined {
  const metadata = value
    .replace(/\s*\[Online\][\s\S]*$/iu, "")
    .replace(/\s*(?:Available\s*:|https?:\/\/)[\s\S]*$/iu, "")
    .replace(/^[\s.,;:]+/u, "")
    .trim();
  const conference =
    /^in\s+(?:\d{4}\s+)?(.+?)(?=,\s*(?:\d{4}\b|(?:vol|no|pp?|ser|eds?)\.)|$)/iu.exec(
      metadata,
    );
  const publication =
    /^(.+?)(?=,\s*(?:\d{4}\b|(?:vol|no|pp?|ser|eds?)\.)|$)/iu.exec(metadata);
  const venue = (conference?.[1] ?? publication?.[1] ?? metadata)
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

function classifyChannel(
  venue: string,
  citationTail: string,
): PublicationChannel {
  const normalized = `${venue} ${citationTail}`.toLowerCase();
  if (/^[\s.,;:]*in\b/iu.test(citationTail)) return "conference";
  const rules: Array<[PublicationChannel, RegExp]> = [
    ["dataset", /\bdata\s*set\b|\bdataset\b/u],
    ["software", /\bsoftware\b|\bsource code\b/u],
    ["preprint", /\bpreprint\b|\barxiv\b|\bbiorxiv\b|\bmedrxiv\b/u],
    ["repository", /\brepository\b/u],
    ["report", /\breport\b|\btechnical report\b/u],
    ["conference", /\bconference\b|\bproceedings\b|\bsymposium\b/u],
    ["chapter", /\bchapter\b/u],
    ["book", /\bbook\b|\bpress\b/u],
    ["standard", /\bieee std\b|\biso \d/iu],
    ["journal", /\bjournal\b|\btransactions\b|\bletters\b|\bieee access\b/u],
  ];
  return (
    rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "unknown"
  );
}

function trimTitlePunctuation(value: string): string {
  return value.replace(/[,;]+$/u, "").trim();
}
