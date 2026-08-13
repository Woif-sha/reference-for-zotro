import type { ReferenceMatchBasis } from "../domain/literature";
import type {
  ProviderOutcome,
  ReferenceResolution,
  VerifiedScholarlyCandidate,
} from "../literature/gateway";
import type { ScholarlyCandidate } from "../literature/providers/types";
import type { ReaderPaper } from "../reader/mountReaderSection";

export function resolutionToReaderPaper(
  ordinal: number,
  displayTitle: string,
  resolution: ReferenceResolution,
): ReaderPaper {
  if (resolution.status === "resolved") {
    return candidateToReaderPaper(
      resolution.primaryResult,
      ordinal,
      resolution.matchedBy,
      resolution.outcomes,
    );
  }
  if (resolution.status === "ambiguous") {
    return unresolvedPaper(
      ordinal,
      displayTitle,
      "Multiple candidates have indistinguishable evidence",
      "ambiguous",
      formatCandidateDiagnostics(resolution.candidates),
      formatProviderFailures(resolution.outcomes),
    );
  }
  if (resolution.status === "unresolved") {
    return unresolvedPaper(
      ordinal,
      displayTitle,
      resolution.reason === "no-candidate"
        ? "No confirmed candidate"
        : resolution.reason === "incomplete-metadata"
          ? "Confirmed candidate metadata is incomplete"
          : "Paper landing page is unreachable",
      resolution.reason === "unreachable-landing-page"
        ? "unreachable"
        : "unresolved",
      resolution.candidates?.length
        ? formatCandidateDiagnostics(resolution.candidates)
        : undefined,
      formatProviderFailures(resolution.outcomes),
    );
  }
  const codes = resolution.outcomes
    .filter(({ status }) => status === "failed")
    .map(({ source, errorCode }) => `${source}: ${errorCode ?? "failed"}`)
    .join("; ");
  return unresolvedPaper(
    ordinal,
    displayTitle,
    codes || "Related-literature provider failed",
    "failed",
  );
}

export function candidateToReaderPaper(
  candidate: VerifiedScholarlyCandidate,
  ordinal = 0,
  matchedBy?: ReferenceMatchBasis,
  outcomes: readonly ProviderOutcome[] = [],
): ReaderPaper {
  if (!candidate.landingURL) {
    throw new Error("Resolved paper has no verified Paper landing page");
  }
  if (!candidate.title) {
    throw new Error("Resolved paper has no title");
  }
  return {
    id: `${candidate.source}:${candidate.sourceRecordID}:${ordinal}`,
    ordinal,
    title: candidate.title,
    authors:
      candidate.authors.length > 0
        ? candidate.authors
            .map(({ family, given }) =>
              [given, family].filter(Boolean).join(" "),
            )
            .join(", ")
        : undefined,
    venue: candidate.venue ?? undefined,
    year: candidate.publicationYear?.toString(),
    status: "resolved",
    primaryResultURL: candidate.landingURL,
    matchedBy,
    doi: candidate.identifiers.doi,
    arxivID: candidate.identifiers.arxiv,
    pmcid: candidate.identifiers.pmcid,
    abstract: stripMarkup(candidate.abstract),
    abstractSource: candidate.abstractSource,
    citationCount: candidate.citationCount ?? undefined,
    referenceCount: candidate.referenceCount ?? undefined,
    source: candidate.source,
    sourceRecordID: candidate.sourceRecordID,
    retrievedAt: candidate.retrievedAt,
    matchedFields: candidate.matchedFields,
    rawProvenance: candidate.rawProvenance,
    metadataIncomplete:
      candidate.authors.length === 0 ||
      (!candidate.publicationDate && candidate.publicationYear === null) ||
      !candidate.venue,
    providerFailures: formatProviderFailures(outcomes),
    connectedPaperInfo: formatConnectionInfo(candidate.rawProvenance),
  };
}

export function unresolvedPaper(
  ordinal: number,
  title: string,
  statusText: string,
  status:
    | "unresolved"
    | "ambiguous"
    | "invalid-identifier"
    | "unreachable"
    | "failed",
  connectedPaperInfo?: string,
  providerFailures: readonly string[] = [],
): ReaderPaper {
  return {
    id: `reference:${ordinal}`,
    ordinal,
    title,
    status,
    statusText,
    connectedPaperInfo,
    providerFailures,
  };
}

function formatProviderFailures(
  outcomes: readonly ProviderOutcome[],
): readonly string[] {
  return outcomes
    .filter(({ status }) => status === "failed")
    .map(
      ({ source, errorCode }) =>
        `${source}: ${errorCode ?? "provider-failure"}`,
    );
}

function formatCandidateDiagnostics(
  candidates: readonly ScholarlyCandidate[],
): string {
  return candidates
    .map(
      ({ source, sourceRecordID, retrievedAt, matchedFields }) =>
        `${source}:${sourceRecordID} retrieved ${retrievedAt}; matched by ${
          matchedFields.join(", ") || "none"
        }`,
    )
    .join(" | ");
}

function formatConnectionInfo(
  rawProvenance: readonly string[],
): string | undefined {
  const connection = rawProvenance.find((entry) =>
    entry.startsWith("opencitations-index:"),
  );
  return connection
    ? `Connected via ${connection.replace(/^opencitations-index:/u, "")}`
    : undefined;
}

function stripMarkup(value: string | null): string | undefined {
  const normalized = value
    ?.replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || undefined;
}
