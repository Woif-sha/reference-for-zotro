import { matchScholarlyCandidates, type MatchablePaper } from "./matching";
import {
  hasRequiredResolutionMetadata,
  selectPrimaryResult,
  type PrimaryResultCandidate,
} from "./primary-result";
import { lookupCrossrefDoi, searchCrossref } from "./providers/crossref";
import { lookupDataCiteDoi, searchDataCite } from "./providers/datacite";
import {
  verifyDoiLandingPage,
  verifyLandingPage,
} from "./providers/doi-reachability";
import {
  fetchOpenCitationEdges,
  fetchOpenCitationMetadata,
  sortCitationEdges,
  type CitationEdge,
} from "./providers/opencitations";
import { normalizeDoi } from "./providers/parse";
import {
  ProviderError,
  type ProviderErrorCode,
  type ProviderName,
  type ProviderPorts,
  type ScholarlyCandidate,
  type ScholarlyIdentifiers,
} from "./providers/types";
import type { ReferenceMatchBasis } from "../domain/literature";

export type VerifiedScholarlyCandidate = ScholarlyCandidate &
  Readonly<{ landingURL: string }>;

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
  requestedAt: string;
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
      primaryResult: VerifiedScholarlyCandidate;
      candidates: readonly ScholarlyCandidate[];
      matchedBy: ReferenceMatchBasis;
      outcomes: readonly ProviderOutcome[];
    }>
  | Readonly<{
      status: "ambiguous";
      candidates: readonly ScholarlyCandidate[];
      outcomes: readonly ProviderOutcome[];
    }>
  | Readonly<{
      status: "unresolved";
      reason:
        "no-candidate" | "incomplete-metadata" | "unreachable-landing-page";
      outcomes: readonly ProviderOutcome[];
      candidates?: readonly ScholarlyCandidate[];
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
      papers: readonly VerifiedScholarlyCandidate[];
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
  metadata: Map<string, ScholarlyCandidate>;
  hydrated: Map<string, VerifiedScholarlyCandidate>;
  hydrationFailures: Map<string, ProviderErrorCode>;
  attempted: Set<string>;
  expiresAt: number;
};

