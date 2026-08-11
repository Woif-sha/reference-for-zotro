import type {
  ScholarlyCandidate,
  ScholarlyIdentifiers,
} from "./providers/types";
import { decodeHTML } from "entities";

import type { ReferenceMatchBasis } from "../domain/literature";
import { normalizeScholarlyIdentifier } from "./identifiers";

export type MatchablePaper = Readonly<{
  identifiers: ScholarlyIdentifiers;
  title: string | null;
  authors: readonly string[];
  year: number | null;
}>;

export type CandidateMatch =
  | Readonly<{
      status: "confirmed";
      candidate: ScholarlyCandidate;
      candidates: readonly ScholarlyCandidate[];
      matchedBy: ReferenceMatchBasis;
      score: number;
    }>
  | Readonly<{
      status: "no-candidate";
    }>
  | Readonly<{
      status: "ambiguous";
      candidates: readonly ScholarlyCandidate[];
    }>;

const IDENTIFIER_KEYS = ["doi", "arxiv", "pmid", "pmcid", "omid"] as const;

export function matchScholarlyCandidates(
  paper: MatchablePaper,
  candidates: readonly ScholarlyCandidate[],
): CandidateMatch {
  for (const key of IDENTIFIER_KEYS) {
    const expected = normalizeScholarlyIdentifier(key, paper.identifiers[key]);
    if (!expected) continue;
    const identifierCandidates = candidates.filter(
      (candidate) =>
        normalizeScholarlyIdentifier(key, candidate.identifiers[key]) ===
          expected &&
        !hasConflictingIdentifier(paper.identifiers, candidate.identifiers),
    );
    if (identifierCandidates.length > 0) {
      const identifierMatches = identifierCandidates.map((candidate) =>
        withMatchedFields(candidate, [key]),
      );
      if (
        identifierMatches.length > 1 &&
        !formsSingleStableIdentity(identifierCandidates)
      ) {
        return {
          status: "ambiguous",
          candidates: identifierMatches,
        };
      }
      return {
        status: "confirmed",
        candidate: identifierMatches[0],
        candidates: identifierMatches,
        matchedBy: key,
        score: 1,
      };
    }
  }

  const expectedTitle = normalizeText(paper.title ?? "");
  if (!expectedTitle || paper.year === null) {
    return { status: "no-candidate" };
  }
  const bibliographicCandidates = candidates.filter(
    (candidate) =>
      normalizeText(candidate.title ?? "") === expectedTitle &&
      candidate.publicationYear === paper.year,
  );
  if (bibliographicCandidates.length === 0) {
    return { status: "no-candidate" };
  }
  const bibliographicMatches = bibliographicCandidates.map((candidate) =>
    withMatchedFields(candidate, metadataMatchedFields(paper, candidate)),
  );
  if (
    bibliographicMatches.length > 1 &&
    !formsSingleStableIdentity(bibliographicCandidates)
  ) {
    return {
      status: "ambiguous",
      candidates: bibliographicMatches,
    };
  }
  if (
    bibliographicCandidates.some((candidate) =>
      hasConflictingIdentifier(paper.identifiers, candidate.identifiers),
    )
  ) {
    return { status: "no-candidate" };
  }
  return {
    status: "confirmed",
    candidate: bibliographicMatches[0],
    candidates: bibliographicMatches,
    matchedBy: "metadata",
    score: 1,
  };
}

function formsSingleStableIdentity(
  candidates: readonly ScholarlyCandidate[],
): boolean {
  if (
    IDENTIFIER_KEYS.some((key) => {
      const values = new Set(
        candidates
          .map((candidate) =>
            normalizeScholarlyIdentifier(key, candidate.identifiers[key]),
          )
          .filter((value): value is string => value !== undefined),
      );
      return values.size > 1;
    })
  ) {
    return false;
  }
  const connected = new Set<number>([0]);
  let previousSize = -1;
  while (connected.size !== previousSize) {
    previousSize = connected.size;
    for (let index = 1; index < candidates.length; index += 1) {
      if (connected.has(index)) continue;
      const candidate = candidates[index];
      if (
        [...connected].some((connectedIndex) =>
          hasStableIdentityAgreement(
            candidates[connectedIndex].identifiers,
            candidate.identifiers,
          ),
        )
      ) {
        connected.add(index);
      }
    }
  }
  return connected.size === candidates.length;
}

function hasStableIdentityAgreement(
  left: ScholarlyIdentifiers,
  right: ScholarlyIdentifiers,
): boolean {
  let agreement = false;
  for (const key of IDENTIFIER_KEYS) {
    const leftValue = normalizeScholarlyIdentifier(key, left[key]);
    const rightValue = normalizeScholarlyIdentifier(key, right[key]);
    if (!leftValue || !rightValue) continue;
    if (leftValue !== rightValue) return false;
    agreement = true;
  }
  return agreement;
}

function metadataMatchedFields(
  paper: MatchablePaper,
  candidate: ScholarlyCandidate,
): readonly string[] {
  const expectedAuthors = paper.authors
    .map(normalizeFamilyName)
    .filter(Boolean);
  const actualAuthors = candidate.authors
    .map(({ family }) => normalizeFamilyName(family))
    .filter(Boolean);
  const firstAuthorMatches =
    expectedAuthors.length > 0 && expectedAuthors[0] === actualAuthors[0];
  const authorsOverlap = expectedAuthors.some((author) =>
    actualAuthors.includes(author),
  );
  return [
    "title",
    ...(firstAuthorMatches ? ["first-author"] : []),
    ...(authorsOverlap ? ["authors"] : []),
    "year",
  ];
}

function withMatchedFields(
  candidate: ScholarlyCandidate,
  fields: readonly string[],
): ScholarlyCandidate {
  return {
    ...candidate,
    matchedFields: [...new Set([...candidate.matchedFields, ...fields])],
  };
}

function hasConflictingIdentifier(
  expected: ScholarlyIdentifiers,
  actual: ScholarlyIdentifiers,
): boolean {
  return IDENTIFIER_KEYS.some((key) => {
    const left = normalizeScholarlyIdentifier(key, expected[key]);
    const right = normalizeScholarlyIdentifier(key, actual[key]);
    return left !== undefined && right !== undefined && left !== right;
  });
}

function normalizeText(value: string): string {
  return decodeHTML(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeFamilyName(value: string): string {
  return normalizeText(value).replace(/^(?:da|de|di|la|le|van|von)\s+/u, "");
}
