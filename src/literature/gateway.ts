import { matchScholarlyCandidates, type MatchablePaper } from "./matching";
import {
  selectPrimaryResult,
  type PrimaryResultCandidate,
} from "./primary-result";
import { lookupCrossrefDoi, searchCrossref } from "./providers/crossref";
import { lookupDataCiteDoi, searchDataCite } from "./providers/datacite";
import { verifyDoiLandingPage } from "./providers/doi-reachability";
import {
  fetchOpenCitationEdges,
  fetchOpenCitationMetadata,
  sortCitationEdges,
  type CitationEdge,
} from "./providers/opencitations";
import {
  ProviderError,
  type ProviderErrorCode,
  type ProviderName,
  type ProviderPorts,
  type ScholarlyCandidate,
  type ScholarlyIdentifiers,
} from "./providers/types";

export type RelatedLiteraturePorts = ProviderPorts;

export type PublicationChannel =
  | "journal"
  | "conference"
  | "book"
  | "chapter"
  | "standard"
  | "dataset"
  | "software"
  | "preprint"
  | "repository"
  | "report"
  | "unknown";

export type GatewayQueryContext = Readonly<{
  libraryID: number;
  attachmentKey: string;
  sourceFingerprint: string;
  generation: number;
  refresh?: boolean;
}>;

export type ReferenceQuery = MatchablePaper &
  Readonly<{
    venue?: string;
    channel: PublicationChannel;
    signal?: AbortSignal;
    context?: GatewayQueryContext;
  }>;

export type ProviderOutcome = Readonly<{
  source: ProviderName;
  status: "success" | "no-candidate" | "failed";
  errorCode?: ProviderErrorCode;
}>;

export type ReferenceResolution =
  | Readonly<{
      status: "resolved";
      primaryResult: ScholarlyCandidate;
      candidates: readonly ScholarlyCandidate[];
      outcomes: readonly ProviderOutcome[];
    }>
  | Readonly<{
      status: "ambiguous";
      candidates: readonly ScholarlyCandidate[];
      outcomes: readonly ProviderOutcome[];
    }>
  | Readonly<{
      status: "unresolved";
      reason: "no-candidate" | "unreachable-landing-page";
      outcomes: readonly ProviderOutcome[];
    }>
  | Readonly<{
      status: "failed";
      outcomes: readonly ProviderOutcome[];
    }>;

export type CitingPapersQuery = Readonly<{
  identifiers: ScholarlyIdentifiers;
  signal?: AbortSignal;
  context?: GatewayQueryContext;
}>;

export type CitingPapersLimit = 10 | 30 | 50;

export type CitingPapersResult =
  | Readonly<{
      status: "ready";
      papers: readonly ScholarlyCandidate[];
      limit: CitingPapersLimit;
      availableCount: number;
    }>
  | Readonly<{
      status: "no-results";
      reason: "no-citations-from-source";
      source: "opencitations-index";
      papers: readonly [];
      limit: CitingPapersLimit;
    }>
  | Readonly<{
      status: "failed";
      errorCode: ProviderErrorCode;
      source: ProviderName;
      papers: readonly [];
      limit: CitingPapersLimit;
    }>;

export interface RelatedLiteratureGateway {
  resolveReference(query: ReferenceQuery): Promise<ReferenceResolution>;
  getCitingPapers(
    query: CitingPapersQuery,
    limit: CitingPapersLimit,
  ): Promise<CitingPapersResult>;
  dispose(): void;
}

type ProviderRun = Readonly<{
  outcome: ProviderOutcome;
  candidates: readonly ScholarlyCandidate[];
}>;

type CitingPapersSession = {
  edges: readonly CitationEdge[];
  hydrated: Map<string, ScholarlyCandidate>;
  expiresAt: number;
};

