import { extractStableIdentifiers } from "./identifiers";
import type { PublicationChannel, ReferenceQuery } from "./gateway";
import type { ScholarlyIdentifiers } from "./providers/types";

export const UNPARSED_REFERENCE_TITLE = "Title unavailable";

export function parseReferenceQuery(lookupText: string): ReferenceQuery {
  const stable = extractStableIdentifiers(lookupText);
  const identifiers: ScholarlyIdentifiers = {
    ...(stable.doi ? { doi: stable.doi } : {}),
    ...(stable.arxiv ? { arxiv: stable.arxiv } : {}),
    ...extractBiomedicalIdentifiers(lookupText),
  };
  const yearSeparated = findYearSeparatedMetadata(lookupText);
  const authorBoundary = yearSeparated
    ? undefined
    : leadingAuthorsEnd(lookupText);
  const quoted = findQuotedTitle(lookupText);
  const unquoted =
    yearSeparated ??
    (quoted ? undefined : findUnquotedMetadata(lookupText, authorBoundary));
  const standalone =
    quoted || unquoted ? undefined : findStandaloneTitle(lookupText);
  const title = quoted?.title ?? unquoted?.title ?? standalone;
  const authorRegion = quoted
    ? lookupText.slice(0, quoted.start)
    : (unquoted?.authorRegion ?? "");
  const authors = extractFamilyNames(authorRegion);
  const year = extractYear(lookupText);
  const citationTail = quoted ? lookupText.slice(quoted.end) : lookupText;
  const venue = quoted ? extractVenue(citationTail) : unquoted?.venue;
  const normalizedTitle = title ? trimTitlePunctuation(title) : undefined;
  return {
    identifiers,
    title:
      normalizedTitle && !containsBibliographicMetadata(normalizedTitle)
        ? normalizedTitle
        : null,
    authors,
    year,
    venue,
    channel: classifyChannel(venue ?? "", citationTail),
  };
}

function findYearSeparatedMetadata(
  value: string,
): { authorRegion: string; title: string; venue?: string } | undefined {
  const match =
    /^(.+?)\.\s+(?:19|20|21)\d{2}\.\s+(.+?)(?:\.(?:\s+|$)|(?<=[?!])\s+)/u.exec(
      value,
    );
  if (!match?.[1] || !match[2] || !isYearSeparatedAuthorRegion(match[1])) {
    return undefined;
  }
  const afterTitle = value.slice(match[0].length);
  return {
    authorRegion: match[1],
    title: match[2],
    venue: extractVenue(afterTitle),
  };
}

