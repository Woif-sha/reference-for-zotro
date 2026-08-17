import { decodeHTML } from "entities";

import { normalizeDoi } from "../identifiers";
import { asArray, asNumber, asRecord, asString } from "./parse";
import { getJson } from "./transport";
import { ProviderError, type ProviderPorts } from "./types";

export type OpenAlexAbstract = Readonly<{
  text: string;
  source: "openalex";
  sourceRecordID: string;
}>;

export async function lookupOpenAlexAbstract(
  doi: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<OpenAlexAbstract> {
  const normalizedDoi = normalizeDoi(doi);
  if (!normalizedDoi) {
    throw new ProviderError(
      "openalex",
      "invalid-provider-query",
      "OpenAlex Abstract lookup requires a DOI",
    );
  }
  const body = asRecord(
    await getJson(
      "openalex",
      `https://api.openalex.org/works/https://doi.org/${encodeURI(normalizedDoi)}`,
      ports,
      signal,
      apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : undefined,
    ),
  );
  const sourceRecordID = asString(body?.id);
  const responseDoi = normalizeDoi(asString(body?.doi));
  if (!body || !sourceRecordID || responseDoi !== normalizedDoi) {
    throw new ProviderError(
      "openalex",
      "provider-contract-error",
      "OpenAlex returned a mismatched DOI record",
    );
  }
  const abstract = restoreAbstract(body.abstract_inverted_index);
  if (!abstract) {
    throw new ProviderError(
      "openalex",
      "no-candidate",
      "OpenAlex record has no Abstract",
    );
  }
  return { text: abstract, source: "openalex", sourceRecordID };
}

function restoreAbstract(value: unknown): string | undefined {
  const invertedIndex = asRecord(value);
  if (!invertedIndex) return undefined;
  const positionedWords: Array<readonly [number, string]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of asArray(positions).map(asNumber)) {
      if (
        position !== undefined &&
        Number.isInteger(position) &&
        position >= 0
      ) {
        positionedWords.push([position, word]);
      }
    }
  }
  const text = positionedWords
    .sort(([left], [right]) => left - right)
    .map(([, word]) => word)
    .join(" ")
    .trim();
  return text ? decodeHTML(text) : undefined;
}
