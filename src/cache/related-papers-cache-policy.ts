import type { CachedRelatedPapers } from "../application/related-papers-controller";

export type CacheWriteDecision =
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "write"; value: CachedRelatedPapers }>;

export function decideRelatedPapersCacheWrite(
  results: CachedRelatedPapers,
): CacheWriteDecision {
  return relatedPapersCacheLifetime(results) === undefined
    ? { kind: "skip" }
    : { kind: "write", value: results };
}

export function relatedPapersCacheLifetime(
  results: CachedRelatedPapers,
): number | undefined {
  const papers = [...results.references, ...results.citingPapers];
  if (
    papers.some(
      ({ status }) =>
        status === "matching" ||
        status === "failed" ||
        status === "unreachable",
    )
  ) {
    return undefined;
  }
  const hasNegativeResult =
    papers.some(({ status }) => status === "unresolved") ||
    (results.citingPapersLoaded > 0 && results.citingPapers.length === 0);
  // A resolved snapshot also contains landing reachability, whose TTL is 24h.
  // The Reader projection does not distinguish exact 404s from empty searches.
  return (hasNegativeResult ? 1 : 24) * 60 * 60 * 1000;
}
