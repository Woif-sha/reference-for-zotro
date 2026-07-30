import type {
  ScholarlyCandidate,
  ScholarlyIdentifiers,
} from "./providers/types";

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
      matchedBy: keyof ScholarlyIdentifiers | "metadata";
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
      return {
        status: "confirmed",
        candidate: exact[0],
        candidates: exact,
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
        firstAuthorMatches,
        yearDifference,
        total,
      }) =>
        titleScore >= 0.9 &&
        authorScore >= 0.5 &&
        firstAuthorMatches &&
        (yearDifference === null || yearDifference <= 1) &&
        total >= 0.85,
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
  if (eligible.length > 1 && eligible[0].total - eligible[1].total < 0.08) {
    return {
      status: "ambiguous",
      candidates: eligible.map(({ candidate }) => candidate),
    };
  }
  return {
    status: "confirmed",
    candidate: eligible[0].candidate,
    candidates: [eligible[0].candidate],
    matchedBy: "metadata",
    score: eligible[0].total,
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
  firstAuthorMatches: boolean;
  yearDifference: number | null;
  total: number;
}> {
  const titleScore = diceCoefficient(
    wordBigrams(normalizeText(paper.title ?? "")),
    wordBigrams(normalizeText(candidate.title ?? "")),
  );
  const expectedAuthors = new Set(
    paper.authors.map(normalizeText).filter(Boolean),
  );
  const actualAuthors = new Set(
    candidate.authors
      .map(({ family }) => normalizeText(family))
      .filter(Boolean),
  );
  const authorScore = jaccard(expectedAuthors, actualAuthors);
  const firstAuthorMatches =
    expectedAuthors.size > 0 &&
    actualAuthors.size > 0 &&
    normalizeText(paper.authors[0] ?? "") ===
      normalizeText(candidate.authors[0]?.family ?? "");
  const yearDifference =
    paper.year === null || candidate.publicationYear === null
      ? null
      : Math.abs(paper.year - candidate.publicationYear);
  const yearScore =
    yearDifference === null
      ? 0
      : yearDifference === 0
        ? 1
        : yearDifference === 1
          ? 0.5
          : 0;
  return {
    titleScore,
    authorScore,
    firstAuthorMatches,
    yearDifference,
    total: 0.65 * titleScore + 0.25 * authorScore + 0.1 * yearScore,
  };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
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
