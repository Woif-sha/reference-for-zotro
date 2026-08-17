import type { RecommendationModelIdentity } from "../model/configured-recommendation-model";
import type { PaperIdentity } from "../domain/literature";
import type {
  RecommendationItem,
  RecommendationSource,
} from "../recommendation/related-paper-recommendation";
import { createLiteratureCacheDirectory } from "./cache-key";

export type RecommendationCacheIdentity = Readonly<{
  currentPaper: Readonly<
    PaperIdentity & {
      fullMdSha256: string;
    }
  >;
  visibleCandidates: readonly Readonly<{
    candidateKey: string;
    paperID: string;
    title: string;
    sources: readonly RecommendationSource[];
  }>[];
  analyzedCandidates: readonly Readonly<{
    candidateKey: string;
    abstract: string;
  }>[];
  model: RecommendationModelIdentity;
  promptVersion: number;
}>;

export type RecommendationCacheResult = Readonly<{
  priority: readonly RecommendationItem[];
  optional: readonly RecommendationItem[];
}>;

export interface RecommendationCacheStorage {
  read(directory: string): Promise<string | undefined>;
  write(directory: string, value: string, signal?: AbortSignal): Promise<void>;
}

type RecommendationCacheFile = RecommendationCacheIdentity &
  RecommendationCacheResult & {
    schemaVersion: 1;
    generatedAt: string;
  };

export class RecommendationCacheRepository {
  constructor(private readonly storage: RecommendationCacheStorage) {}

  async read(
    identity: RecommendationCacheIdentity,
  ): Promise<RecommendationCacheResult | undefined> {
    const raw = await this.storage.read(
      createLiteratureCacheDirectory(identity.currentPaper),
    );
    if (raw === undefined) return undefined;
    const file = parseCacheFile(JSON.parse(raw));
    if (!matchesIdentity(cacheIdentity(file), identity)) {
      return undefined;
    }
    return { priority: file.priority, optional: file.optional };
  }

  async write(
    identity: RecommendationCacheIdentity,
    result: RecommendationCacheResult,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const file: RecommendationCacheFile = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      ...identity,
      ...result,
    };
    parseCacheFile(file);
    await this.storage.write(
      createLiteratureCacheDirectory(identity.currentPaper),
      `${JSON.stringify(file, null, 2)}\n`,
      signal,
    );
    throwIfAborted(signal);
  }
}

function cacheIdentity(
  file: RecommendationCacheFile,
): RecommendationCacheIdentity {
  return {
    currentPaper: file.currentPaper,
    visibleCandidates: file.visibleCandidates,
    analyzedCandidates: file.analyzedCandidates,
    model: file.model,
    promptVersion: file.promptVersion,
  };
}

function matchesIdentity(
  cached: RecommendationCacheIdentity,
  current: RecommendationCacheIdentity,
): boolean {
  return (
    JSON.stringify(cached.currentPaper) ===
      JSON.stringify(current.currentPaper) &&
    JSON.stringify(cached.visibleCandidates) ===
      JSON.stringify(current.visibleCandidates) &&
    JSON.stringify(cached.model) === JSON.stringify(current.model) &&
    cached.promptVersion === current.promptVersion &&
    current.analyzedCandidates.every((candidate) =>
      cached.analyzedCandidates.some(
        (cachedCandidate) =>
          cachedCandidate.candidateKey === candidate.candidateKey &&
          cachedCandidate.abstract === candidate.abstract,
      ),
    )
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCacheFile(value: unknown): RecommendationCacheFile {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return invalidCache("schema is invalid");
  }
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "generatedAt",
      "currentPaper",
      "visibleCandidates",
      "analyzedCandidates",
      "model",
      "promptVersion",
      "priority",
      "optional",
    ]) ||
    typeof value.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    !Number.isInteger(value.promptVersion) ||
    Number(value.promptVersion) < 1 ||
    !Array.isArray(value.visibleCandidates) ||
    !Array.isArray(value.analyzedCandidates) ||
    !Array.isArray(value.priority) ||
    !Array.isArray(value.optional)
  ) {
    return invalidCache("root fields are invalid");
  }
  validateCurrentPaper(value.currentPaper);
  validateModel(value.model);
  const visibleCandidates = value.visibleCandidates.map(
    validateVisibleCandidate,
  );
  const visibleByKey = uniqueByCandidateKey(
    visibleCandidates,
    "visible candidate identities are invalid",
  );
  const analyzedCandidates = value.analyzedCandidates.map(
    validateAnalyzedCandidate,
  );
  if (analyzedCandidates.length === 0) {
    return invalidCache("completed result is an empty placeholder");
  }
  const analyzedByKey = uniqueByCandidateKey(
    analyzedCandidates,
    "analyzed candidate identities are invalid",
  );
  for (const candidateKey of analyzedByKey.keys()) {
    if (!visibleByKey.has(candidateKey)) {
      return invalidCache("analyzed candidate is not visible");
    }
  }
  if (value.priority.length > 5) {
    return invalidCache("priority result is damaged");
  }
  const seen = new Set<string>();
  const validateResult = (item: unknown): RecommendationItem => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, [
        "candidateKey",
        "paperID",
        "title",
        "sources",
        "reason",
      ]) ||
      !isNonEmptyString(item.candidateKey) ||
      !isNonEmptyString(item.paperID) ||
      !isNonEmptyString(item.title) ||
      !isSources(item.sources) ||
      !isValidReason(item.reason) ||
      seen.has(item.candidateKey)
    ) {
      return invalidCache("result set is damaged");
    }
    const visible = visibleByKey.get(item.candidateKey);
    if (
      !visible ||
      visible.paperID !== item.paperID ||
      visible.title !== item.title ||
      JSON.stringify(visible.sources) !== JSON.stringify(item.sources)
    ) {
      return invalidCache("result identity is damaged");
    }
    seen.add(item.candidateKey);
    return item as RecommendationItem;
  };
  value.priority.map(validateResult);
  value.optional.map(validateResult);
  if (
    seen.size !== analyzedByKey.size ||
    [...analyzedByKey.keys()].some((candidateKey) => !seen.has(candidateKey))
  ) {
    return invalidCache("result set is damaged");
  }
  return value as RecommendationCacheFile;
}

