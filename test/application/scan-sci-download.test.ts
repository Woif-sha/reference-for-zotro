import assert from "node:assert/strict";
import test from "node:test";
import type {
  DownloadSettingsController,
  DownloadSettingsState,
} from "../../src/application/download-settings";
import {
  createScanSciDownloadDependencies,
  createScanSciDownloadPapers,
  safeWindowsFilenameStem,
} from "../../src/application/scan-sci-download";
import type { ReaderPaper } from "../../src/reader/mountReaderSection";
import type {
  PaperDownloadRequest,
  ScanSciPort,
} from "../../src/scansci/scan-sci-port";

test("production download adapter snapshots the configured destination and preserves legal-source identifiers", async () => {
  let state = readyState("E:\\paper");
  let request: PaperDownloadRequest | undefined;
  const runtime = runtimeWithDownload(async (value) => {
    request = value;
    state = readyState("D:\\later");
    return value.items.map((item) => ({
      itemID: item.itemID,
      result: {
        status: "downloaded" as const,
        savedPath: item.canonicalFinalTarget,
      },
    }));
  });
  const download = createScanSciDownloadPapers({
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

  const result = await download({
    papers: [paper],
    signal: new AbortController().signal,
    onProgress() {},
  });

  assert.deepEqual(result, [
    {
      paperID: "paper",
      result: {
        status: "downloaded",
        savedPath: "E:\\paper\\A legal paper results.pdf",
      },
    },
  ]);
  assert.equal(request?.downloadDestination, "E:\\paper");
  assert.deepEqual(request?.items, [
    {
      itemID: "paper",
      paper: {
        title: paper.title,
        doi: paper.doi,
        arxivID: paper.arxivID,
        pmcid: paper.pmcid,
        primaryResultURL: paper.primaryResultURL,
      },
      canonicalFinalTarget: "E:\\paper\\A legal paper results.pdf",
    },
  ]);
});

test("production download dependencies expose setup and the live ScanSci adapter together", () => {
  const setup = setupController(() => readyState("E:\\paper"));
  const dependencies = createScanSciDownloadDependencies({
    runtime: runtimeWithDownload(async () => []),
    setup,
  });

  assert.equal(dependencies.downloadSetup, setup);
  assert.equal(typeof dependencies.downloadPapers, "function");
});

test("production download adapter fails explicitly until the sidecar probe is ready", async () => {
  let called = false;
  const runtime = runtimeWithDownload(async () => {
    called = true;
    return [];
  });
  const download = createScanSciDownloadPapers({
    runtime,
    setup: setupController(() => ({
      ...readyState("E:\\paper"),
      runtime: { status: "unchecked" },
    })),
  });

  const result = await download({
    papers: [
      {
        id: "paper",
        ordinal: 0,
        title: "Paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/example",
        doi: "10.1000/example",
      },
    ],
    signal: new AbortController().signal,
    onProgress() {},
  });

  assert.equal(result[0]?.result.status, "failed");
  if (result[0]?.result.status !== "failed") return;
  assert.match(result[0].result.error, /sidecar capability is not ready/u);
  assert.equal(called, false);
});

test("Windows filename generation rejects device names and trims unsafe suffixes", () => {
  assert.equal(safeWindowsFilenameStem("CON"), "paper");
  assert.equal(safeWindowsFilenameStem("  title...  "), "title");
});

function readyState(destination: string): DownloadSettingsState {
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
        moduleVersion: "3.1.0",
        schemaVersion: 3,
        sourceRulesVersion: 3,
        dependencies: [],
        features: {
          onePaperDownload: "available",
          batchDownload: "available",
          visibleLogin: "disabled",
        },
        routes: [
          {
            routeID: "open-access",
            status: "available",
            sources: ["arxiv", "pmc"],
            operations: ["downloadOne", "downloadBatch"],
          },
          {
            routeID: "institution-webvpn/ieee/one-click-single",
            status: "candidate",
            reason: "real-world-route-audit-pending",
            operations: ["visibleLogin", "downloadOne"],
          },
        ],
        sidecar: {
          protocol: "reference-for-zotero.scansci-sidecar",
          contractVersion: "1.1.0",
          resultSchemaVersion: "1.0.0",
          upstreamRevision: "5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5",
          dirty: false,
        },
      },
    },
  };
}

function setupController(
  getState: () => DownloadSettingsState,
): DownloadSettingsController {
  return {
    getState,
    subscribe: () => () => undefined,
    async changeDownloadDestination() {},
    resetDownloadDestination() {},
    async probeRuntime() {},
    dispose() {},
  };
}

function runtimeWithDownload(
  downloadPapers: ScanSciPort["downloadPapers"],
): ScanSciPort {
  return {
    async probe() {
      throw new Error("not used");
    },
    async startVisibleLogin() {
      throw new Error("not used");
    },
    downloadPapers,
  };
}
