import {
  RelatedPapersController,
  type CachedRelatedPapers,
  type RelatedPapersPorts,
  type ResolutionContext,
  type LoadedPaper,
} from "./application/related-papers-controller";
import { LiteratureCacheRepository } from "./cache/cache-repository";
import { loadMineruReferences } from "./mineru/mineru-adapter";
import {
  createRelatedLiteratureGateway,
  type RelatedLiteratureGateway,
  type ProviderOutcome,
  type ReferenceResolution,
  type VerifiedScholarlyCandidate,
} from "./literature/gateway";
import {
  extractStableIdentifiers,
  findMalformedStableIdentifier,
  resolveDeterministicLandingPage,
} from "./literature/identifiers";
import { parseReferenceQuery } from "./literature/reference-query";
import type {
  FetchPort,
  ScholarlyCandidate,
} from "./literature/providers/types";
import type { ReferenceMatchBasis } from "./domain/literature";
import {
  createPaperTranslateBridge,
  createProviderPorts,
  createZoteroCacheStorage,
  createZoteroMinerUPorts,
} from "./platform/zotero-runtime";
import type { ReaderPaper } from "./reader/mountReaderSection";
import type { ReaderControllerFactory } from "./reader/registerReaderSection";

const PLUGIN_ID = "referenceforzotero@woif-sha.github.io";
const PROVIDER_SCHEMA_VERSION = 2;
const PROVIDER_QUERY_VERSION = 1;
const GATEWAY_CACHE_PROVIDER = "related-literature-gateway";
const GATEWAY_REQUEST_KEY = "reader-related-papers";

type CachedPaperEnvelope = {
  expiresAt: string;
  results: CachedRelatedPapers;
};

export function createReaderControllerFactory(): ReaderControllerFactory {
  const mineruPorts = createZoteroMinerUPorts();
  const providerPorts = createProviderPorts();
  const translation = createPaperTranslateBridge();
  const cache = new LiteratureCacheRepository<CachedPaperEnvelope>(
    createZoteroCacheStorage(),
  );

  return {
    create({ attachmentItemID }) {
      let gatewayGeneration = -1;
      let gateway: RelatedLiteratureGateway | undefined;
      const gatewayFor = (context: ResolutionContext) => {
        if (!gateway || gatewayGeneration !== context.token.generation) {
          gateway?.dispose();
          gateway = createRelatedLiteratureGateway(providerPorts);
          gatewayGeneration = context.token.generation;
        }
        return gateway;
      };
      const actualAttachmentID = resolveReaderAttachmentID(attachmentItemID);
      const ports: RelatedPapersPorts = {
        async loadPaper(itemID) {
          const loaded = await loadMineruReferences(itemID, mineruPorts);
          return {
            identity: loaded.identity,
            sourceFingerprint: loaded.sourceFingerprint,
            entries: loaded.entries,
          };
        },
        async resolveReferences(entries, context, onResolved) {
          const resolved: ReaderPaper[] = [];
          for (const entry of entries) {
            if (context.signal.aborted) throw abortError();
            const paper = await resolveReferenceEntry(
              entry.ordinal,
              entry.lookupText,
              gatewayFor(context),
              providerPorts.fetch,
              context,
            );
            resolved.push(paper);
            onResolved(paper);
          }
          return resolved;
        },
        async loadCitingPapers(limit, context) {
          const identifiers = currentPaperIdentifiers(context);
          const result = await gatewayFor(context).getCitingPapers(
            {
              identifiers,
              signal: context.signal,
              context: gatewayContext(context),
            },
            limit,
          );
          if (result.status === "failed") {
            throw new Error(
              `Citing papers unavailable: ${result.errorCode} (${result.source})`,
            );
          }
          if (result.status === "no-results") {
            throw new Error(
              "OpenCitations returned no citation edges for this source; this is not proof that the paper has no Citing papers.",
            );
          }
          return result.papers.map((candidate, index) =>
            candidateToReaderPaper(candidate, index),
          );
        },
        async readCachedResults(paper) {
          const envelope = await cache.read(cacheIdentity(paper));
          if (!envelope) return undefined;
          if (!Number.isFinite(Date.parse(envelope.expiresAt))) {
            throw new Error("Cached related-literature expiry is invalid");
          }
          return Date.parse(envelope.expiresAt) > Date.now()
            ? envelope.results
            : undefined;
        },
        async writeCachedResults(paper, results) {
          const hasFailure = results.references.some(
            ({ status, providerFailures }) =>
              status === "failed" || Boolean(providerFailures?.length),
          );
          const hasUnconfirmed = results.references.some(
            ({ status }) => status !== "resolved",
          );
          const ttlMilliseconds = hasFailure
            ? 0
            : hasUnconfirmed
              ? 60 * 60 * 1000
              : 24 * 60 * 60 * 1000;
          await cache.write(cacheIdentity(paper), {
            expiresAt: new Date(Date.now() + ttlMilliseconds).toISOString(),
            results: {
              ...results,
              references: results.references.map(
                ({ abstract: _copyrightedAbstract, ...reference }) => reference,
              ),
              citingPapers: results.citingPapers.map(
                ({ abstract: _abstract, ...citation }) => citation,
              ),
            },
          });
        },
        translateSelection(text, itemID) {
          return translation.translate(text, {
            pluginID: PLUGIN_ID,
            itemID,
          });
        },
        openURL(url) {
          Zotero.launchURL(url);
        },
        dispose() {
          gateway?.dispose();
          gateway = undefined;
        },
      };
      const controller = new RelatedPapersController(actualAttachmentID, ports);
      void controller.refreshAsync();
      return controller;
    },
  };
}

