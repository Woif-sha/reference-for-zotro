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
import { decideRelatedPapersCacheWrite } from "./cache/related-papers-cache-policy";
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
import {
  parseReferenceQuery,
  UNPARSED_REFERENCE_TITLE,
} from "./literature/reference-query";
import { lookupAvailableAbstract } from "./literature/providers/abstract";
import {
  parseTrustedLandingMetadata,
  type TrustedLandingMetadata,
} from "./literature/providers/trusted-landing-metadata";
import type { FetchPort } from "./literature/providers/types";
import {
  createPaperTranslateBridge,
  createProviderPorts,
  createZoteroCacheStorage,
  createZoteroMinerUPorts,
} from "./platform/zotero-runtime";
import type { ReaderPaper } from "./reader/mountReaderSection";
import type { ReaderControllerFactory } from "./reader/registerReaderSection";
import type { DownloadSettingsController } from "./application/download-settings";

const PLUGIN_ID = "referenceforzotero@woif-sha.github.io";
export const PROVIDER_SCHEMA_VERSION = 4;
export const PROVIDER_QUERY_VERSION = 16;
const GATEWAY_CACHE_PROVIDER = "related-literature-gateway";
const GATEWAY_REQUEST_KEY = "reader-related-papers";

export type ReaderDownloadDependencies = Readonly<{
  downloadPapers?: NonNullable<RelatedPapersPorts["downloadPapers"]>;
  downloadSetup?: DownloadSettingsController;
}>;