export function createRelatedLiteratureGateway(
  ports: RelatedLiteraturePorts,
): RelatedLiteratureGateway {
  const reachability = new Map<
    string,
    Promise<
      | Readonly<{ status: "reachable"; landingURL: string }>
      | Readonly<{ status: "unreachable"; code: "unreachable-landing-page" }>
    >
  >();
  const citingPaperSessions = new Map<string, CitingPapersSession>();
  const citingPaperNegative = new Map<string, number>();

  async function resolveReference(
    query: ReferenceQuery,
  ): Promise<ReferenceResolution> {
    const plans = referencePlans(query, ports);
    const runs = await Promise.all(plans);
    const outcomes = runs.map(({ outcome }) => outcome);
    const candidates = runs.flatMap(({ candidates: values }) => values);
    const match = matchScholarlyCandidates(query, candidates);
    if (match.status === "ambiguous") {
      return { status: "ambiguous", candidates: match.candidates, outcomes };
    }
    if (match.status === "no-candidate") {
      return outcomes.some(({ status }) => status === "failed")
        ? { status: "failed", outcomes }
        : { status: "unresolved", reason: "no-candidate", outcomes };
    }

    const reachableCandidates = await Promise.all(
      match.candidates.map((candidate) =>
        withVerifiedLanding(
          candidate,
          ports,
          reachability,
          contextKey(query.context),
          query.signal,
        ),
      ),
    );
    const options: PrimaryResultCandidate[] = reachableCandidates.map(
      ({ candidate, reachable }) => ({
        candidate,
        confirmed: true,
        reachability: reachable ? "reachable" : "unreachable",
      }),
    );
    const primaryResult = selectPrimaryResult(options);
    if (!primaryResult) {
      return {
        status: "unresolved",
        reason: "unreachable-landing-page",
        outcomes,
      };
    }
    return {
      status: "resolved",
      primaryResult,
      candidates: reachableCandidates.map(({ candidate }) => candidate),
      outcomes,
    };
  }

  async function getCitingPapers(
    query: CitingPapersQuery,
    limit: CitingPapersLimit,
  ): Promise<CitingPapersResult> {
    const identifierKey = citingPaperKey(query.identifiers);
    const sessionKey = identifierKey
      ? `${contextKey(query.context)}|${identifierKey}`
      : undefined;
    if (!sessionKey) {
      return {
        status: "failed",
        errorCode: "citation-identifier-unsupported",
        source: "opencitations-index",
        papers: [],
        limit,
      };
    }
    if (query.context?.refresh) {
      citingPaperSessions.delete(sessionKey);
      citingPaperNegative.delete(sessionKey);
    }
    const now = ports.clock.now().getTime();
    const negativeUntil = citingPaperNegative.get(sessionKey);
    if (negativeUntil !== undefined && negativeUntil > now) {
      return {
        status: "no-results",
        reason: "no-citations-from-source",
        source: "opencitations-index",
        papers: [],
        limit,
      };
    }
    if (negativeUntil !== undefined) citingPaperNegative.delete(sessionKey);
    let session = citingPaperSessions.get(sessionKey);
    if (session && session.expiresAt <= now) {
      citingPaperSessions.delete(sessionKey);
      session = undefined;
    }
    if (!session) {
      let edges: readonly CitationEdge[];
      try {
        edges = (
          await sortCitingPaperEdges(
            await fetchOpenCitationEdges(
              query.identifiers,
              ports,
              query.signal,
            ),
            ports,
            query.signal,
          )
        ).slice(0, 50);
      } catch (error) {
        const providerError = asProviderError(error, "opencitations-index");
        return {
          status: "failed",
          errorCode: providerError.code,
          source: "opencitations-index",
          papers: [],
          limit,
        };
      }
      if (edges.length === 0) {
        citingPaperNegative.set(sessionKey, now + 60 * 60 * 1000);
        return {
          status: "no-results",
          reason: "no-citations-from-source",
          source: "opencitations-index",
          papers: [],
          limit,
        };
      }
      session = {
        edges,
        hydrated: new Map(),
        expiresAt: now + 24 * 60 * 60 * 1000,
      };
      citingPaperSessions.set(sessionKey, session);
    }

    const requestedEdges = session.edges.slice(0, limit);
    const missingEdges = requestedEdges.filter(
      (edge) => !session!.hydrated.has(edgeKey(edge)),
    );
    if (missingEdges.length > 0) {
      let metadata: readonly ScholarlyCandidate[];
      try {
        metadata = await fetchOpenCitationMetadata(
          missingEdges,
          ports,
          query.signal,
        );
      } catch (error) {
        const providerError = asProviderError(error, "opencitations-meta");
        return {
          status: "failed",
          errorCode: providerError.code,
          source: "opencitations-meta",
          papers: [],
          limit,
        };
      }
      const byIdentifier = new Map(
        metadata.flatMap((candidate) =>
          candidateKeys(candidate).map((key) => [key, candidate] as const),
        ),
      );
      for (const edge of missingEdges) {
        const candidate = edgeKeys(edge)
          .map((key) => byIdentifier.get(key))
          .find((value) => value !== undefined);
        if (!candidate?.title) continue;
        const verified = await withVerifiedLanding(
          candidate,
          ports,
          reachability,
          contextKey(query.context),
          query.signal,
        );
        if (verified.reachable) {
          session.hydrated.set(edgeKey(edge), verified.candidate);
        }
      }
    }

    return {
      status: "ready",
      papers: requestedEdges
        .map((edge) => session!.hydrated.get(edgeKey(edge)))
        .filter(
          (candidate): candidate is ScholarlyCandidate =>
            candidate !== undefined,
        ),
      limit,
      availableCount: session.edges.length,
    };
  }

  return {
    resolveReference,
    getCitingPapers,
    dispose() {
      reachability.clear();
      citingPaperSessions.clear();
      citingPaperNegative.clear();
    },
  };
}

