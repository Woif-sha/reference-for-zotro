import type {
  DeterministicMatch,
  StableIdentifierKind,
  StableIdentifiers,
} from "../domain/literature";

const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;
const ARXIV_PATTERN =
  /(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf)\/)((?:\d{4}\.\d{4,5})|(?:[a-z-]+\/\d{7}))(?:v\d+)?/i;
const IEEE_PATTERN =
  /(?:ieeexplore\.ieee\.org\/(?:document|abstract\/document)\/|(?:article|document)\s*(?:number|no\.?)?\s*[:#]?\s*)(\d{5,10})/i;
const TRUSTED_SOURCE_URL_PATTERN =
  /https:\/\/(?:dl\.acm\.org\/doi\/(?:abs\/|full\/)?|ieeexplore\.ieee\.org\/(?:document|abstract\/document)\/|doi\.org\/|arxiv\.org\/abs\/|aclanthology\.org\/)[^\s<>"']+/i;

export function extractStableIdentifiers(text: string): StableIdentifiers {
  const doi = text.match(DOI_PATTERN)?.[0];
  const arxiv = text.match(ARXIV_PATTERN)?.[1];
  const ieeeArticleNumber = text.match(IEEE_PATTERN)?.[1];
  const trustedSourceUrl = text.match(TRUSTED_SOURCE_URL_PATTERN)?.[0];
  const result: StableIdentifiers = {};
  if (doi) result.doi = trimTrailingPunctuation(doi).toLowerCase();
  if (arxiv) result.arxiv = arxiv.toLowerCase();
  if (ieeeArticleNumber) result.ieeeArticleNumber = ieeeArticleNumber;
  if (trustedSourceUrl) {
    result.trustedSourceUrl = normalizeTrustedSourceUrl(
      trimTrailingPunctuation(trustedSourceUrl),
    );
  }
  return result;
}

export type ScholarlyIdentifierScheme =
  "doi" | "arxiv" | "pmid" | "pmcid" | "omid";

export type ScholarlyIdentity = Readonly<
  Partial<Record<ScholarlyIdentifierScheme, string | undefined>>
>;

export type ScholarlyIdentityRelation = "same" | "conflicting" | "unrelated";

const SCHOLARLY_IDENTIFIER_SCHEMES = [
  "doi",
  "arxiv",
  "pmid",
  "pmcid",
  "omid",
] as const;

export function normalizeScholarlyIdentifier(
  scheme: ScholarlyIdentifierScheme,
  value: string | undefined,
): string | undefined {
  if (scheme === "doi") return normalizeDoi(value);
  const normalized = value?.normalize("NFKC").trim().toLowerCase();
  return normalized || undefined;
}

export function normalizeDoi(value: string | undefined): string | undefined {
  const withoutPrefix = value
    ?.replace(/^https?:\/\/doi\.org\//iu, "")
    .replace(/^doi:\s*/iu, "")
    .trim();
  if (!withoutPrefix) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutPrefix);
  } catch (error) {
    throw new Error("DOI contains invalid percent-encoding", { cause: error });
  }
  return decoded.normalize("NFKC").trim().toLowerCase() || undefined;
}

export function relateScholarlyIdentities(
  left: ScholarlyIdentity,
  right: ScholarlyIdentity,
): ScholarlyIdentityRelation {
  let agrees = false;
  for (const scheme of SCHOLARLY_IDENTIFIER_SCHEMES) {
    const leftValue = normalizeScholarlyIdentifier(scheme, left[scheme]);
    const rightValue = normalizeScholarlyIdentifier(scheme, right[scheme]);
    if (!leftValue || !rightValue) continue;
    if (leftValue !== rightValue) return "conflicting";
    agrees = true;
  }
  return agrees ? "same" : "unrelated";
}

export function findMalformedStableIdentifier(
  text: string,
  identifiers = extractStableIdentifiers(text),
): StableIdentifierKind | undefined {
  if (Object.keys(identifiers).length > 0) return undefined;
  if (/(?:\bdoi\s*:|https:\/\/doi\.org\/)/iu.test(text)) return "doi";
  if (/(?:\barxiv\s*:|https:\/\/arxiv\.org\/(?:abs|pdf)\/)/iu.test(text)) {
    return "arxiv";
  }
  if (
    /(?:https:\/\/ieeexplore\.ieee\.org\/(?:document|abstract\/document)\/|(?:article|document)\s*(?:number|no\.?)?\s*[:#])/iu.test(
      text,
    )
  ) {
    return "ieee-article-number";
  }
  if (
    /https?:\/\/(?:dl\.acm\.org|ieeexplore\.ieee\.org|doi\.org|arxiv\.org|aclanthology\.org)\//iu.test(
      text,
    )
  ) {
    return "trusted-source-url";
  }
  return undefined;
}

export function resolveDeterministicLandingPage(
  identifiers: StableIdentifiers,
): DeterministicMatch {
  if (identifiers.doi) {
    return {
      status: "confirmed",
      matchedBy: "doi",
      url: `https://doi.org/${encodeURI(identifiers.doi)}`,
    };
  }
  if (identifiers.arxiv) {
    return {
      status: "confirmed",
      matchedBy: "arxiv",
      url: `https://arxiv.org/abs/${encodeURIComponent(identifiers.arxiv)}`,
    };
  }
  if (identifiers.ieeeArticleNumber) {
    return {
      status: "confirmed",
      matchedBy: "ieee-article-number",
      url: `https://ieeexplore.ieee.org/document/${identifiers.ieeeArticleNumber}`,
    };
  }
  if (identifiers.trustedSourceUrl) {
    return {
      status: "confirmed",
      matchedBy: "trusted-source-url",
      url: identifiers.trustedSourceUrl,
    };
  }
  return { status: "unresolved", reason: "no-stable-identifier" };
}

function trimTrailingPunctuation(value: string): string {
  let result = value.replace(/[.,;:]+$/u, "");
  while (/[)\]}]$/u.test(result) && hasUnmatchedClosingDelimiter(result)) {
    result = result.slice(0, -1);
  }
  return result;
}

function normalizeTrustedSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString();
}

function hasUnmatchedClosingDelimiter(value: string): boolean {
  return (
    count(value, ")") > count(value, "(") ||
    count(value, "]") > count(value, "[") ||
    count(value, "}") > count(value, "{")
  );
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
