import { asRecord, asString, isoYear, normalizeDoi } from "./parse";
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
  const doi = normalizeDoi(identifiers.doi);
  const pmid = identifiers.pmid?.trim();
  const key = doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : undefined;
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
      throw contractError(
        "Metadata response is not a list",
        "opencitations-meta",
      );
    results.push(...body.map((value) => parseMetadata(value, ports)));
  }
  return results;
}

export function sortCitationEdges(
  edges: readonly CitationEdge[],
): readonly CitationEdge[] {
  const unique = new Map<string, CitationEdge>();
  for (const edge of edges) {
    const key = stableEdgeKey(edge);
    const current = unique.get(key);
    if (!current) {
      unique.set(key, edge);
      continue;
    }
    const preferred = compareEdges(edge, current) < 0 ? edge : current;
    unique.set(key, {
      ...preferred,
      rawProvenance: [
        ...new Set([...current.rawProvenance, ...edge.rawProvenance]),
      ],
    });
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
  if (edge.identifiers.doi) return `doi:${edge.identifiers.doi}`;
  if (edge.identifiers.pmid) return `pmid:${edge.identifiers.pmid}`;
  if (edge.identifiers.omid) return `omid:${edge.identifiers.omid}`;
  return `oci:${edge.sourceRecordID}`;
}

function parseEdge(value: unknown): CitationEdge {
  const record = asRecord(value);
  const ociSegments = parseTransportSegments(record?.oci, "oci");
  const citingSegments = parseTransportSegments(record?.citing, "citing");
  const citedSegments = parseTransportSegments(record?.cited, "cited");
  const creationSegments = parseTransportSegments(
    record?.creation,
    "creation",
    false,
  );
  const sourceRecordID = ociSegments[0]?.value;
  if (!sourceRecordID || citingSegments.length === 0) {
    throw contractError("Citation edge has no OCI or citing identifier");
  }
  const creationValues = creationSegments.map(({ value }) =>
    normalizeCreation(value),
  );
  const creation = creationValues.find((entry) => entry !== null) ?? null;
  return {
    sourceRecordID,
    identifiers: mergeSegmentIdentifiers(citingSegments),
    creation,
    rawProvenance: [
      ...ociSegments,
      ...citingSegments,
      ...citedSegments,
      ...creationSegments,
    ].map(({ field, raw }) => `opencitations-index:${field}:${raw}`),
  };
}

function parseMetadata(
  value: unknown,
  ports: ProviderPorts,
): ScholarlyCandidate {
  const record = asRecord(value);
  if (!record)
    throw contractError("Metadata row is not an object", "opencitations-meta");
  const identifiers = parsePidList(asString(record.id) ?? "");
  const sourceRecordID =
    identifiers.omid ??
    identifiers.doi ??
    identifiers.pmid ??
    asString(record.id);
  if (!sourceRecordID)
    throw contractError("Metadata row has no identity", "opencitations-meta");
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
  const pmid = identifiers.pmid?.trim();
  const canonicalURL = doi
    ? `https://doi.org/${encodeURI(doi)}`
    : pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`
      : null;
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
    canonicalURL,
    landingURL: canonicalURL,
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

type TransportSegment = Readonly<{
  field: string;
  index?: string;
  value: string;
  raw: string;
}>;

function parseTransportSegments(
  value: unknown,
  field: string,
  required = true,
): readonly TransportSegment[] {
  const text = asString(value);
  if (!text) {
    if (required) throw contractError(`Citation edge has no ${field}`);
    return [];
  }
  const parts = /^\[[^\]]+\]\s*=>/u.test(text)
    ? text.split(/;\s*(?=\[[^\]]+\]\s*=>)/u)
    : [text];
  return parts.map((part) => {
    const raw = part.trim();
    const prefixed = /^\[([^\]]+)\]\s*=>\s*(.+)$/u.exec(raw);
    const normalized = (prefixed?.[2] ?? raw).trim();
    if (!normalized) throw contractError(`Citation ${field} segment is empty`);
    return {
      field,
      ...(prefixed ? { index: prefixed[1].trim() } : {}),
      value: normalized,
      raw,
    };
  });
}

function mergeSegmentIdentifiers(
  segments: readonly TransportSegment[],
): ScholarlyIdentifiers {
  const merged: Record<string, string> = {};
  for (const { value } of segments) {
    const identifiers = parsePidList(value);
    if (Object.keys(identifiers).length === 0) {
      throw contractError("Citation identifier segment has no stable identity");
    }
    for (const [scheme, identifier] of Object.entries(identifiers)) {
      if (merged[scheme] && merged[scheme] !== identifier) {
        throw contractError(
          `Citation identifier segments conflict for ${scheme}`,
        );
      }
      merged[scheme] = identifier;
    }
  }
  return merged;
}

function normalizeCreation(value: string): string | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(value);
  if (!match) {
    throw contractError("Citation creation date has an invalid format");
  }
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  if (month !== undefined && (month < 1 || month > 12)) {
    throw contractError("Citation creation date has an invalid month");
  }
  if (day !== undefined) {
    const lastDay = new Date(
      Date.UTC(Number(match[1]), month!, 0),
    ).getUTCDate();
    if (day < 1 || day > lastDay) {
      throw contractError("Citation creation date has an invalid day");
    }
  }
  return value;
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

function contractError(
  message: string,
  source: "opencitations-index" | "opencitations-meta" = "opencitations-index",
): ProviderError {
  return new ProviderError(source, "provider-contract-error", message);
}
