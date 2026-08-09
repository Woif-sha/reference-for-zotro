import type { ReaderPaper } from "../reader/mountReaderSection";
import type { ScanSciPort } from "../scansci/scan-sci-port";
import type {
  DownloadFirstUseController,
  DownloadFirstUseState,
} from "./download-first-use";
import type { SinglePaperDownloadResult } from "./related-papers-controller";

const MAX_FILENAME_STEM_CHARACTERS = 120;
const WINDOWS_RESERVED_FILENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function createScanSciDownloadPaper(options: {
  runtime: ScanSciPort;
  setup: DownloadFirstUseController;
}): (
  paper: ReaderPaper & { status: "resolved" },
) => Promise<SinglePaperDownloadResult> {
  return async (paper) => {
    const setup = options.setup.getState();
    const readinessError = runtimeReadinessError(setup);
    if (readinessError) return { status: "failed", error: readinessError };

    const destination = setup.downloadDestination;
    return options.runtime.downloadOnePaper({
      paper: {
        title: paper.title,
        ...(paper.doi ? { doi: paper.doi } : {}),
        ...(paper.arxivID ? { arxivID: paper.arxivID } : {}),
        ...(paper.pmcid ? { pmcid: paper.pmcid } : {}),
        primaryResultURL: paper.primaryResultURL,
      },
      downloadDestination: destination,
      canonicalFinalTarget: joinWindows(
        destination,
        `${safeWindowsFilenameStem(paper.title)}.pdf`,
      ),
    });
  };
}

export function createScanSciDownloadDependencies(options: {
  runtime: ScanSciPort;
  setup: DownloadFirstUseController;
}) {
  return {
    downloadSetup: options.setup,
    downloadPaper: createScanSciDownloadPaper(options),
  } as const;
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