export function createReaderControllerFactory(
  downloadDependencies: ReaderDownloadDependencies = {},
): ReaderControllerFactory {
  const mineruPorts = createZoteroMinerUPorts();
  const providerPorts = createProviderPorts();
  const translation = createPaperTranslateBridge();
  const cache = new LiteratureCacheRepository(createZoteroCacheStorage());

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
            mineruDirectory: loaded.cacheDirectory,
            entries: loaded.entries,
          };
        },
        async resolveReferences(entries, context, onResolved) {
          const resolved: ReaderPaper[] = [];
          for (const entry of entries) {
            if (context.signal.aborted) throw abortError();
            const paper = await resolveReferenceEntry(
              entry.ordinal,
              entry.sourceLabel,
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
            if (result.errorCode === "citation-identifier-unsupported") {
              throw new Error("当前论文缺少 DOI 或 PMID，无法查询引用论文。");
            }
            throw new Error(
              `OpenCitations 查询失败：${result.errorCode} (${result.source})`,
            );
          }
          if (result.status === "no-results") {
            return [];
          }
          return result.papers.map((candidate, index) =>
            candidateToReaderPaper(candidate, index),
          );
        },
        async loadAbstract(paper, context) {
          if (!paper.doi) {
            throw new Error("Abstract lookup requires a confirmed DOI");
          }
          return lookupAvailableAbstract(
            paper.doi,
            providerPorts,
            context.signal,
          );
        },
        async readCachedResults(paper) {
          return cache.read(cacheIdentity(paper));
        },
        async writeCachedResults(paper, results, context) {
          const decision = decideRelatedPapersCacheWrite(results);
          if (decision.kind === "skip") return;
          await cache.write(
            cacheIdentity(paper),
            decision.value,
            context.signal,
          );
        },
        translationCapability() {
          return translation.capability();
        },
        translateSelection(text, itemID) {
          return translation.translate(text, {
            pluginID: PLUGIN_ID,
            itemID,
          });
        },
        ...(downloadDependencies.downloadPapers
          ? { downloadPapers: downloadDependencies.downloadPapers }
          : {}),
        ...(downloadDependencies.downloadSetup
          ? { downloadSetup: downloadDependencies.downloadSetup }
          : {}),
        revealDownloadedFile(savedPath) {
          void Zotero.File.reveal(savedPath).catch((error: unknown) => {
            Zotero.logError(
              error instanceof Error ? error : new Error(String(error)),
            );
          });
        },
        revealMineruDirectory(directory) {
          Zotero.launchFile(directory);
        },
        copyText(text) {
          Zotero.Utilities.Internal.copyTextToClipboard(text);
        },
        openURL(url) {
          Zotero.launchURL(url);
        },
        externalInteractionDocuments() {
          return Zotero.Reader._readers
            .filter(({ itemID }) => Number(itemID) === actualAttachmentID)
            .flatMap((reader) =>
              reader._iframeWindow?.document
                ? [reader._iframeWindow.document]
                : [],
            );
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
  sourceLabel: string,
  lookupText: string,
  gateway: RelatedLiteratureGateway,
  fetchPort: FetchPort,
  context: ResolutionContext,
): Promise<ReaderPaper> {
  const stable = extractStableIdentifiers(lookupText);
  const query = parseReferenceQuery(lookupText);
  const present = (paper: ReaderPaper): ReaderPaper => ({
    ...paper,
    sourceLabel,
    venue: paper.venue ?? query.venue,
    year: paper.year ?? query.year?.toString(),
  });
  const displayTitle = query.title?.trim() ?? UNPARSED_REFERENCE_TITLE;
  const malformedIdentifier = findMalformedStableIdentifier(lookupText, stable);
  if (malformedIdentifier) {
    return present(
      unresolvedPaper(
        ordinal,
        displayTitle,
        `Invalid ${malformedIdentifier} format`,
        "invalid-identifier",
      ),
    );
  }
  if (!query.title && Object.keys(query.identifiers).length === 0) {
    return present(
      unresolvedPaper(
        ordinal,
        UNPARSED_REFERENCE_TITLE,
        "Reference title could not be parsed",
        "unresolved",
      ),
    );
  }
  const deterministic = resolveDeterministicLandingPage(stable);

  if (!query.identifiers.doi && deterministic.status === "confirmed") {
    const landing = await loadDirectLandingPage(
      deterministic.url,
      fetchPort,
      context.signal,
    );
    if (landing) {
      const doi = landing.metadata.doi;
      if (doi) {
        const resolution = await gateway.resolveReference({
          ...query,
          identifiers: { ...query.identifiers, doi },
          title: landing.metadata.title ?? query.title,
          year: landing.metadata.publicationYear ?? query.year,
          venue: landing.metadata.venue ?? query.venue,
          signal: context.signal,
          context: gatewayContext(context),
        });
        if (resolution.status === "resolved") {
          return present(
            resolutionToReaderPaper(ordinal, displayTitle, resolution),
          );
        }
      }
      return present(
        directLandingToReaderPaper(
          ordinal,
          displayTitle,
          landing.url,
          deterministic.matchedBy,
          landing.metadata,
          query.identifiers,
        ),
      );
    }
    return present(
      unresolvedPaper(
        ordinal,
        displayTitle,
        "Landing page is unreachable",
        "unreachable",
      ),
    );
  }

  const resolution = await gateway.resolveReference({
    ...query,
    signal: context.signal,
    context: gatewayContext(context),
  });
  return present(resolutionToReaderPaper(ordinal, displayTitle, resolution));
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

async function loadDirectLandingPage(
  url: string,
  fetchPort: FetchPort,
  signal: AbortSignal,
): Promise<
  Readonly<{ url: string; metadata: TrustedLandingMetadata }> | undefined
> {
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
    const html = await response.text();
    return { url: landingURL, metadata: parseTrustedLandingMetadata(html) };
  } catch (error) {
    if (signal.aborted) throw error;
    if (isAbortError(error)) return undefined;
    throw new Error(
      `Landing page reachability check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function directLandingToReaderPaper(
  ordinal: number,
  fallbackTitle: string,
  landingURL: string,
  matchedBy: "trusted-source-url" | "arxiv" | "ieee-article-number" | "doi",
  metadata: TrustedLandingMetadata,
  identifiers: Readonly<{ arxiv?: string; pmcid?: string }>,
): ReaderPaper {
  const metadataIncomplete =
    metadata.authors.length === 0 ||
    metadata.publicationYear === undefined ||
    !metadata.venue;
  return {
    id: `reference:${ordinal}`,
    ordinal,
    title: metadata.title ?? fallbackTitle,
    authors:
      metadata.authors.length > 0 ? metadata.authors.join(", ") : undefined,
    venue: metadata.venue,
    year: metadata.publicationYear?.toString(),
    abstract: metadata.abstract,
    status: "resolved",
    primaryResultURL: landingURL,
    matchedBy,
    doi: metadata.doi,
    arxivID: identifiers.arxiv,
    pmcid: identifiers.pmcid,
    source: "trusted-source",
    sourceRecordID: landingURL,
    retrievedAt: new Date().toISOString(),
    matchedFields: [metadata.doi ? "doi" : "trusted-source-url"],
    rawProvenance: [`trusted-source-url:${landingURL}`],
    metadataIncomplete,
  };
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
