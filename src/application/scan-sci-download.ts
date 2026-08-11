import type { ReaderPaper } from "../reader/mountReaderSection";
import type { ScanSciPort } from "../scansci/scan-sci-port";
import type {
  DownloadFirstUseController,
  DownloadFirstUseState,
} from "./download-first-use";
import type {
  PaperDownloadProgress,
  RelatedPapersPorts,
} from "./related-papers-controller";

const MAX_FILENAME_STEM_CHARACTERS = 120;
const WINDOWS_RESERVED_FILENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function createScanSciDownloadPapers(options: {
  runtime: ScanSciPort;
  setup: DownloadFirstUseController;
}): NonNullable<RelatedPapersPorts["downloadPapers"]> {
  return async (request) => {
    const setup = options.setup.getState();
    const readinessError = runtimeReadinessError(setup);
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

export function createScanSciDownloadDependencies(options: {
  runtime: ScanSciPort;
  setup: DownloadFirstUseController;
}) {
  return {
    downloadSetup: options.setup,
    downloadPapers: createScanSciDownloadPapers(options),
  } as const;
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
  return joinWindows(destination, `${safeWindowsFilenameStem(title)}.pdf`);
}

export function safeWindowsFilenameStem(title: string): string {
  const printable = [...title.normalize("NFKC")]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("");
  const stem = printable
    .replace(/[<>:"/\\|?*]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[ .]+$/u, "")
    .slice(0, MAX_FILENAME_STEM_CHARACTERS)
    .replace(/[ .]+$/u, "");
  if (!stem || WINDOWS_RESERVED_FILENAME.test(stem)) return "paper";
  return stem;
}

function runtimeReadinessError(
  setup: DownloadFirstUseState,
): string | undefined {
  if (setup.destinationError) return setup.destinationError;
  if (setup.runtime.status !== "ready") {
    return "ScanSci runtime is not ready; check or install it in the Reader download area";
  }
  return undefined;
}

function joinWindows(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/u, "")}\\${right.replace(/^[\\/]+/u, "")}`;
}
