import {
  hasStableIdentifier,
  type CandidateProviderName,
  type ScholarlyCandidate,
} from "./providers/types";

export type PrimaryResultCandidate = Readonly<{
  candidate: ScholarlyCandidate;
  confirmed: boolean;
  reachability: "reachable" | "unreachable";
}>;

const AUTHORITY: Readonly<Record<CandidateProviderName, number>> = {
  crossref: 2,
  datacite: 2,
  "opencitations-meta": 1,
  "opencitations-index": 0,
};

export function selectPrimaryResult(
  options: readonly PrimaryResultCandidate[],
): ScholarlyCandidate | undefined {
  return options
    .filter(
      ({ candidate, confirmed, reachability }) =>
        confirmed &&
        reachability === "reachable" &&
        hasRequiredResolutionMetadata(candidate) &&
        candidate.landingURL !== null &&
        candidate.landingURL.startsWith("https://"),
    )
    .sort(
      (left, right) =>
        AUTHORITY[right.candidate.source] - AUTHORITY[left.candidate.source] ||
        completeness(right.candidate) - completeness(left.candidate) ||
        left.candidate.source.localeCompare(right.candidate.source) ||
        left.candidate.sourceRecordID.localeCompare(
          right.candidate.sourceRecordID,
        ),
    )[0]?.candidate;
}

export function hasRequiredResolutionMetadata(
  candidate: ScholarlyCandidate,
): boolean {
  return Boolean(candidate.title) && hasStableIdentifier(candidate.identifiers);
}

function completeness(candidate: ScholarlyCandidate): number {
  return (
    (candidate.title ? 2 : 0) +
    (candidate.authors.length > 0 ? 2 : 0) +
    (candidate.publicationDate || candidate.publicationYear ? 2 : 0) +
    (candidate.venue ? 1 : 0) +
    (candidate.identifiers.doi ? 1 : 0) +
    (candidate.referenceCount !== null ? 0.5 : 0) +
    (candidate.citationCount !== null ? 0.5 : 0) +
    (candidate.landingURL?.startsWith("https://") ? 1 : 0)
  );
}
