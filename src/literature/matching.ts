import type {
  ScholarlyCandidate,
  ScholarlyIdentifiers,
} from "./providers/types";
import { decodeHTML } from "entities";

import type { ReferenceMatchBasis } from "../domain/literature";

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
    const expected = normalizeIdentifier(paper.identifiers[key]);
    if (!expected) continue;
    const exact = candidates.filter(
      (candidate) =>
        normalizeIdentifier(candidate.identifiers[key]) === expected &&
        !hasConflictingIdentifier(paper.identifiers, candidate.identifiers),
    );
    if (exact.length > 0) {
      const matched = exact.map((candidate) =>
        withMatchedFields(candidate, [key]),
      );
      return {
        status: "confirmed",
        candidate: matched[0],
        candidates: matched,
        matchedBy: key,
        score: 1,
      };
    }
  }

  const expectedTitle = normalizeText(paper.title ?? "");
  if (!expectedTitle || paper.year === null) {
    return { status: "no-candidate" };
  }
  const exact = candidates.filter(
    (candidate) =>
      normalizeText(candidate.title ?? "") === expectedTitle &&
      candidate.publicationYear === paper.year,
  );
  if (exact.length === 0) return { status: "no-candidate" };
  const matched = exact.map((candidate) =>
    withMatchedFields(candidate, metadataMatchedFields(paper, candidate)),
  );
  if (matched.length > 1) {
    return {
      status: "ambiguous",
      candidates: matched,
    };
  }
  if (hasConflictingIdentifier(paper.identifiers, exact[0].identifiers)) {
    return { status: "no-candidate" };
  }
  return {
    status: "confirmed",
    candidate: matched[0],
    candidates: [matched[0]],
    matchedBy: "metadata",
    score: 1,
  };
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
    const left = normalizeIdentifier(expected[key]);
    const right = normalizeIdentifier(actual[key]);
    return left !== undefined && right !== undefined && left !== right;
  });
}

function normalizeIdentifier(value: string | undefined): string | undefined {
  return value?.normalize("NFKC").trim().toLowerCase();
}

function normalizeText(value: string): string {
  return decodeHTML(value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeFamilyName(value: string): string {
  return normalizeText(value).replace(/^(?:da|de|di|la|le|van|von)\s+/u, "");
}