function validateCurrentPaper(value: unknown): void {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "libraryID",
      "attachmentID",
      "attachmentKey",
      "parentItemKey",
      "sourceFingerprint",
      "fullMdSha256",
    ]) ||
    !Number.isInteger(value.libraryID) ||
    Number(value.libraryID) < 0 ||
    !Number.isInteger(value.attachmentID) ||
    Number(value.attachmentID) < 0 ||
    !isItemKey(value.attachmentKey) ||
    !isItemKey(value.parentItemKey) ||
    !isNonEmptyString(value.sourceFingerprint) ||
    !isNonEmptyString(value.fullMdSha256)
  ) {
    invalidCache("Current paper identity is invalid");
  }
}

function validateModel(value: unknown): void {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "authMode",
      "providerId",
      "providerName",
      "modelId",
      "model",
      "apiBase",
      "effort",
    ]) ||
    (value.authMode !== "codex_auth" &&
      value.authMode !== "openai_compatible") ||
    !isNonEmptyString(value.providerId) ||
    !isNonEmptyString(value.providerName) ||
    !isNonEmptyString(value.modelId) ||
    !isNonEmptyString(value.model) ||
    !isNonEmptyString(value.apiBase) ||
    typeof value.effort !== "string"
  ) {
    invalidCache("model identity is invalid");
  }
}

function validateVisibleCandidate(value: unknown) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["candidateKey", "paperID", "title", "sources"]) ||
    !isNonEmptyString(value.candidateKey) ||
    !isNonEmptyString(value.paperID) ||
    !isNonEmptyString(value.title) ||
    !isSources(value.sources)
  ) {
    return invalidCache("visible candidate is invalid");
  }
  return value as RecommendationCacheIdentity["visibleCandidates"][number];
}

function validateAnalyzedCandidate(value: unknown) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["candidateKey", "abstract"]) ||
    !isNonEmptyString(value.candidateKey) ||
    !isNonEmptyString(value.abstract)
  ) {
    return invalidCache("analyzed candidate is invalid");
  }
  return value as RecommendationCacheIdentity["analyzedCandidates"][number];
}

function uniqueByCandidateKey<T extends { candidateKey: string }>(
  values: readonly T[],
  message: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (result.has(value.candidateKey)) return invalidCache(message);
    result.set(value.candidateKey, value);
  }
  return result;
}

function isSources(value: unknown): value is readonly RecommendationSource[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((source) => source === "reference" || source === "citation") &&
    new Set(value).size === value.length
  );
}

function isValidReason(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    !/[\r\n\u2028\u2029]/u.test(value) &&
    [...value].length <= 240
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isItemKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]+$/iu.test(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function invalidCache(message: string): never {
  throw new Error(`Recommendation cache is invalid: ${message}`);
}
