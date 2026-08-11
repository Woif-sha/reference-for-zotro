import { getJson } from "./transport";
import { normalizeDoi } from "../identifiers";
import { asRecord, asString } from "./parse";
import { ProviderError, type ProviderPorts } from "./types";

export type SemanticScholarAbstract = Readonly<{
  text: string;
  source: "semantic-scholar";
  sourceRecordID: string;
}>;

export async function lookupSemanticScholarAbstract(
  doi: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<SemanticScholarAbstract> {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) {
    throw new ProviderError(
      "semantic-scholar",
      "invalid-provider-query",
      "Semantic Scholar Abstract lookup requires a DOI",
    );
  }
  const paperIdentifier = encodeURIComponent(`DOI:${normalizedDoi}`);
  const body = asRecord(
    await getJson(
      "semantic-scholar",
      `https://api.semanticscholar.org/graph/v1/paper/${paperIdentifier}?fields=paperId,externalIds,abstract`,
      ports,
      signal,
    ),
  );
  const sourceRecordID = asString(body?.paperId);
  const responseDoi = normalizeDoi(asString(asRecord(body?.externalIds)?.DOI));
  if (!body || !sourceRecordID || responseDoi !== normalizedDoi) {
    throw new ProviderError(
      "semantic-scholar",
      "provider-contract-error",
      "Semantic Scholar returned a mismatched DOI record",
    );
  }
  const text = asString(body.abstract)?.trim();
  if (!text) {
    throw new ProviderError(
      "semantic-scholar",
      "no-candidate",
      "Semantic Scholar record has no Abstract",
    );
  }
  return { text, source: "semantic-scholar", sourceRecordID };
}