async function sortCitingPaperEdges(
  edges: readonly CitationEdge[],
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<readonly CitationEdge[]> {
  const deduplicated = sortCitationEdges(edges);
  const missingCreation = deduplicated
    .filter(({ creation }) => !creation)
    .slice(0, 50);
  if (missingCreation.length === 0) return deduplicated;
  const metadata = await fetchOpenCitationMetadata(
    missingCreation,
    ports,
    signal,
  );
  const byIdentifier = new Map(
    metadata.flatMap((candidate) =>
      candidateKeys(candidate).map((key) => [key, candidate] as const),
    ),
  );
  return sortCitationEdges(
    deduplicated.map((edge) => {
      if (edge.creation) return edge;
      const candidate = edgeKeys(edge)
        .map((key) => byIdentifier.get(key))
        .find((value) => value !== undefined);
      const fallback =
        candidate?.publicationDate ??
        candidate?.publicationYear?.toString() ??
        null;
      return fallback ? { ...edge, creation: fallback } : edge;
    }),
  );
}

function referencePlans(
  query: ReferenceQuery,
  ports: RelatedLiteraturePorts,
): readonly Promise<ProviderRun>[] {
  if (query.identifiers.doi) {
    return [
      runProvider("crossref", () =>
        lookupCrossrefDoi(query.identifiers.doi!, ports, query.signal),
      ),
      runProvider("datacite", () =>
        lookupDataCiteDoi(query.identifiers.doi!, ports, query.signal),
      ),
    ];
  }
  const input = {
    title: query.title ?? "",
    firstAuthor: query.authors[0],
    year: query.year ?? undefined,
    venue: query.venue,
    signal: query.signal,
  };
  if (isTraditional(query.channel)) {
    return [runProvider("crossref", () => searchCrossref(input, ports))];
  }
  if (isRepositoryChannel(query.channel)) {
    return [runProvider("datacite", () => searchDataCite(input, ports))];
  }
  return [
    runProvider("crossref", () => searchCrossref(input, ports)),
    runProvider("datacite", () => searchDataCite(input, ports)),
  ];
}

async function runProvider(
  source: ProviderName,
  operation: () =>
    Promise<ScholarlyCandidate> | Promise<readonly ScholarlyCandidate[]>,
): Promise<ProviderRun> {
  try {
    const result = await operation();
    const candidates = Array.isArray(result) ? result : [result];
    return {
      outcome: {
        source,
        status: candidates.length > 0 ? "success" : "no-candidate",
      },
      candidates,
    };
  } catch (error) {
    const providerError = asProviderError(error, source);
    return {
      outcome: {
        source,
        status:
          providerError.code === "no-candidate" ? "no-candidate" : "failed",
        errorCode: providerError.code,
      },
      candidates: [],
    };
  }
}

async function withVerifiedLanding(
  candidate: ScholarlyCandidate,
  ports: ProviderPorts,
  reachability: Map<string, ReturnType<typeof verifyDoiLandingPage>>,
  scope: string,
  signal?: AbortSignal,
): Promise<Readonly<{ candidate: ScholarlyCandidate; reachable: boolean }>> {
  const doi = candidate.identifiers.doi;
  if (!doi) return { candidate, reachable: false };
  const key = `${scope}|${doi}`;
  let pending = reachability.get(key);
  if (!pending) {
    pending = verifyDoiLandingPage(doi, ports, signal);
    reachability.set(key, pending);
  }
  const result = await pending;
  return result.status === "reachable"
    ? {
        candidate: { ...candidate, landingURL: result.landingURL },
        reachable: true,
      }
    : { candidate, reachable: false };
}

function asProviderError(error: unknown, source: ProviderName): ProviderError {
  return error instanceof ProviderError
    ? error
    : new ProviderError(
        source,
        "provider-failure",
        error instanceof Error ? error.message : String(error),
      );
}

function isTraditional(channel: PublicationChannel): boolean {
  return ["journal", "conference", "book", "chapter", "standard"].includes(
    channel,
  );
}

function isRepositoryChannel(channel: PublicationChannel): boolean {
  return ["dataset", "software", "preprint", "repository", "report"].includes(
    channel,
  );
}

function citingPaperKey(identifiers: ScholarlyIdentifiers): string | undefined {
  return identifiers.doi
    ? `doi:${identifiers.doi.toLowerCase()}`
    : identifiers.pmid
      ? `pmid:${identifiers.pmid}`
      : undefined;
}

function contextKey(context: GatewayQueryContext | undefined): string {
  return context
    ? [
        context.libraryID,
        context.attachmentKey,
        context.sourceFingerprint,
        context.generation,
      ].join(":")
    : "standalone";
}

function edgeKey(edge: CitationEdge): string {
  return edgeKeys(edge)[0] ?? edge.sourceRecordID;
}

function edgeKeys(edge: CitationEdge): readonly string[] {
  return [
    edge.identifiers.doi && `doi:${edge.identifiers.doi}`,
    edge.identifiers.pmid && `pmid:${edge.identifiers.pmid}`,
    edge.identifiers.omid && `omid:${edge.identifiers.omid}`,
  ].filter((key): key is string => Boolean(key));
}

function candidateKeys(candidate: ScholarlyCandidate): readonly string[] {
  return [
    candidate.identifiers.doi && `doi:${candidate.identifiers.doi}`,
    candidate.identifiers.pmid && `pmid:${candidate.identifiers.pmid}`,
    candidate.identifiers.omid && `omid:${candidate.identifiers.omid}`,
  ].filter((key): key is string => Boolean(key));
}
