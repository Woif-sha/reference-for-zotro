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

export type OpenAlexConnectionResult = Readonly<{
  dailyRemainingUsd: number;
}>;

export async function testOpenAlexConnection(
  apiKey: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<OpenAlexConnectionResult> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) throw new Error("请先填写 API Key");

  const url = new URL("https://api.openalex.org/rate-limit");
  url.searchParams.set("api_key", normalizedApiKey);
  let response: Response;
  try {
    response = await ports.fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new Error("无法连接 OpenAlex API");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("API Key 无效或无权查询额度");
  }
  if (response.status === 429) {
    throw new Error("OpenAlex API 额度已用尽");
  }
  if (!response.ok) {
    throw new Error(`OpenAlex 服务返回 HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("OpenAlex 返回了无效响应");
  }
  const rateLimit = asRecord(asRecord(body)?.rate_limit);
  const dailyRemainingUsd = asNumber(rateLimit?.daily_remaining_usd);
  if (dailyRemainingUsd === undefined || dailyRemainingUsd < 0) {
    throw new Error("OpenAlex 返回了无效余额信息");
  }
  return { dailyRemainingUsd };
}

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