type SortedCitingPapers = Readonly<{
  edges: readonly CitationEdge[];
  metadata: Map<string, ScholarlyCandidate>;
}>;

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
    if (!primaryResult?.landingURL) {
      return {
        status: "unresolved",
        reason: reachableCandidates.some(({ candidate }) =>
          hasRequiredResolutionMetadata(candidate),
        )
          ? "unreachable-landing-page"
          : "incomplete-metadata",
        outcomes,
        candidates: reachableCandidates.map(({ candidate }) => candidate),
      };
    }
    const verifiedPrimaryResult: VerifiedScholarlyCandidate = {
      ...primaryResult,
      landingURL: primaryResult.landingURL,
    };
    return {
      status: "resolved",
      primaryResult: verifiedPrimaryResult,
      candidates: reachableCandidates.map(({ candidate }) => candidate),
      matchedBy: match.matchedBy,
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
    const prepared = await getOrCreateCitingSession(query, limit, sessionKey);
    if ("status" in prepared) return prepared;
    const session = prepared;
    const requestedEdges = session.edges.slice(0, limit);
    const missingEdges = requestedEdges.filter(
      (edge) => !session.attempted.has(edgeKey(edge)),
    );
    const hydrationFailure = await hydrateCitingEdges(
      query,
      limit,
      session,
      missingEdges,
    );
    if (hydrationFailure) return hydrationFailure;
    return createCitingPapersResult(session, requestedEdges, limit);
  }

  async function getOrCreateCitingSession(
    query: CitingPapersQuery,
    limit: CitingPapersLimit,
    sessionKey: string,
  ): Promise<CitingPapersSession | CitingPapersResult> {
    if (query.context?.refresh) {
      citingPaperSessions.delete(sessionKey);
      citingPaperNegative.delete(sessionKey);
    }
    const now = ports.clock.now().getTime();
    const negativeUntil = citingPaperNegative.get(sessionKey);
    if (negativeUntil !== undefined && negativeUntil > now) {
      return noCitingPapersResult(limit);
    }
    if (negativeUntil !== undefined) citingPaperNegative.delete(sessionKey);

    const existing = citingPaperSessions.get(sessionKey);
    if (existing && existing.expiresAt > now) return existing;
    if (existing) citingPaperSessions.delete(sessionKey);

    let sorted: SortedCitingPapers;
    try {
      sorted = await sortCitingPaperEdges(
        await fetchOpenCitationEdges(query.identifiers, ports, query.signal),
        ports,
        query.signal,
      );
    } catch (error) {
      const providerError = asProviderError(error, "opencitations-index");
      return failedCitingPapersResult(
        providerError.code,
        "opencitations-index",
        limit,
      );
    }
    const edges = sorted.edges.slice(0, 50);
    if (edges.length === 0) {
      citingPaperNegative.set(sessionKey, now + 60 * 60 * 1000);
      return noCitingPapersResult(limit);
    }
    const session: CitingPapersSession = {
      edges,
      metadata: sorted.metadata,
      hydrated: new Map(),
      hydrationFailures: new Map(),
      attempted: new Set(),
      expiresAt: now + 24 * 60 * 60 * 1000,
    };
    citingPaperSessions.set(sessionKey, session);
    return session;
  }

  async function hydrateCitingEdges(
    query: CitingPapersQuery,
    limit: CitingPapersLimit,
    session: CitingPapersSession,
    missingEdges: readonly CitationEdge[],
  ): Promise<CitingPapersResult | undefined> {
    if (missingEdges.length === 0) return undefined;
    const unknownEdges = missingEdges.filter(
      (edge) => !edgeKeys(edge).some((key) => session.metadata.has(key)),
    );
    try {
      if (unknownEdges.length > 0) {
        const metadata = await fetchOpenCitationMetadata(
          unknownEdges,
          ports,
          query.signal,
        );
        addCandidatesByIdentifier(session.metadata, metadata);
      }
    } catch (error) {
      const providerError = asProviderError(error, "opencitations-meta");
      return failedCitingPapersResult(
        providerError.code,
        "opencitations-meta",
        limit,
      );
    }
    for (const edge of missingEdges) {
      await hydrateCitingEdge(query, session, edge);
    }
    return undefined;
  }

  async function hydrateCitingEdge(
    query: CitingPapersQuery,
    session: CitingPapersSession,
    edge: CitationEdge,
  ): Promise<void> {
    const key = edgeKey(edge);
    session.attempted.add(key);
    const candidate = edgeKeys(edge)
      .map((identifier) => session.metadata.get(identifier))
      .find((value) => value !== undefined);
    if (!candidate || !hasRequiredResolutionMetadata(candidate)) {
      session.hydrationFailures.set(key, "incomplete-metadata");
      return;
    }
    const candidateWithProvenance = {
      ...candidate,
      rawProvenance: [
        ...new Set([...candidate.rawProvenance, ...edge.rawProvenance]),
      ],
    };
    const verified = await withVerifiedLanding(
      candidateWithProvenance,
      ports,
      reachability,
      contextKey(query.context),
      query.signal,
    );
    if (verified.reachable) {
      session.hydrated.set(key, verified.candidate);
      return;
    }
    session.hydrationFailures.set(key, "unreachable-landing-page");
  }

  function createCitingPapersResult(
    session: CitingPapersSession,
    requestedEdges: readonly CitationEdge[],
    limit: CitingPapersLimit,
  ): CitingPapersResult {
    const papers = requestedEdges
      .map((edge) => session.hydrated.get(edgeKey(edge)))
      .filter(
        (candidate): candidate is VerifiedScholarlyCandidate =>
          candidate !== undefined,
      );
    if (papers.length === 0 && requestedEdges.length > 0) {
      const failures = requestedEdges
        .map((edge) => session.hydrationFailures.get(edgeKey(edge)))
        .filter((code): code is ProviderErrorCode => code !== undefined);
      return failedCitingPapersResult(
        failures.includes("incomplete-metadata")
          ? "incomplete-metadata"
          : "unreachable-landing-page",
        "opencitations-meta",
        limit,
      );
    }
    return {
      status: "ready",
      papers,
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

function noCitingPapersResult(limit: CitingPapersLimit): CitingPapersResult {
  return {
    status: "no-results",
    reason: "no-citations-from-source",
    source: "opencitations-index",
    papers: [],
    limit,
  };
}

function failedCitingPapersResult(
  errorCode: ProviderErrorCode,
  source: ProviderName,
  limit: CitingPapersLimit,
): CitingPapersResult {
  return {
    status: "failed",
    errorCode,
    source,
    papers: [],
    limit,
  };
}

async function sortCitingPaperEdges(
  edges: readonly CitationEdge[],
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<SortedCitingPapers> {
  const deduplicated = sortCitationEdges(edges);
  const missingCreation = deduplicated
    .filter(({ creation }) => !creation)
    .slice(0, 50);
  if (missingCreation.length === 0) {
    return { edges: deduplicated, metadata: new Map() };
  }
  const metadata = await fetchOpenCitationMetadata(
    missingCreation,
    ports,
    signal,
  );
  const byIdentifier = new Map<string, ScholarlyCandidate>();
  addCandidatesByIdentifier(byIdentifier, metadata);
  return {
    edges: sortCitationEdges(
      deduplicated.map((edge) => {
        if (edge.creation) return edge;
        const candidate = edgeKeys(edge)
          .map((key) => byIdentifier.get(key))
          .find((value) => value !== undefined);
        const fallback = sortablePublicationDate(candidate);
        return fallback ? { ...edge, creation: fallback } : edge;
      }),
    ),
    metadata: byIdentifier,
  };
}

function sortablePublicationDate(
  candidate: ScholarlyCandidate | undefined,
): string | null {
  const date = candidate?.publicationDate;
  if (date && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u.test(date)) return date;
  const year = candidate?.publicationYear;
  return year && year >= 1000 && year <= 9999 ? year.toString() : null;
}

function addCandidatesByIdentifier(
  target: Map<string, ScholarlyCandidate>,
  candidates: readonly ScholarlyCandidate[],
): void {
  for (const candidate of candidates) {
    for (const key of candidateKeys(candidate)) target.set(key, candidate);
  }
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
): Promise<
  | Readonly<{ candidate: VerifiedScholarlyCandidate; reachable: true }>
  | Readonly<{ candidate: ScholarlyCandidate; reachable: false }>
> {
  const doi = candidate.identifiers.doi;
  const pmid = candidate.identifiers.pmid;
  const probeURL = doi
    ? `https://doi.org/${encodeURI(doi.toLowerCase())}`
    : pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`
      : undefined;
  if (!probeURL) return { candidate, reachable: false };
  const key = `${scope}|${probeURL}`;
  let pending = reachability.get(key);
  if (!pending) {
    pending = doi
      ? verifyDoiLandingPage(doi, ports, signal)
      : verifyLandingPage(probeURL, ports, signal);
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
  const doi = normalizeDoi(identifiers.doi);
  const pmid = identifiers.pmid?.trim();
  return doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : undefined;
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
