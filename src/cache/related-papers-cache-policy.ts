import type { CachedRelatedPapers } from "../application/related-papers-controller";

export type CacheWriteDecision =
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "write"; value: CachedRelatedPapers }>;

export function decideRelatedPapersCacheWrite(
  results: CachedRelatedPapers,
): CacheWriteDecision {
  return results.references.some(({ status }) => status === "matching")
    ? { kind: "skip" }
    : { kind: "write", value: results };
}
