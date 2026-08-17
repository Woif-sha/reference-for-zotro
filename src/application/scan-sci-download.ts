import type { ReaderPaper } from "../reader/mountReaderSection";
import type { ScanSciPort } from "../scansci/scan-sci-port";
import { canonicalPdfFilename } from "../scansci/windows-download-path";
import type {
  DownloadSettingsController,
  DownloadSettingsState,
} from "./download-settings";
import type {
  PaperDownloadProgress,
  RelatedPapersPorts,
} from "./related-papers-controller";

export { safeWindowsFilenameStem } from "../scansci/windows-download-path";

export function createScanSciDownloadPapers(options: {
  runtime: ScanSciPort;
  setup: DownloadSettingsController;
}): NonNullable<RelatedPapersPorts["downloadPapers"]> {
  return async (request) => {
    const setup = options.setup.getState();
    const readinessError = downloadSetupError(setup);
    if (readinessError) {
      return request.papers.map((paper) => ({
        paperID: paper.id,
        result: { status: "failed", error: readinessError },
      }));
    }

    const destination = setup.downloadDestination;
    const results = await options.runtime.downloadPapers({
      items: request.papers.map((paper) => ({
        itemID: paper.id,
        paper: confirmedPaper(paper),
        canonicalFinalTarget: canonicalFinalTarget(destination, paper.title),
      })),
      downloadDestination: destination,
      signal: request.signal,
      onProgress: ({ itemID, result }) =>
        request.onProgress({ paperID: itemID, result }),
    });
    return results.map(
      ({ itemID, result }) =>
        ({
          paperID: itemID,
          result,
        }) satisfies PaperDownloadProgress,
    );
  };
}

function confirmedPaper(paper: ReaderPaper & { status: "resolved" }) {
  return {
    title: paper.title,
    ...(paper.doi ? { doi: paper.doi } : {}),
    ...(paper.arxivID ? { arxivID: paper.arxivID } : {}),
    ...(paper.pmcid ? { pmcid: paper.pmcid } : {}),
    primaryResultURL: paper.primaryResultURL,
  };
}

function canonicalFinalTarget(destination: string, title: string): string {
  return joinWindows(destination, canonicalPdfFilename(title));
}

function downloadSetupError(setup: DownloadSettingsState): string | undefined {
  if (setup.destinationError) return setup.destinationError;
  return undefined;
}

function joinWindows(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/u, "")}\\${right.replace(/^[\\/]+/u, "")}`;
}
