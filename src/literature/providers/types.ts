export type ProviderName =
  "crossref" | "datacite" | "opencitations-index" | "opencitations-meta";

export type ScholarlyIdentifiers = Readonly<{
  doi?: string;
  arxiv?: string;
  pmid?: string;
  pmcid?: string;
  omid?: string;
}>;

export function hasStableIdentifier(
  identifiers: ScholarlyIdentifiers,
): boolean {
  return Object.values(identifiers).some(Boolean);
}

export type ScholarlyAuthor = Readonly<{
  family: string;
  given?: string;
}>;

export type ScholarlyCandidate = Readonly<{
  source: ProviderName;
  sourceRecordID: string;
  retrievedAt: string;
  identifiers: ScholarlyIdentifiers;
  title: string | null;
  authors: readonly ScholarlyAuthor[];
  publicationDate: string | null;
  publicationYear: number | null;
  venue: string | null;
  abstract: string | null;
  referenceCount: number | null;
  citationCount: number | null;
  canonicalURL: string | null;
  landingURL: string | null;
  matchedFields: readonly string[];
  rawProvenance: readonly string[];
}>;

export type FetchPort = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ClockPort = Readonly<{
  now(): Date;
}>;

export type SchedulerPort = Readonly<{
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}>;

export type ProviderPorts = Readonly<{
  fetch: FetchPort;
  clock: ClockPort;
  scheduler: SchedulerPort;
}>;

export type ProviderErrorCode =
  | "no-candidate"
  | "no-citations-from-source"
  | "invalid-provider-query"
  | "source-access-denied"
  | "rate-limited"
  | "source-unavailable"
  | "provider-failure"
  | "provider-contract-error"
  | "provider-response-too-large"
  | "incomplete-metadata"
  | "unreachable-landing-page"
  | "citation-identifier-unsupported";

export class ProviderError extends Error {
  constructor(
    readonly source: ProviderName | "doi-proxy",
    readonly code: ProviderErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
