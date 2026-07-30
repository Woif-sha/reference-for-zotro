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
  type ReferenceResolution,
} from "./literature/gateway";
import {
  extractStableIdentifiers,
  resolveDeterministicLandingPage,
} from "./literature/identifiers";
import { parseReferenceQuery } from "./literature/reference-query";
import type {
  FetchPort,
  ScholarlyCandidate,
} from "./literature/providers/types";
import {
  createPaperTranslateBridge,
  createProviderPorts,
  createZoteroCacheStorage,
  createZoteroMinerUPorts,
} from "./platform/zotero-runtime";
import type { ReaderPaper } from "./reader/mountReaderSection";
import type { ReaderControllerFactory } from "./reader/registerReaderSection";

const PLUGIN_ID = "referenceforzotero@woif-sha.github.io";
const PROVIDER_SCHEMA_VERSION = 1;

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
          return result.papers.map(candidateToReaderPaper);
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
            ({ status }) => status === "failed",
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
        doi: stable.doi,
      };
    }
    return unresolvedPaper(
      ordinal,
      lookupText,
      "Landing page is unreachable",
      "failed",
    );
  }

  const resolution = await gateway.resolveReference({
    ...query,
    signal: context.signal,
    context: gatewayContext(context),
  });
  return resolutionToReaderPaper(ordinal, lookupText, resolution);
}

function resolutionToReaderPaper(
  ordinal: number,
  lookupText: string,
  resolution: ReferenceResolution,
): ReaderPaper {
  if (resolution.status === "resolved") {
    return candidateToReaderPaper(resolution.primaryResult, ordinal);
  }
  if (resolution.status === "ambiguous") {
    return unresolvedPaper(
      ordinal,
      lookupText,
      "Multiple candidates have indistinguishable evidence",
      "ambiguous",
    );
  }
  if (resolution.status === "unresolved") {
    return unresolvedPaper(
      ordinal,
      lookupText,
      resolution.reason === "no-candidate"
        ? "No confirmed candidate"
        : "Paper landing page is unreachable",
      "unresolved",
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

function candidateToReaderPaper(
  candidate: ScholarlyCandidate,
  ordinal = 0,
): ReaderPaper {
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
    primaryResultURL: candidate.landingURL ?? undefined,
    doi: candidate.identifiers.doi,
    abstract: stripMarkup(candidate.abstract),
    citationCount: candidate.citationCount ?? undefined,
    referenceCount: candidate.referenceCount ?? undefined,
    source: candidate.source,
    connectedPaperInfo: `Metadata source: ${candidate.source}`,
  };
}

function unresolvedPaper(
  ordinal: number,
  title: string,
  statusText: string,
  status: "unresolved" | "ambiguous" | "failed",
): ReaderPaper {
  return {
    id: `reference:${ordinal}`,
    ordinal,
    title,
    status,
    statusText,
  };
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
  };
}

function cacheIdentity(paper: LoadedPaper) {
  return {
    libraryID: paper.identity.libraryID,
    attachmentID: paper.identity.attachmentID,
    attachmentKey: paper.identity.attachmentKey,
    sourceFingerprint: paper.sourceFingerprint,
    providerSchemaVersion: PROVIDER_SCHEMA_VERSION,
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
