import {
  asArray,
  asNumber,
  asRecord,
  asString,
  isoYear,
  normalizeDoi,
} from "./parse";
import { getJson } from "./transport";
import {
  ProviderError,
  type ProviderPorts,
  type ScholarlyAuthor,
  type ScholarlyCandidate,
} from "./types";

export type DataCiteSearchInput = Readonly<{
  title: string;
  firstAuthor?: string;
  year?: number;
  signal?: AbortSignal;
}>;

export async function lookupDataCiteDoi(
  doi: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<ScholarlyCandidate> {
  const body = await getJson(
    "datacite",
    `https://api.datacite.org/dois/${encodeURIComponent(doi)}`,
    ports,
    signal,
  );
  const data = asRecord(asRecord(body)?.data);
  if (!data) throw contractError("DataCite singleton has no data");
  return parseDataCiteWork(data, ports);
}

export async function searchDataCite(
  input: DataCiteSearchInput,
  ports: ProviderPorts,
): Promise<readonly ScholarlyCandidate[]> {
  if (!input.title.trim()) {
    throw new ProviderError(
      "datacite",
      "invalid-provider-query",
      "DataCite search requires a title",
    );
  }
  const clauses = [`titles.title:"${escapeQuery(input.title)}"`];
  if (input.firstAuthor) {
    clauses.push(`creators.familyName:"${escapeQuery(input.firstAuthor)}"`);
  }
  if (input.year) clauses.push(`publicationYear:${input.year}`);
  const params = new URLSearchParams({
    query: clauses.join(" AND "),
    "page[size]": "5",
  });
  const body = await getJson(
    "datacite",
    `https://api.datacite.org/dois?${params}`,
    ports,
    input.signal,
  );
  const data = asRecord(body)?.data;
  if (!Array.isArray(data)) {
    throw contractError("DataCite search has no data array");
  }
  return data.map((item) => {
    const work = asRecord(item);
    if (!work) throw contractError("DataCite search item is not an object");
    return parseDataCiteWork(work, ports);
  });
}

function parseDataCiteWork(
  work: Record<string, unknown>,
  ports: ProviderPorts,
): ScholarlyCandidate {
  const attributes = asRecord(work.attributes);
  if (!attributes) throw contractError("DataCite work has no attributes");
  const doi = normalizeDoi(asString(attributes.doi) ?? asString(work.id));
  if (!doi) throw contractError("DataCite work has no DOI");
  const authors: ScholarlyAuthor[] = asArray(attributes.creators)
    .map(asRecord)
    .filter((author): author is Record<string, unknown> => author !== undefined)
    .map((author) => ({
      family: asString(author.familyName) ?? asString(author.name) ?? "",
      ...(asString(author.givenName)
        ? { given: asString(author.givenName) }
        : {}),
    }))
    .filter(({ family }) => family.length > 0);
  const title = asString(asRecord(asArray(attributes.titles)[0])?.title);
  const publicationYear = isoYear(attributes.publicationYear) ?? null;
  const date =
    asString(asRecord(asArray(attributes.dates)[0])?.date) ??
    (publicationYear === null ? null : String(publicationYear));
  return {
    source: "datacite",
    sourceRecordID: doi,
    retrievedAt: ports.clock.now().toISOString(),
    identifiers: { doi },
    title: title ?? null,
    authors,
    publicationDate: date,
    publicationYear,
    venue:
      asString(attributes.publisher) ??
      asString(asRecord(attributes.publisher)?.name) ??
      null,
    abstract: null,
    referenceCount: asNumber(attributes.referenceCount) ?? null,
    citationCount: asNumber(attributes.citationCount) ?? null,
    canonicalURL: `https://doi.org/${encodeURI(doi)}`,
    landingURL: asString(attributes.url) ?? null,
    matchedFields: [],
    rawProvenance: [`datacite:${doi}`],
  };
}

function escapeQuery(value: string): string {
  return value.replace(/([\\"])/gu, "\\$1");
}

function contractError(message: string): ProviderError {
  return new ProviderError("datacite", "provider-contract-error", message);
}
