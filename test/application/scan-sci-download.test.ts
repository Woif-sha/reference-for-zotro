import assert from "node:assert/strict";
import test from "node:test";
import type {
  DownloadFirstUseController,
  DownloadFirstUseState,
} from "../../src/application/download-first-use";
import {
  createScanSciDownloadDependencies,
  createScanSciDownloadPaper,
  safeWindowsFilenameStem,
} from "../../src/application/scan-sci-download";
import type { ReaderPaper } from "../../src/reader/mountReaderSection";
import type {
  OnePaperDownloadRequest,
  ScanSciPort,
} from "../../src/scansci/scan-sci-port";

test("production download adapter snapshots the configured destination and preserves legal-source identifiers", async () => {
  let state = readyState("E:\\paper");
  let request: OnePaperDownloadRequest | undefined;
  const runtime = runtimeWithDownload(async (value) => {
    request = value;
    state = readyState("D:\\later");
    return { status: "downloaded", savedPath: value.canonicalFinalTarget };
  });
  const download = createScanSciDownloadPaper({
    runtime,
    setup: setupController(() => state),
  });
  const paper: ReaderPaper & { status: "resolved" } = {
    id: "paper",
    ordinal: 0,
    title: "A <legal> paper: results?",
    status: "resolved",
    primaryResultURL: "https://arxiv.org/abs/2101.00001",
    doi: "10.1000/example",
    arxivID: "2101.00001",
    pmcid: "PMC1234",
  };

  const result = await download(paper);

  assert.deepEqual(result, {
    status: "downloaded",
    savedPath: "E:\\paper\\A legal paper results.pdf",
  });
  assert.deepEqual(request, {
    paper: {
      title: paper.title,
      doi: paper.doi,
      arxivID: paper.arxivID,
      pmcid: paper.pmcid,
      primaryResultURL: paper.primaryResultURL,
    },
    downloadDestination: "E:\\paper",
    canonicalFinalTarget: "E:\\paper\\A legal paper results.pdf",
  });
});

test("production download dependencies expose setup and the live ScanSci adapter together", () => {
  const setup = setupController(() => readyState("E:\\paper"));
  const dependencies = createScanSciDownloadDependencies({
    runtime: runtimeWithDownload(async () => ({
      status: "failed",
      error: "not invoked",
    })),
    setup,
  });

  assert.equal(dependencies.downloadSetup, setup);
  assert.equal(typeof dependencies.downloadPaper, "function");
});

test("production download adapter fails explicitly until runtime preparation is ready", async () => {
  let called = false;
  const runtime = runtimeWithDownload(async () => {
    called = true;
    return { status: "failed", error: "unexpected" };
  });
  const download = createScanSciDownloadPaper({
    runtime,
    setup: setupController(() => ({
      ...readyState("E:\\paper"),
      runtime: { status: "unchecked" },
    })),
  });

  const result = await download({
    id: "paper",
    ordinal: 0,
    title: "Paper",
    status: "resolved",
    primaryResultURL: "https://doi.org/10.1000/example",
    doi: "10.1000/example",
  });

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.match(result.error, /runtime is not ready/u);
  assert.equal(called, false);
});

test("Windows filename generation rejects device names and trims unsafe suffixes", () => {
  assert.equal(safeWindowsFilenameStem("CON"), "paper");
  assert.equal(safeWindowsFilenameStem("  title...  "), "title");
});

function readyState(destination: string): DownloadFirstUseState {
  return {
    downloadDestination: destination,
    usingDefaultDestination: destination === "E:\\paper",
    runtime: {
      status: "ready",
      capability: {
        status: "available",
        executable: "C:\\runtime\\python.exe",
        pythonVersion: "3.12.10",
        architecture: "x64",
        moduleVersion: "3.0.0",
        schemaVersion: 3,
        sourceRulesVersion: 3,
        selectionReason: "private environment",
        dependencies: [],
        features: {
          onePaperDownload: "available",
          visibleLogin: "disabled",
        },
      },
    },
    institutionLogin: {
      status: "unavailable",
      error: "not relevant",
    },
  };
}

function setupController(
  getState: () => DownloadFirstUseState,
): DownloadFirstUseController {
  return {
    getState,
    subscribe: () => () => undefined,
    async changeDownloadDestination() {},
    resetDownloadDestination() {},
    async checkRuntime() {},
    async choosePythonExecutable() {},
    async installRuntime() {},
    cancelRuntimeInstallation() {},
    dispose() {},
  };
}

function runtimeWithDownload(
  downloadOnePaper: ScanSciPort["downloadOnePaper"],
): ScanSciPort {
  return {
    async prepareRuntime() {
      throw new Error("not used");
    },
    async startVisibleLogin() {
      throw new Error("not used");
    },
    downloadOnePaper,
  };
}
