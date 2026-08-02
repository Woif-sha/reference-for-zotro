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

  const eligible = candidates
    .map((candidate) => ({
      candidate,
      ...scoreMetadata(paper, candidate),
    }))
    .filter(
      ({
        titleScore,
        authorScore,
        hasExpectedAuthors,
        firstAuthorMatches,
        exactTitleAndYear,
        titleFormattingMatches,
        yearDifference,
        total,
      }) => {
        const strongMetadata =
          hasExpectedAuthors &&
          authorScore >= 0.7 &&
          firstAuthorMatches &&
          yearDifference !== null &&
          yearDifference <= 1;
        return (
          exactTitleAndYear ||
          ((titleScore >= 0.9 || (titleFormattingMatches && strongMetadata)) &&
            (hasExpectedAuthors
              ? authorScore >= 0.5 && firstAuthorMatches
              : titleScore >= 0.98) &&
            (yearDifference === null || yearDifference <= 1) &&
            (total >= 0.85 || (titleFormattingMatches && strongMetadata)))
        );
      },
    )
    .sort(
      (left, right) =>
        right.total - left.total ||
        left.candidate.source.localeCompare(right.candidate.source) ||
        left.candidate.sourceRecordID.localeCompare(
          right.candidate.sourceRecordID,
        ),
    );

  if (eligible.length === 0) return { status: "no-candidate" };
  const matched = eligible.map(
    ({ candidate, authorScore, firstAuthorMatches }) =>
      withMatchedFields(
        candidate,
        metadataMatchedFields(
          paper,
          candidate,
          authorScore,
          firstAuthorMatches,
        ),
      ),
  );
  const first = eligible[0];
  const second = eligible[1];
  if (
    second &&
    ((first.exactTitleAndYear && second.exactTitleAndYear) ||
      (!first.exactTitleAndYear && first.total - second.total < 0.08))
  ) {
    return {
      status: "ambiguous",
      candidates: matched,
    };
  }
  return {
    status: "confirmed",
    candidate: matched[0],
    candidates: [matched[0]],
    matchedBy: "metadata",
    score: eligible[0].total,
  };
}

function metadataMatchedFields(
  paper: MatchablePaper,
  candidate: ScholarlyCandidate,
  authorScore: number,
  firstAuthorMatches: boolean,
): readonly string[] {
  return [
    "title",
    ...(firstAuthorMatches ? ["first-author"] : []),
    ...(authorScore > 0 ? ["authors"] : []),
    ...(paper.year !== null && candidate.publicationYear !== null
      ? ["year"]
      : []),
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

function scoreMetadata(
  paper: MatchablePaper,
  candidate: ScholarlyCandidate,
): Readonly<{
  titleScore: number;
  authorScore: number;
  hasExpectedAuthors: boolean;
  firstAuthorMatches: boolean;
  exactTitleAndYear: boolean;
  titleFormattingMatches: boolean;
  yearDifference: number | null;
  total: number;
}> {
  const titleScore = diceCoefficient(
    wordBigrams(normalizeText(paper.title ?? "")),
    wordBigrams(normalizeText(candidate.title ?? "")),
  );
  const expectedAuthors = new Set(
    paper.authors.map(normalizeFamilyName).filter(Boolean),
  );
  const actualAuthors = new Set(
    candidate.authors
      .map(({ family }) => normalizeFamilyName(family))
      .filter(Boolean),
  );
  const authorScore = jaccard(expectedAuthors, actualAuthors);
  const hasExpectedAuthors = expectedAuthors.size > 0;
  const firstAuthorMatches =
    expectedAuthors.size > 0 &&
    actualAuthors.size > 0 &&
    normalizeFamilyName(paper.authors[0] ?? "") ===
      normalizeFamilyName(candidate.authors[0]?.family ?? "");
  const expectedTitle = normalizeText(paper.title ?? "");
  const actualTitle = normalizeText(candidate.title ?? "");
  const titleEquivalent = expectedTitle === actualTitle;
  const titleFormattingMatches =
    compactText(expectedTitle) === compactText(actualTitle) ||
    (actualTitle.length >= 7 && expectedTitle.startsWith(`${actualTitle} `));
  const yearDifference =
    paper.year === null || candidate.publicationYear === null
      ? null
      : Math.abs(paper.year - candidate.publicationYear);
  const exactTitleAndYear = titleEquivalent && yearDifference === 0;
  const yearScore =
    yearDifference === null
      ? 0
      : yearDifference === 0
        ? 1
        : yearDifference === 1
          ? 0.5
          : 0;
  const yearWeight = yearDifference === null ? 0 : 0.1;
  const authorWeight = hasExpectedAuthors ? 0.25 : 0;
  const totalWeight = 0.65 + authorWeight + yearWeight;
  const weightedTotal =
    (0.65 * titleScore + authorWeight * authorScore + yearWeight * yearScore) /
    totalWeight;
  return {
    titleScore,
    authorScore,
    hasExpectedAuthors,
    firstAuthorMatches,
    exactTitleAndYear,
    titleFormattingMatches,
    yearDifference,
    total: exactTitleAndYear ? 1 : weightedTotal,
  };
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

function compactText(value: string): string {
  return value.replace(/\s+/gu, "");
}

function wordBigrams(value: string): Set<string> {
  const words = value.split(" ").filter(Boolean);
  if (words.length < 2) return new Set(words);
  return new Set(
    words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`),
  );
}

function diceCoefficient(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  return (2 * intersection) / (left.size + right.size);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}
