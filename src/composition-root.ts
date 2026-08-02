import {
  RelatedPapersController,
  type RelatedPapersPorts,
  type ResolutionContext,
  type LoadedPaper,
} from "./application/related-papers-controller";
import {
  candidateToReaderPaper,
  resolutionToReaderPaper,
  unresolvedPaper,
} from "./application/reader-paper-presentation";
import { LiteratureCacheRepository } from "./cache/cache-repository";
import {
  decideRelatedPapersCacheWrite,
  type CachedPaperEnvelope,
} from "./cache/related-papers-cache-policy";
import { loadMineruReferences } from "./mineru/mineru-adapter";
import {
  createRelatedLiteratureGateway,
  type RelatedLiteratureGateway,
} from "./literature/gateway";
import {
  extractStableIdentifiers,
  findMalformedStableIdentifier,
  resolveDeterministicLandingPage,
} from "./literature/identifiers";
import { parseReferenceQuery } from "./literature/reference-query";
import type { FetchPort } from "./literature/providers/types";
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
        async writeCachedResults(paper, results, context) {
          const decision = decideRelatedPapersCacheWrite(results, Date.now());
          if (decision.kind === "remove") {
            await cache.remove(cacheIdentity(paper), context.signal);
            return;
          }
          await cache.write(
            cacheIdentity(paper),
            decision.value,
            context.signal,
          );
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

export async function resolveReferenceEntry(
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
        title: query.title || lookupText,
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
      { cause: error },
    );
  }
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
