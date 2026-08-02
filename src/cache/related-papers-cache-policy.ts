import type { CachedRelatedPapers } from "../application/related-papers-controller";
import type { ReaderPaper } from "../reader/mountReaderSection";

const CONFIRMED_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;
const UNCONFIRMED_TTL_MILLISECONDS = 60 * 60 * 1000;

export type CachedPaperEnvelope = Readonly<{
  expiresAt: string;
  results: CachedRelatedPapers;
}>;

export type CacheWriteDecision =
  | Readonly<{ kind: "remove" }>
  | Readonly<{ kind: "write"; value: CachedPaperEnvelope }>;

export function decideRelatedPapersCacheWrite(
  results: CachedRelatedPapers,
  now: number,
): CacheWriteDecision {
  const hasFailure = results.references.some(
    ({ status, providerFailures }) =>
      status === "failed" ||
      status === "unreachable" ||
      Boolean(providerFailures?.length),
  );
  if (hasFailure) return { kind: "remove" };

  const hasUnconfirmed = results.references.some(
    ({ status }) => status !== "resolved",
  );
  const ttlMilliseconds = hasUnconfirmed
    ? UNCONFIRMED_TTL_MILLISECONDS
    : CONFIRMED_TTL_MILLISECONDS;
  return {
    kind: "write",
    value: {
      expiresAt: new Date(now + ttlMilliseconds).toISOString(),
      results: {
        ...results,
        references: results.references.map(preparePaperForCache),
        citingPapers: results.citingPapers.map(preparePaperForCache),
      },
    },
  };
}

export function preparePaperForCache(paper: ReaderPaper): ReaderPaper {
  if (
    paper.source !== "crossref" ||
    (paper.abstractSource && paper.abstractSource !== "crossref")
  ) {
    return paper;
  }
  const sanitized = { ...paper };
  delete sanitized.abstract;
  return sanitized;
}
