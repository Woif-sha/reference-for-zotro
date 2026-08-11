import assert from "node:assert/strict";
import test from "node:test";
import {
  createPythonScanSciPort,
  type PythonProcessRequest,
  type PythonProcessResult,
  type PythonScanSciRuntime,
} from "../../src/scansci/python-scan-sci-port";

test("automatic detection establishes capability only through sidecar probe", async () => {
  const calls: PythonProcessRequest[] = [];
  const runtime = runtimeWith(async (request) => {
    calls.push(request);
    if (request.arguments.includes("-0p")) {
      return processResult(
        "-V:3.12 C:\\Python312\\python.exe\n-V:3.13 C:\\Python313\\python.exe\n",
      );
    }
    const input = protocolInput(request);
    assert.equal(input.operation, "probe");
    const version = request.command.includes("313") ? "3.13.1" : "3.12.10";
    return sidecarComplete(input, probePayload(request.command, version));
  });
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const capability = await port.probe();

  assert.equal(capability.executable, "C:\\Python313\\python.exe");
  assert.equal(capability.pythonVersion, "3.13.1");
  assert.ok(
    calls
      .filter((call) => !call.arguments.includes("-0p"))
      .every((call) => protocolInput(call).operation === "probe"),
  );
  assert.ok(
    calls.every(
      (call) =>
        !call.arguments.some((argument) =>
          /(?:^|\b)(?:-c|venv|pip|install)(?:\b|$)/iu.test(argument),
        ),
    ),
  );
});

test("automatic probe returns the exact incompatibility without creating or switching environments", async () => {
  const calls: PythonProcessRequest[] = [];
  const runtime = runtimeWith(async (request) => {
    calls.push(request);
    if (request.arguments.includes("-0p")) {
      return processResult("-V:3.12 C:\\Python312\\python.exe\n");
    }
    const input = protocolInput(request);
    return sidecarComplete(input, {
      ...probePayload(request.command, "3.12.10"),
      compatibility: {
        status: "incompatible",
        minimumPython: "3.11",
        dependencies: compatibilityDependencies().map((dependency) =>
          dependency.name === "requests"
            ? { ...dependency, installedVersion: undefined, status: "missing" }
            : dependency,
        ),
      },
      routeCapabilities: [
        {
          routeId: "open-access",
          available: false,
          sources: ["arxiv", "pmc"],
          operations: ["downloadOne", "downloadBatch"],
          concurrency: "bounded",
        },
        institutionCandidate(),
      ],
    });
  });
  const port = createPythonScanSciPort(runtime, adapterOptions());

  await assert.rejects(port.probe(), /requests==2\.34\.2 is missing/u);
  assert.ok(
    calls.every(
      (call) =>
        !call.arguments.some((argument) => /venv|pip|install/iu.test(argument)),
    ),
  );
});

