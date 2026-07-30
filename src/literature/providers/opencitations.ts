import { asArray, asRecord, asString, isoYear, normalizeDoi } from "./parse";
import { getJson } from "./transport";
import {
  ProviderError,
  type ProviderPorts,
  type ScholarlyAuthor,
  type ScholarlyCandidate,
  type ScholarlyIdentifiers,
} from "./types";

export type CitationEdge = Readonly<{
  sourceRecordID: string;
  identifiers: ScholarlyIdentifiers;
  creation: string | null;
  rawProvenance: readonly string[];
}>;

export async function fetchOpenCitationEdges(
  identifiers: ScholarlyIdentifiers,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<readonly CitationEdge[]> {
  const key = identifiers.doi
    ? `doi:${normalizeDoi(identifiers.doi)}`
    : identifiers.pmid
      ? `pmid:${identifiers.pmid}`
      : undefined;
  if (!key) {
    throw new ProviderError(
      "opencitations-index",
      "citation-identifier-unsupported",
      "OpenCitations requires a DOI or PMID",
    );
  }
  const body = await getJson(
    "opencitations-index",
    `https://api.opencitations.net/index/v2/citations/${encodePath(key)}?sort=desc(creation)`,
    ports,
    signal,
  );
  if (!Array.isArray(body))
    throw contractError("Citation response is not a list");
  return body.map((value) => parseEdge(value));
}

export async function fetchOpenCitationMetadata(
  edges: readonly CitationEdge[],
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<readonly ScholarlyCandidate[]> {
  const results: ScholarlyCandidate[] = [];
  for (let index = 0; index < edges.length; index += 20) {
    const batch = edges.slice(index, index + 20);
    const ids = batch
      .map(({ identifiers }) => preferredIdentifier(identifiers))
      .filter((id): id is string => id !== undefined);
    if (ids.length === 0) continue;
    const body = await getJson(
      "opencitations-meta",
      `https://api.opencitations.net/meta/v1/metadata/${ids.map(encodePath).join("__")}`,
      ports,
      signal,
    );
    if (!Array.isArray(body))
      throw contractError("Metadata response is not a list");
    results.push(...body.map((value) => parseMetadata(value, ports)));
  }
  return results;
}

export function sortCitationEdges(
  edges: readonly CitationEdge[],
): readonly CitationEdge[] {
  const unique = new Map<string, CitationEdge>();
  for (const edge of edges) {
    const key =
      edge.identifiers.doi ??
      edge.identifiers.pmid ??
      edge.identifiers.omid ??
      edge.sourceRecordID;
    const current = unique.get(key);
    if (!current || compareEdges(edge, current) < 0) unique.set(key, edge);
  }
  return [...unique.values()].sort(compareEdges);
}

function compareEdges(left: CitationEdge, right: CitationEdge): number {
  return (
    (right.creation ?? "").localeCompare(left.creation ?? "") ||
    stableEdgeKey(left).localeCompare(stableEdgeKey(right))
  );
}

function stableEdgeKey(edge: CitationEdge): string {
  return (
    edge.identifiers.doi ??
    edge.identifiers.pmid ??
    edge.identifiers.omid ??
    edge.sourceRecordID
  );
}

function parseEdge(value: unknown): CitationEdge {
  const record = asRecord(value);
  const sourceRecordID = asString(record?.oci);
  const citing = asString(record?.citing);
  if (!sourceRecordID || !citing) {
    throw contractError("Citation edge has no OCI or citing identifier");
  }
  return {
    sourceRecordID,
    identifiers: parsePidList(citing),
    creation: asString(record?.creation) ?? null,
    rawProvenance: [`opencitations-index:${sourceRecordID}`],
  };
}

function parseMetadata(
  value: unknown,
  ports: ProviderPorts,
): ScholarlyCandidate {
  const record = asRecord(value);
  if (!record) throw contractError("Metadata row is not an object");
  const identifiers = parsePidList(asString(record.id) ?? "");
  const sourceRecordID =
    identifiers.omid ??
    identifiers.doi ??
    identifiers.pmid ??
    asString(record.id);
  if (!sourceRecordID) throw contractError("Metadata row has no identity");
  const publicationDate = asString(record.pub_date) ?? null;
  const authors: ScholarlyAuthor[] = (asString(record.author) ?? "")
    .split(";")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const [family, ...given] = name.split(",").map((part) => part.trim());
      return {
        family,
        ...(given.length > 0 ? { given: given.join(", ") } : {}),
      };
    });
  const doi = normalizeDoi(identifiers.doi);
  return {
    source: "opencitations-meta",
    sourceRecordID,
    retrievedAt: ports.clock.now().toISOString(),
    identifiers: { ...identifiers, ...(doi ? { doi } : {}) },
    title: asString(record.title) ?? null,
    authors,
    publicationDate,
    publicationYear: isoYear(publicationDate) ?? null,
    venue: asString(record.venue) ?? null,
    abstract: null,
    referenceCount: null,
    citationCount: null,
    canonicalURL: doi ? `https://doi.org/${encodeURI(doi)}` : null,
    landingURL: doi ? `https://doi.org/${encodeURI(doi)}` : null,
    matchedFields: ["citation-edge"],
    rawProvenance: [`opencitations-meta:${sourceRecordID}`],
  };
}

function parsePidList(value: string): ScholarlyIdentifiers {
  const identifiers: Record<string, string> = {};
  for (const match of value.matchAll(/\b(doi|pmid|pmcid|omid):(\S+)/giu)) {
    const scheme = match[1].toLowerCase();
    const identifier = match[2].replace(/[;,]+$/u, "");
    identifiers[scheme] =
      scheme === "doi" ? (normalizeDoi(identifier) ?? identifier) : identifier;
  }
  return identifiers;
}

function preferredIdentifier(
  identifiers: ScholarlyIdentifiers,
): string | undefined {
  if (identifiers.doi) return `doi:${identifiers.doi}`;
  if (identifiers.pmid) return `pmid:${identifiers.pmid}`;
  if (identifiers.pmcid) return `pmcid:${identifiers.pmcid}`;
  if (identifiers.omid) return `omid:${identifiers.omid}`;
  return undefined;
}

function encodePath(value: string): string {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function contractError(message: string): ProviderError {
  return new ProviderError(
    "opencitations-index",
    "provider-contract-error",
    message,
  );
}
