import assert from "node:assert/strict";
import test from "node:test";
import type {
  DownloadSettingsController,
  DownloadSettingsState,
} from "../../src/application/download-settings";
import {
  createScanSciDownloadPapers,
  safeWindowsFilenameStem,
} from "../../src/application/scan-sci-download";
import type { ReaderPaper } from "../../src/reader/mountReaderSection";
import type {
  PaperDownloadRequest,
  ScanSciPort,
} from "../../src/scansci/scan-sci-port";

test("production download adapter snapshots both configured directories and preserves legal-source identifiers", async () => {
  let state = readyState("E:\\paper", "E:\\paper\\scanscicache");
  let request: PaperDownloadRequest | undefined;
  const runtime = runtimeWithDownload(async (value) => {
    request = value;
    state = readyState("D:\\later", "D:\\later-cache");
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
  assert.equal(request?.cacheDirectory, "E:\\paper\\scanscicache");
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

test("each Download request starts with the latest saved destination and Cache path", async () => {
  let state = readyState("E:\\paper", "E:\\paper\\scanscicache");
  const directories: Array<readonly [string, string]> = [];
  const runtime = runtimeWithDownload(async (request) => {
    directories.push([request.downloadDestination, request.cacheDirectory]);
    return [];
  });
  const download = createScanSciDownloadPapers({
    runtime,
    setup: setupController(() => state),
  });
  const request = {
    papers: [],
    signal: new AbortController().signal,
    onProgress() {},
  };

  await download(request);
  state = readyState("D:\\Current\\Papers", "D:\\Current\\ScanSciCache");
  await download(request);

  assert.deepEqual(directories, [
    ["E:\\paper", "E:\\paper\\scanscicache"],
    ["D:\\Current\\Papers", "D:\\Current\\ScanSciCache"],
  ]);
});

test("download is blocked with an explicit reminder until both paths are configured", async () => {
  let called = false;
  const download = createScanSciDownloadPapers({
    runtime: runtimeWithDownload(async () => {
      called = true;
      return [];
    }),
    setup: setupController(() => ({
      destinationError: "请先配置下载目录。",
      cacheDirectoryError: "请先配置 Cache 路径。",
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

  assert.equal(called, false);
  assert.deepEqual(result[0]?.result, {
    status: "failed",
    error: "请先配置下载目录和 Cache 路径。",
  });
});

test("production download adapter always delegates so every click re-probes the sidecar", async () => {
  let called = false;
  const runtime = runtimeWithDownload(async (request) => {
    called = true;
    return request.items.map((item) => ({
      itemID: item.itemID,
      result: {
        status: "failed" as const,
        error: "No compatible ScanSci sidecar runtime was detected",
      },
    }));
  });
  const download = createScanSciDownloadPapers({
    runtime,
    setup: setupController(() => ({
      ...readyState("E:\\paper", "E:\\paper\\scanscicache"),
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
  assert.match(result[0].result.error, /No compatible ScanSci sidecar/u);
  assert.equal(called, true);
});

test("Windows filename generation rejects device names and trims unsafe suffixes", () => {
  assert.equal(safeWindowsFilenameStem("CON"), "paper");
  assert.equal(safeWindowsFilenameStem("  title...  "), "title");
});

function readyState(
  destination: string,
  cacheDirectory: string,
): DownloadSettingsState {
  return {
    downloadDestination: destination,
    cacheDirectory,
    runtime: {
      status: "ready",
      capability: {
        status: "available",
        executable: "C:\\runtime\\python.exe",
        pythonVersion: "3.12.10",
        architecture: "x64",
        moduleVersion: "3.2.0",
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
    async changeCacheDirectory() {},
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