test("one paper uses one downloadOne operation and one isolated request directory", async () => {
  const requestID = "33333333-3333-4333-8333-333333333333";
  const calls: PythonProcessRequest[] = [];
  const exclusiveDirectories: string[] = [];
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    requestID,
  ];
  const runtime = runtimeWith(
    async (request) => {
      calls.push(request);
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      assert.equal(input.operation, "downloadOne");
      return sidecarComplete(input, {
        result: downloadedResult("2101.00001", "paper.pdf"),
      });
    },
    {
      nextRequestID: () => ids.shift() ?? requestID,
      createDirectoryExclusive: async (path) => {
        exclusiveDirectories.push(path);
      },
    },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const result = await port.downloadPapers({
    items: [
      {
        itemID: "paper",
        paper: { title: "Paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\Paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  });

  assert.equal(result[0]?.result.status, "downloaded");
  assert.deepEqual(
    calls
      .filter((call) => !call.arguments.includes("-0p"))
      .map((call) => protocolInput(call).operation),
    ["probe", "probe", "downloadOne"],
  );
  assert.deepEqual(exclusiveDirectories, [
    `E:\\paper\\ScanSciCache\\${requestID}`,
  ]);
});

test("one sidecar batch preserves per-paper progress, legal-source commit, and failure isolation", async () => {
  const batchID = "33333333-3333-4333-8333-333333333333";
  const requestDirectory = `E:\\paper\\ScanSciCache\\${batchID}`;
  const calls: PythonProcessRequest[] = [];
  const committed: Array<readonly [string, string, string, string]> = [];
  const removed: string[] = [];
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    batchID,
  ];
  const runtime = runtimeWith(
    async (request) => {
      calls.push(request);
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      assert.equal(input.operation, "downloadBatch");
      const downloaded = downloadedResult("2101.00001", "arxiv_2101.00001.pdf");
      const collision = downloadedResult("10.1000/collision", "collision.pdf");
      const failed = {
        schemaVersion: "1.0.0",
        status: "failed",
        identifier: "PMC9999",
        sourceEvidence: null,
        relativePath: null,
        error: { code: "no-pdf", message: "No audited PDF was found" },
      };
      const messages = [
        sidecarProgress(input, 1, 3, "item-1", downloaded),
        sidecarProgress(input, 2, 3, "item-2", collision),
        sidecarProgress(input, 3, 3, "item-3", failed),
        sidecarCompletion(input, {
          total: 3,
          downloaded: 2,
          failed: 1,
          results: [
            { itemId: "item-1", result: downloaded },
            { itemId: "item-2", result: collision },
            { itemId: "item-3", result: failed },
          ],
        }),
      ];
      for (const message of messages) {
        await request.onStdoutLine?.(JSON.stringify(message));
      }
      return processResult(
        `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
      );
    },
    {
      nextRequestID: () => ids.shift() ?? batchID,
      commitExclusiveContained: async (
        sourceRoot,
        source,
        destinationRoot,
        target,
      ) => {
        committed.push([sourceRoot, source, destinationRoot, target]);
        if (target.endsWith("Collision paper.pdf")) {
          throw new Error("Final target already exists");
        }
      },
      removeDirectory: async (path) => {
        removed.push(path);
      },
    },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());
  const progress: unknown[] = [];

  const result = await port.downloadPapers({
    items: [
      {
        itemID: "arxiv-paper",
        paper: { title: "arXiv paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\arXiv paper.pdf",
      },
      {
        itemID: "collision-paper",
        paper: { title: "Collision paper", doi: "10.1000/collision" },
        canonicalFinalTarget: "E:\\paper\\Collision paper.pdf",
      },
      {
        itemID: "pmc-paper",
        paper: { title: "PMC paper", pmcid: "PMC9999" },
        canonicalFinalTarget: "E:\\paper\\PMC paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
    onProgress: (current) => progress.push(current),
  });

  assert.deepEqual(result, [
    {
      itemID: "arxiv-paper",
      result: {
        status: "downloaded",
        savedPath: "E:\\paper\\arXiv paper.pdf",
      },
    },
    {
      itemID: "collision-paper",
      result: {
        status: "failed",
        error: "Final target already exists",
      },
    },
    {
      itemID: "pmc-paper",
      result: {
        status: "failed",
        error: "no-pdf: No audited PDF was found",
      },
    },
  ]);
  assert.deepEqual(progress, result);
  assert.equal(
    calls.filter(
      (call) =>
        !call.arguments.includes("-0p") &&
        protocolInput(call).operation === "downloadBatch",
    ).length,
    1,
  );
  assert.deepEqual(committed, [
    [
      requestDirectory,
      `${requestDirectory}\\arxiv_2101.00001.pdf`,
      "E:\\paper",
      "E:\\paper\\arXiv paper.pdf",
    ],
    [
      requestDirectory,
      `${requestDirectory}\\collision.pdf`,
      "E:\\paper",
      "E:\\paper\\Collision paper.pdf",
    ],
  ]);
  assert.deepEqual(removed, [requestDirectory]);
});

test("an invalid canonical target fails only that paper while the remaining selection stays one batch", async () => {
  const batchID = "33333333-3333-4333-8333-333333333333";
  const calls: PythonProcessRequest[] = [];
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    batchID,
  ];
  const runtime = runtimeWith(
    async (request) => {
      calls.push(request);
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      assert.equal(input.operation, "downloadBatch");
      const downloaded = downloadedResult("2101.00001", "paper.pdf");
      const progress = sidecarProgress(input, 1, 1, "item-1", downloaded);
      const complete = sidecarCompletion(input, {
        total: 1,
        downloaded: 1,
        failed: 0,
        results: [{ itemId: "item-1", result: downloaded }],
      });
      await request.onStdoutLine?.(JSON.stringify(progress));
      await request.onStdoutLine?.(JSON.stringify(complete));
      return processResult(
        `${JSON.stringify(progress)}\n${JSON.stringify(complete)}\n`,
      );
    },
    { nextRequestID: () => ids.shift() ?? batchID },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const results = await port.downloadPapers({
    items: [
      {
        itemID: "bad-target",
        paper: { title: "Bad target", pmcid: "PMC1234" },
        canonicalFinalTarget: "E:\\other\\Bad target.pdf",
      },
      {
        itemID: "good-target",
        paper: { title: "Paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\Paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  });

  assert.equal(results[0]?.result.status, "failed");
  assert.match(
    results[0]?.result.status === "failed" ? results[0].result.error : "",
    /outside the download destination/u,
  );
  assert.equal(results[1]?.result.status, "downloaded");
  assert.equal(
    calls.filter(
      (call) =>
        !call.arguments.includes("-0p") &&
        protocolInput(call).operation === "downloadBatch",
    ).length,
    1,
  );
});

test("prohibited source evidence never reaches the exclusive final commit", async () => {
  let committed = false;
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const runtime = runtimeWith(
    async (request) => {
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      return sidecarComplete(input, {
        result: {
          ...downloadedResult("2101.00001", "paper.pdf"),
          sourceEvidence: {
            routeId: "open-access",
            source: "scihub",
            sourceUrl: "https://sci-hub.example/paper.pdf",
            egressHosts: ["sci-hub.example"],
            legal: true,
          },
        },
      });
    },
    {
      nextRequestID: () =>
        ids.shift() ?? "44444444-4444-4444-8444-444444444444",
      commitExclusiveContained: async () => {
        committed = true;
      },
    },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const [outcome] = await port.downloadPapers({
    items: [
      {
        itemID: "paper",
        paper: { title: "Paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\Paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  });

  assert.deepEqual(outcome?.result, {
    status: "failed",
    error: "Prohibited ScanSci source: scihub",
  });
  assert.equal(committed, false);
});

test("unexpected source-rule routes fail before sidecar egress", async () => {
  let downloadCalled = false;
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const tamperedRules = JSON.parse(sourceRules()) as {
    routes: Array<Record<string, unknown>>;
  };
  tamperedRules.routes.push({
    id: "unreviewed-source",
    enabled: true,
    kind: "open-access",
    allowedHosts: ["example.test"],
  });
  const runtime = runtimeWith(
    async (request) => {
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      downloadCalled = true;
      return sidecarComplete(input, {
        result: downloadedResult("2101.00001", "paper.pdf"),
      });
    },
    {
      nextRequestID: () =>
        ids.shift() ?? "33333333-3333-4333-8333-333333333333",
      readText: async () => JSON.stringify(tamperedRules),
    },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const [outcome] = await port.downloadPapers({
    items: [
      {
        itemID: "paper",
        paper: { title: "Paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\Paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  });

  assert.equal(outcome?.result.status, "failed");
  assert.match(
    outcome?.result.status === "failed" ? outcome.result.error : "",
    /source-rules route set is incompatible/u,
  );
  assert.equal(downloadCalled, false);
});

test("non-standard HTTPS ports fail plugin source validation before final commit", async () => {
  let committed = false;
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const runtime = runtimeWith(
    async (request) => {
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      return sidecarComplete(input, {
        result: {
          ...downloadedResult("2101.00001", "paper.pdf"),
          sourceEvidence: {
            routeId: "open-access",
            source: "arxiv",
            sourceUrl: "https://arxiv.org:444/paper.pdf",
            egressHosts: ["arxiv.org"],
            legal: true,
          },
        },
      });
    },
    {
      nextRequestID: () =>
        ids.shift() ?? "44444444-4444-4444-8444-444444444444",
      commitExclusiveContained: async () => {
        committed = true;
      },
    },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const [outcome] = await port.downloadPapers({
    items: [
      {
        itemID: "paper",
        paper: { title: "Paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\Paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  });

  assert.equal(outcome?.result.status, "failed");
  assert.match(
    outcome?.result.status === "failed" ? outcome.result.error : "",
    /strict egress validation/u,
  );
  assert.equal(committed, false);
});

test("an in-request output link is rejected by the final commit seam", async () => {
  const requestID = "33333333-3333-4333-8333-333333333333";
  const requestDirectory = `E:\\paper\\ScanSciCache\\${requestID}`;
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    requestID,
  ];
  const runtime = runtimeWith(
    async (request) => {
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      return sidecarComplete(input, {
        result: downloadedResult("2101.00001", "linked.pdf"),
      });
    },
    {
      nextRequestID: () => ids.shift() ?? requestID,
      canonicalizeExisting: async (path) =>
        path.endsWith("linked.pdf") ? `${requestDirectory}\\regular.pdf` : path,
      commitExclusiveContained: async (_root, source) => {
        if (source.endsWith("linked.pdf")) {
          throw new Error(
            "ScanSci output cannot be a symbolic link or junction",
          );
        }
      },
    },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const [outcome] = await port.downloadPapers({
    items: [
      {
        itemID: "paper",
        paper: { title: "Paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\Paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  });

  assert.deepEqual(outcome?.result, {
    status: "failed",
    error: "ScanSci output cannot be a symbolic link or junction",
  });
});

test("a timed-out sidecar leaves only its request directory as inspectable crash residue", async () => {
  const requestID = "33333333-3333-4333-8333-333333333333";
  const requestDirectory = `E:\\paper\\ScanSciCache\\${requestID}`;
  const removed: string[] = [];
  const exclusiveDirectories: string[] = [];
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    requestID,
  ];
  const runtime = runtimeWith(
    async (request) => {
      if (request.arguments.includes("-0p")) {
        return processResult("-V:3.12 C:\\Python312\\python.exe\n");
      }
      const input = protocolInput(request);
      if (input.operation === "probe") {
        return sidecarComplete(
          input,
          probePayload("C:\\Python312\\python.exe", "3.12.10"),
        );
      }
      return {
        exitCode: -1,
        stdout: "",
        stderr: "",
        timedOut: true,
      };
    },
    {
      nextRequestID: () => ids.shift() ?? requestID,
      removeDirectory: async (path) => {
        removed.push(path);
      },
      createDirectoryExclusive: async (path) => {
        exclusiveDirectories.push(path);
      },
    },
  );
  const port = createPythonScanSciPort(runtime, adapterOptions());

  const [outcome] = await port.downloadPapers({
    items: [
      {
        itemID: "paper",
        paper: { title: "Paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\Paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  });

  assert.deepEqual(outcome?.result, {
    status: "failed",
    error: "ScanSci sidecar timed out",
  });
  assert.deepEqual(removed, []);
  assert.deepEqual(exclusiveDirectories, [requestDirectory]);
});

function runtimeWith(
  runProcess: PythonScanSciRuntime["runProcess"],
  overrides: Partial<PythonScanSciRuntime["files"]> &
    Pick<Partial<PythonScanSciRuntime>, "nextRequestID"> = {},
): PythonScanSciRuntime {
  return {
    async ensureModuleAssets() {},
    runProcess,
    files: {
      async pathExists() {
        return false;
      },
      async canonicalizeExisting(path) {
        return path;
      },
      async createDirectory() {},
      async createDirectoryExclusive() {},
      async readText() {
        return sourceRules();
      },
      async commitExclusiveContained() {},
      async removeDirectory() {},
      ...overrides,
    },
    nextRequestID:
      overrides.nextRequestID ?? (() => "11111111-1111-4111-8111-111111111111"),
  };
}

function adapterOptions() {
  return {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    hostArchitecture: "x64" as const,
  };
}

function protocolInput(request: PythonProcessRequest) {
  return JSON.parse(request.stdin) as {
    requestId: string;
    operation: string;
  };
}

function processResult(stdout: string): PythonProcessResult {
  return { exitCode: 0, stdout, stderr: "", timedOut: false };
}

function sidecarComplete(
  request: Readonly<{ requestId: string; operation: string }>,
  payload: unknown,
): PythonProcessResult {
  return processResult(
    `${JSON.stringify(sidecarCompletion(request, payload))}\n`,
  );
}

function sidecarCompletion(
  request: Readonly<{ requestId: string; operation: string }>,
  payload: unknown,
) {
  return {
    protocol: "reference-for-zotero.scansci-sidecar",
    contractVersion: "1.1.0",
    resultSchemaVersion: "1.0.0",
    requestId: request.requestId,
    operation: request.operation,
    type: "complete",
    ok: true,
    payload,
  };
}

function sidecarProgress(
  request: Readonly<{ requestId: string; operation: string }>,
  sequence: number,
  total: number,
  itemId: string,
  result: unknown,
) {
  return {
    protocol: "reference-for-zotero.scansci-sidecar",
    contractVersion: "1.1.0",
    resultSchemaVersion: "1.0.0",
    requestId: request.requestId,
    operation: request.operation,
    type: "progress",
    payload: { sequence, completed: sequence, total, itemId, result },
  };
}

function probePayload(executable: string, pythonVersion: string) {
  return {
    application: { name: "reference-for-zotero-scansci", version: "3.2.0" },
    runtime: {
      implementation: "CPython",
      pythonVersion,
      executable,
      architecture: "x64",
      platform: "Windows",
    },
    source: {
      repository: "Rimagination/scansci-pdf",
      revision: "5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5",
      installKind: "audited-plugin-fragments",
      dirty: false,
    },
    contractVersion: "1.1.0",
    resultSchemaVersion: "1.0.0",
    operations: ["downloadBatch", "downloadOne", "probe", "visibleLogin"],
    compatibility: {
      status: "compatible",
      minimumPython: "3.11",
      dependencies: compatibilityDependencies(),
    },
    routeCapabilities: [
      {
        routeId: "open-access",
        available: true,
        sources: ["arxiv", "pmc"],
        operations: ["downloadOne", "downloadBatch"],
        concurrency: "bounded",
      },
      institutionCandidate(),
    ],
    policy: {
      mode: "legal-only",
      disabledRoutes: [
        "sci-hub",
        "libgen",
        "scibban",
        "tor",
        "proxy-pool",
        "vpnsci",
        "unknown",
      ],
    },
  };
}

function institutionCandidate() {
  return {
    routeId: "institution-webvpn/ieee/one-click-single",
    status: "candidate",
    available: false,
    operations: ["visibleLogin", "downloadOne"],
    concurrency: "single-profile-writer",
    profileId: "zotero",
    reason: "real-world-route-audit-pending",
  };
}

function compatibilityDependencies() {
  return [
    ["requests", "2.34.2"],
    ["certifi", "2026.7.22"],
    ["charset-normalizer", "3.4.9"],
    ["idna", "3.18"],
    ["urllib3", "2.7.0"],
  ].map(([name, version]) => ({
    name: name ?? "",
    requirement: `==${version ?? ""}`,
    installedVersion: version ?? "",
    status: "available" as const,
  }));
}

function downloadedResult(identifier: string, relativePath: string) {
  return {
    schemaVersion: "1.0.0",
    status: "downloaded",
    identifier,
    sourceEvidence: {
      routeId: "open-access",
      source: "arxiv",
      sourceUrl: `https://arxiv.org/pdf/${identifier}.pdf`,
      egressHosts: ["arxiv.org"],
      legal: true,
    },
    relativePath,
    error: null,
  };
}

function sourceRules(): string {
  return JSON.stringify({
    schemaVersion: 3,
    sourceRulesVersion: 3,
    routes: [
      {
        id: "arxiv",
        enabled: true,
        kind: "open-access",
        allowedHosts: ["arxiv.org", "export.arxiv.org"],
      },
      {
        id: "pmc",
        enabled: true,
        kind: "open-access",
        allowedHosts: ["www.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov"],
      },
      {
        id: "institution-browser",
        enabled: false,
        kind: "institution",
        allowedHosts: [],
        disabledReason:
          "Institution browser route is disabled pending strict-TLS, source, egress, Windows, and Zotero acceptance",
      },
    ],
    prohibitedSources: [
      "scihub",
      "libgen",
      "scibban",
      "tor",
      "proxy-pool",
      "vpnsci",
      "unknown",
    ],
    forcedPolicy: {
      strategy: "legal_only",
      scihubEnabled: false,
      useTor: false,
      useVpnsci: false,
    },
    removedEnvironment: [
      "ALL_PROXY",
      "HTTPS_PROXY",
      "HTTP_PROXY",
      "NO_PROXY",
      "all_proxy",
      "https_proxy",
      "http_proxy",
      "no_proxy",
      "PIP_CONFIG_FILE",
      "PIP_EXTRA_INDEX_URL",
      "PIP_INDEX_URL",
      "PIP_TRUSTED_HOST",
      "PIP_CERT",
      "PIP_CLIENT_CERT",
      "PIP_PROXY",
      "REQUESTS_CA_BUNDLE",
      "CURL_CA_BUNDLE",
      "SSL_CERT_FILE",
      "SCANSCI_PDF_PROXY",
      "CLOAKBROWSER_LICENSE_KEY",
      "CLOAKBROWSER_BINARY_PATH",
      "CLOAKBROWSER_DOWNLOAD_URL",
    ],
  });
}
