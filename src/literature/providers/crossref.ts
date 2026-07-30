import {
  asArray,
  asNumber,
  asRecord,
  asString,
  firstString,
  normalizeDoi,
} from "./parse";
import { getJson } from "./transport";
import {
  ProviderError,
  type ProviderPorts,
  type ScholarlyAuthor,
  type ScholarlyCandidate,
} from "./types";

export type CrossrefSearchInput = Readonly<{
  title: string;
  firstAuthor?: string;
  year?: number;
  venue?: string;
  signal?: AbortSignal;
}>;

export async function lookupCrossrefDoi(
  doi: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<ScholarlyCandidate> {
  const body = await getJson(
    "crossref",
    `https://api.crossref.org/v1/works/${encodeURIComponent(doi)}`,
    ports,
    signal,
  );
  const message = asRecord(asRecord(body)?.message);
  if (!message) throw contractError("Crossref singleton has no message");
  return parseCrossrefWork(message, ports);
}

export async function searchCrossref(
  input: CrossrefSearchInput,
  ports: ProviderPorts,
): Promise<readonly ScholarlyCandidate[]> {
  if (!input.title.trim()) {
    throw new ProviderError(
      "crossref",
      "invalid-provider-query",
      "Crossref search requires a title",
    );
  }
  const params = new URLSearchParams({
    "query.bibliographic": [input.title, input.year?.toString(), input.venue]
      .filter(Boolean)
      .join(" "),
    rows: "5",
  });
  if (input.firstAuthor) params.set("query.author", input.firstAuthor);
  if (input.venue) params.set("query.container-title", input.venue);
  const body = await getJson(
    "crossref",
    `https://api.crossref.org/v1/works?${params}`,
    ports,
    input.signal,
  );
  const items = asArray(asRecord(asRecord(body)?.message)?.items);
  return items
    .map(asRecord)
    .filter((work): work is Record<string, unknown> => work !== undefined)
    .map((work) => parseCrossrefWork(work, ports));
}

function parseCrossrefWork(
  work: Record<string, unknown>,
  ports: ProviderPorts,
): ScholarlyCandidate {
  const doi = normalizeDoi(asString(work.DOI));
  const sourceRecordID = doi ?? asString(work.URL);
  if (!sourceRecordID) throw contractError("Crossref work has no identity");
  const dateParts = asArray(asRecord(work.published)?.["date-parts"])[0];
  const dateValues = asArray(dateParts)
    .map(asNumber)
    .filter((part): part is number => part !== undefined);
  const publicationYear = dateValues[0] ?? null;
  const publicationDate =
    publicationYear === null
      ? null
      : [publicationYear, dateValues[1], dateValues[2]]
          .filter((part) => part !== undefined)
          .map((part, index) =>
            index === 0 ? String(part) : String(part).padStart(2, "0"),
          )
          .join("-");
  const authors: ScholarlyAuthor[] = asArray(work.author)
    .map(asRecord)
    .filter((author): author is Record<string, unknown> => author !== undefined)
    .map((author) => ({
      family: asString(author.family) ?? "",
      ...(asString(author.given) ? { given: asString(author.given) } : {}),
    }))
    .filter(({ family }) => family.length > 0);
  return {
    source: "crossref",
    sourceRecordID,
    retrievedAt: ports.clock.now().toISOString(),
    identifiers: doi ? { doi } : {},
    title: firstString(work.title) ?? null,
    authors,
    publicationDate,
    publicationYear,
    venue: firstString(work["container-title"]) ?? null,
    abstract: asString(work.abstract) ?? null,
    referenceCount: asNumber(work["reference-count"]) ?? null,
    citationCount: asNumber(work["is-referenced-by-count"]) ?? null,
    canonicalURL: doi ? `https://doi.org/${encodeURI(doi)}` : null,
    landingURL: asString(work.URL) ?? null,
    matchedFields: [],
    rawProvenance: [`crossref:${sourceRecordID}`],
  };
}

function contractError(message: string): ProviderError {
  return new ProviderError("crossref", "provider-contract-error", message);
}