function isYearSeparatedAuthorRegion(value: string): boolean {
  if (/[,;]|\band\b/iu.test(value)) return true;
  if (/^[\p{L}][\p{L}'’-]*$/u.test(value)) return true;
  if (
    /\b(?:Corporation|Consortium|Group|Committee|Institute|Laboratories|University|Inc|Ltd)$/u.test(
      value,
    )
  ) {
    return true;
  }
  if (/^(?:\p{Lu}\.\s*)+[\p{Lu}][\p{L}'’-]*$/u.test(value)) return true;
  return /^[\p{Lu}][\p{L}'’-]*(?:\s+(?:[\p{L}][\p{L}'’-]*|\p{Lu}\.)){1,3}$/u.test(
    value,
  );
}

function findUnquotedMetadata(
  value: string,
  authorBoundary: number | undefined,
): { authorRegion: string; title: string; venue?: string } | undefined {
  if (authorBoundary === undefined) return undefined;
  const remainder = value
    .slice(authorBoundary)
    .replace(/^[\s,.;:]+/u, "")
    .replace(/^\((?:19|20|21)\d{2}\)\.\s+/u, "");
  const chapter = /^in\s+(.+?)\s+\(eds?\b/iu.exec(remainder);
  if (chapter?.[1]) {
    return {
      authorRegion: value.slice(0, authorBoundary),
      title: chapter[1],
      venue: chapter[1],
    };
  }
  const book =
    /^(.+?)\s+\([^()]*(?:Press|Springer)[^()]*,\s*\d{4}\)\.?$/iu.exec(
      remainder,
    );
  if (book?.[1] && !/[.!?]\s/u.test(book[1])) {
    return {
      authorRegion: value.slice(0, authorBoundary),
      title: book[1],
    };
  }
  const titleMatch = /^(.+?)(?:\.(?:\s+|$)|(?<=[?!])\s+)/u.exec(remainder);
  const journalBoundary =
    /^(.+?)\s+(?=(?:Nature|Science|Cell)\s+\d+\s*,\s*\d+)/u.exec(remainder);
  const proceedingsBoundary = /^(.+?)\s+(?=In\s+Proc\.)/u.exec(remainder);
  const versionBoundary = /^(.+?)(?=,\s+Version\s+\d)/iu.exec(remainder);
  const reportBoundary = /^(.+?)(?=;\s+Technical\s+Report\b)/iu.exec(remainder);
  const match = [
    titleMatch,
    journalBoundary,
    proceedingsBoundary,
    versionBoundary,
    reportBoundary,
  ]
    .filter((candidate): candidate is RegExpExecArray =>
      Boolean(candidate?.[1]),
    )
    .sort((left, right) => left[1]!.length - right[1]!.length)[0];
  if (!match?.[1]) return undefined;
  if (!isCleanTitle(match[1])) return undefined;
  const afterTitle = remainder.slice(match[0].length);
  return {
    authorRegion: value.slice(0, authorBoundary),
    title: match[1],
    venue: extractVenue(afterTitle),
  };
}

function leadingAuthorsEnd(value: string): number | undefined {
  return (
    leadingFamilyNameAuthorsEnd(value) ??
    leadingInitialFirstAuthorsEnd(value) ??
    leadingFullNameAuthorsEnd(value) ??
    leadingCorporateAuthorEnd(value)
  );
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

    const separator = /^(?:,\s*|&\s*|and\s+)/iu.exec(remainder);
    if (
      !separator ||
      !LEADING_FAMILY_NAME_AUTHOR.test(remainder.slice(separator[0].length))
    ) {
      return end;
    }
    end += separator[0].length;
  }
}

const LEADING_INITIAL_FIRST_AUTHOR =
  /^(?:(?:\p{Lu}\.(?:-\p{Lu}\.)?)\s*)+[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*)*/u;

const FULL_NAME_PART = String.raw`(?:\p{Lu}\.(?:-\p{Lu}\.)?|\p{Lu}[\p{L}'’-]*)`;
const FULL_PERSON_NAME = `${FULL_NAME_PART}(?:\\s+${FULL_NAME_PART}){1,2}`;
const LEADING_FULL_NAME_AUTHORS = new RegExp(
  `^(?:${FULL_PERSON_NAME})(?:,\\s+(?:${FULL_PERSON_NAME}))*(?:,?\\s+and\\s+(?:${FULL_PERSON_NAME}))?\\.\\s+`,
  "u",
);

function leadingInitialFirstAuthorsEnd(value: string): number | undefined {
  let end = 0;
  let authorCount = 0;
  while (true) {
    const author = LEADING_INITIAL_FIRST_AUTHOR.exec(value.slice(end));
    if (!author) return undefined;
    authorCount += 1;
    end += author[0].length;

    const remainder = value.slice(end);
    const etAl = /^\s+et\.?\s+al\.?,?\s*/iu.exec(remainder);
    if (etAl) return end + etAl[0].length;
    const separator = /^(?:,\s*(?:and\s+)?|\s+and\s+)/iu.exec(remainder);
    if (
      separator &&
      LEADING_INITIAL_FIRST_AUTHOR.test(remainder.slice(separator[0].length))
    ) {
      end += separator[0].length;
      continue;
    }
    const truncatedAuthor = /^(?:,\s*)?\p{Lu}\.\s*,?\s*(?:and\s+)/u.exec(
      remainder,
    );
    if (
      truncatedAuthor &&
      LEADING_INITIAL_FIRST_AUTHOR.test(
        remainder.slice(truncatedAuthor[0].length),
      )
    ) {
      end += truncatedAuthor[0].length;
      continue;
    }
    return authorCount > 0 && /^(?:\.\s+|,\s+)/u.test(remainder)
      ? end
      : undefined;
  }
}

function leadingFullNameAuthorsEnd(value: string): number | undefined {
  const match = LEADING_FULL_NAME_AUTHORS.exec(value);
  if (!match || /^Accessed\s*:/iu.test(value.slice(match[0].length))) {
    return undefined;
  }
  return match[0].length;
}

function leadingCorporateAuthorEnd(value: string): number | undefined {
  return /^(?:[\p{L}&'’-]+(?:\s+[\p{L}&'’-]+){0,3},\s*(?:Inc|Ltd)\.\s+|[\p{L}&'’-]+,\s+|(?:[\p{Lu}\p{N}&-]{2,}|OpenAI|[\p{L}&'’-]+(?:\s+[\p{L}&'’-]+){0,3}\s+(?:Corporation|Consortium|Group|Committee|Institute|Laboratories))[.:]\s+)/u.exec(
    value,
  )?.[0].length;
}

function findQuotedTitle(
  value: string,
): { title: string; start: number; end: number } | undefined {
  const match = /(^|[,.;]\s*)["“”]([^"“”]+)["“”]/u.exec(value);
  if (!match) return undefined;
  const prefixLength = match[1]?.length ?? 0;
  const start = match.index + prefixLength;
  return {
    title: match[2]!,
    start,
    end: match.index + match[0].length,
  };
}

function findStandaloneTitle(value: string): string | undefined {
  const beforeGuideMetadata = /^(.+?\bUser Guide)(?=,\s+[\p{L}&'’-]+,)/iu.exec(
    value,
  )?.[1];
  if (beforeGuideMetadata && isCleanTitle(beforeGuideMetadata)) {
    return beforeGuideMetadata;
  }
  const beforeVendorMetadata =
    /^(.+?)(?=,\s+(?:[\p{L}&'’-]+,\s+(?:Inc|Ltd)\b|document\b))/iu.exec(
      value,
    )?.[1];
  if (beforeVendorMetadata && isCleanTitle(beforeVendorMetadata)) {
    return beforeVendorMetadata;
  }
  const beforeOnlineMetadata =
    /^(.+?)[.,]\s+(?=\[Online\]|Accessed\s*:|Retrieved\b|Available\s+online\s*:)/iu.exec(
      value,
    )?.[1];
  const standaloneTitle = beforeOnlineMetadata?.replace(
    /^\([\p{Lu}][\p{Ll}]{2}\.\s+(?:19|20|21)\d{2}\)\.\s+/u,
    "",
  );
  if (standaloneTitle && isCleanTitle(standaloneTitle)) {
    return standaloneTitle;
  }
  return isCleanTitle(value) && !/\b(?:19|20|21)\d{2}\b/u.test(value)
    ? value.trim()
    : undefined;
}

function isCleanTitle(value: string): boolean {
  return (
    Boolean(value.trim()) &&
    !/[“”]/u.test(value) &&
    !containsBibliographicMetadata(value)
  );
}

function containsBibliographicMetadata(value: string): boolean {
  return /https?\s*:\s*\/\s*\/|\bdoi\s*:|\barxiv\s*:|\[Online\]|\bAvailable\s*:|\bIn\s+Proc\.|\bpp?\.\s*\d|\bpages?\s+\d/iu.test(
    value,
  );
}

function extractFamilyNames(value: string): string[] {
  const authorText = value.replace(/\s+et\.?\s+al\.?,?\s*$/iu, "");
  const initialFirst = authorText
    .split(/\s*,\s*|\s+and\s+/iu)
    .map((part) =>
      /^(?:(?:\p{L}\.(?:-\p{L}\.)?)\s*)+([\p{L}][\p{L}'’\- ]*)$/u.exec(
        part.trim().replace(/^and\s+/iu, ""),
      ),
    )
    .map((match) => match?.[1]?.trim().split(/\s+/u).at(-1))
    .filter((family): family is string => Boolean(family));
  if (initialFirst.length > 0) return initialFirst;

  const familyFirst = [
    ...authorText.matchAll(
      /(?:^|[\s;&])([\p{L}][\p{L}'’-]+),\s*(?:[\p{L}]\.?)/gu,
    ),
  ].map((match) => match[1]);
  if (familyFirst.length > 0) return familyFirst;

  return authorText
    .replace(/[.\s]+$/u, "")
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/iu)
    .filter((part) => new RegExp(`^(?:${FULL_PERSON_NAME})$`, "u").test(part))
    .map((part) => part.trim().split(/\s+/u).at(-1)!)
    .map((family) => family.replace(/\.$/u, ""));
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