async function resolveReferenceEntry(
  ordinal: number,
  lookupText: string,
  gateway: RelatedLiteratureGateway,
  fetchPort: FetchPort,
  context: ResolutionContext,
): Promise<ReaderPaper> {
  const stable = extractStableIdentifiers(lookupText);
  const malformedIdentifier = findMalformedStableIdentifier(lookupText, stable);
  if (malformedIdentifier) {
    return unresolvedPaper(
      ordinal,
      lookupText,
      `Invalid ${malformedIdentifier} format`,
      "invalid-identifier",
    );
  }
  const deterministic = resolveDeterministicLandingPage(stable);
  const query = parseReferenceQuery(lookupText);

  if (!query.identifiers.doi && deterministic.status === "confirmed") {
    const landingURL = await verifyDirectLandingPage(
      deterministic.url,
      fetchPort,
      context.signal,
    );
    if (landingURL) {
      return {
        id: `reference:${ordinal}`,
        ordinal,
        title: lookupText,
        status: "resolved",
        primaryResultURL: landingURL,
        matchedBy: deterministic.matchedBy,
        doi: stable.doi,
      };
    }
    return unresolvedPaper(
      ordinal,
      lookupText,
      "Landing page is unreachable",
      "unreachable",
    );
  }

  const resolution = await gateway.resolveReference({
    ...query,
    signal: context.signal,
    context: gatewayContext(context),
  });
  return resolutionToReaderPaper(ordinal, lookupText, resolution);
}

export function resolutionToReaderPaper(
  ordinal: number,
  lookupText: string,
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
      lookupText,
      "Multiple candidates have indistinguishable evidence",
      "ambiguous",
      formatCandidateDiagnostics(resolution.candidates),
      formatProviderFailures(resolution.outcomes),
    );
  }
  if (resolution.status === "unresolved") {
    return unresolvedPaper(
      ordinal,
      lookupText,
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
    lookupText,
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
  return {
    id:
      candidate.identifiers.doi ??
      `${candidate.source}:${candidate.sourceRecordID}`,
    ordinal,
    title: candidate.title ?? candidate.sourceRecordID,
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
    abstract: stripMarkup(candidate.abstract),
    citationCount: candidate.citationCount ?? undefined,
    referenceCount: candidate.referenceCount ?? undefined,
    source: candidate.source,
    sourceRecordID: candidate.sourceRecordID,
    retrievedAt: candidate.retrievedAt,
    matchedFields: candidate.matchedFields,
    metadataIncomplete:
      candidate.authors.length === 0 ||
      (!candidate.publicationDate && candidate.publicationYear === null) ||
      !candidate.venue,
    providerFailures: formatProviderFailures(outcomes),
  };
}

function unresolvedPaper(
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

function currentPaperIdentifiers(context: ResolutionContext): {
  doi?: string;
  pmid?: string;
} {
  const parent = Zotero.Items.getByLibraryAndKey(
    context.paper.identity.libraryID,
    context.paper.identity.parentItemKey,
  );
  const doi = String((parent && parent.getField("DOI")) || "")
    .trim()
    .toLowerCase();
  const extra = String((parent && parent.getField("extra")) || "");
  const pmid = /\bPMID\s*:\s*(\d+)\b/iu.exec(extra)?.[1];
  return {
    ...(doi ? { doi } : {}),
    ...(pmid ? { pmid } : {}),
  };
}

function gatewayContext(context: ResolutionContext) {
  return {
    libraryID: context.token.libraryID,
    attachmentKey: context.token.attachmentKey,
    sourceFingerprint: context.token.sourceFingerprint,
    generation: context.token.generation,
    requestedAt: new Date().toISOString(),
  };
}

function cacheIdentity(paper: LoadedPaper) {
  return {
    libraryID: paper.identity.libraryID,
    attachmentID: paper.identity.attachmentID,
    attachmentKey: paper.identity.attachmentKey,
    sourceFingerprint: paper.sourceFingerprint,
    providerSchemaVersion: PROVIDER_SCHEMA_VERSION,
    provider: GATEWAY_CACHE_PROVIDER,
    providerQueryVersion: PROVIDER_QUERY_VERSION,
    normalizedRequestKey: GATEWAY_REQUEST_KEY,
  };
}

function resolveReaderAttachmentID(itemID: number): number {
  const item = Zotero.Items.get(itemID);
  if (item && item.isAttachment()) return itemID;
  const window = Zotero.getMainWindow() as Window & {
    Zotero_Tabs?: { selectedID?: string };
  };
  const tabID = window.Zotero_Tabs?.selectedID;
  const reader = tabID ? Zotero.Reader.getByTabID(tabID) : undefined;
  const readerItemID = Number(reader?.itemID);
  const readerItem = Number.isInteger(readerItemID)
    ? Zotero.Items.get(readerItemID)
    : undefined;
  if (
    Number.isInteger(readerItemID) &&
    readerItem &&
    readerItem.isAttachment()
  ) {
    return readerItemID;
  }
  return itemID;
}

async function verifyDirectLandingPage(
  url: string,
  fetchPort: FetchPort,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const response = await fetchPort(url, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal,
    });
    const landingURL = response.url || url;
    const contentType = response.headers.get("Content-Type")?.toLowerCase();
    if (
      !response.ok ||
      !landingURL.startsWith("https://") ||
      contentType?.includes("application/pdf") ||
      /\.pdf(?:$|[?#])/iu.test(landingURL)
    ) {
      return undefined;
    }
    return landingURL;
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(
      `Landing page reachability check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function stripMarkup(value: string | null): string | undefined {
  const normalized = value
    ?.replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized || undefined;
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
