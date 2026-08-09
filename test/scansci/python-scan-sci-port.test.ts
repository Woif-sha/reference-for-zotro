import assert from "node:assert/strict";
import test from "node:test";
import {
  SCANSCI_SCHEMA_VERSION,
  SCANSCI_SOURCE_RULES_VERSION,
} from "../../src/scansci/scan-sci-port";
import {
  createPythonScanSciPort,
  type PythonScanSciRuntime,
} from "../../src/scansci/python-scan-sci-port";

test("one-time Python override is used only after automatic detection fails", async () => {
  const calls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const runtime = runtimeWith(async (request) => {
    calls.push(request);
    if (request.command !== "D:\\Python\\Python3.12\\python.exe") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "not found",
        timedOut: false,
      };
    }
    return probeResult({
      executable: "D:\\Python\\Python3.12\\python.exe",
      pythonVersion: "3.12.10",
      architecture: "x64",
    });
  });

  const port = createPythonScanSciPort(runtime, {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    privateRuntimeRoot: "C:\\profile\\reference-for-zotero\\python",
    hostArchitecture: "x64",
  });

  assert.equal(calls.length, 0);
  const preparation = await port.prepareRuntime({
    allowInstall: false,
    executableOverride: "D:\\Python\\Python3.12\\python.exe",
  });
  assert.equal(preparation.status, "ready");
  if (preparation.status !== "ready") return;
  assert.equal(
    preparation.capability.executable,
    "D:\\Python\\Python3.12\\python.exe",
  );
  assert.equal(preparation.capability.selectionReason, "configured override");
  assert.equal(preparation.capability.schemaVersion, SCANSCI_SCHEMA_VERSION);
  assert.equal(
    preparation.capability.sourceRulesVersion,
    SCANSCI_SOURCE_RULES_VERSION,
  );
  assert.equal(preparation.capability.dependencies.length, 5);
  assert.deepEqual(
    calls.map((call) => call.command),
    ["py", "python", "D:\\Python\\Python3.12\\python.exe"],
  );
  const probeCall = calls[2];
  assert.ok(probeCall);
  assert.equal(probeCall.command, "D:\\Python\\Python3.12\\python.exe");
  assert.deepEqual(probeCall.arguments.slice(0, 3), ["-I", "-B", "-c"]);
  assert.match(probeCall.arguments[3] ?? "", /LOCKED|locked =/u);
  assert.equal(
    probeCall.stdin,
    `${JSON.stringify({
      schemaVersion: 3,
      sourceRulesVersion: 3,
      operation: "probe",
      request: {},
    })}\n`,
  );
  assert.equal(probeCall.timeoutMilliseconds, 10_000);
  assert.deepEqual(probeCall.removeEnvironment, [
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
  ]);
});

test("automatic detection selects the highest compatible Python from launcher and PATH candidates", async () => {
  const calls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const runtime = runtimeWith(async (request) => {
    calls.push(request);
    if (request.command === "py") {
      return {
        exitCode: 0,
        stdout:
          " -V:3.12 *        D:\\Python\\Python3.12\\python.exe\r\n" +
          " -V:3.9           D:\\Python\\Python39\\python.exe\r\n",
        stderr: "",
        timedOut: false,
      };
    }
    if (request.command === "D:\\Python\\Python3.12\\python.exe") {
      return probeResult({
        executable: request.command,
        pythonVersion: "3.12.10",
        architecture: "x64",
      });
    }
    if (request.command === "D:\\Python\\Python39\\python.exe") {
      return probeResult({
        executable: request.command,
        pythonVersion: "3.9.13",
        architecture: "x64",
      });
    }
    assert.equal(request.command, "python");
    return probeResult({
      executable: "C:\\Python313\\python.exe",
      pythonVersion: "3.13.1",
      architecture: "x64",
    });
  });

  const port = createPythonScanSciPort(runtime, {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    privateRuntimeRoot: "C:\\profile\\reference-for-zotero\\python",
    hostArchitecture: "x64",
  });

  const preparation = await port.prepareRuntime({ allowInstall: false });

  assert.equal(preparation.status, "ready");
  if (preparation.status !== "ready") return;
  const capability = preparation.capability;
  assert.equal(capability.executable, "C:\\Python313\\python.exe");
  assert.equal(capability.pythonVersion, "3.13.1");
  assert.equal(capability.selectionReason, "automatic detection");
  assert.deepEqual(
    calls.map((call) => call.command),
    [
      "py",
      "D:\\Python\\Python3.12\\python.exe",
      "D:\\Python\\Python39\\python.exe",
      "python",
    ],
  );
});

test("capability reports missing dependencies after automatic detection and the one-time override fail", async () => {
  const calls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const runtime = runtimeWith(async (request) => {
    calls.push(request);
    return missingDependencyProbeResult(request.command);
  });
  const port = createPythonScanSciPort(runtime, downloadOptions());

  const result = await port.prepareRuntime({
    allowInstall: false,
    executableOverride: "D:\\Python\\Python3.12\\python.exe",
  });
  assert.equal(result.status, "needs-install");
  if (result.status !== "needs-install") return;
  assert.deepEqual(
    {
      baseExecutable: result.plan.baseExecutable,
      privateEnvironment: result.plan.privateEnvironment,
      packageIndex: result.plan.packageIndex,
      requirementsLock: result.plan.requirementsLock,
    },
    {
      baseExecutable: "D:\\Python\\Python3.12\\python.exe",
      privateEnvironment: "C:\\profile\\reference-for-zotero\\python\\venv",
      packageIndex: "https://pypi.tuna.tsinghua.edu.cn/simple",
      requirementsLock:
        "C:\\addon\\python\\reference_for_zotero_scansci\\requirements.lock",
    },
  );
  assert.deepEqual(
    result.plan.dependencies.map((dependency) => [
      dependency.name,
      dependency.status,
    ]),
    [
      ["requests", "missing"],
      ["certifi", "available"],
      ["charset-normalizer", "available"],
      ["idna", "available"],
      ["urllib3", "available"],
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.command),
    ["py", "python", "D:\\Python\\Python3.12\\python.exe"],
  );
});

test("confirmed runtime preparation creates a private venv and installs only the hash lock", async () => {
  const calls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const created: string[] = [];
  let assetsPrepared = 0;
  const privatePython =
    "C:\\profile\\reference-for-zotero\\python\\venv\\Scripts\\python.exe";
  const runtime: PythonScanSciRuntime = {
    async ensureModuleAssets() {
      assetsPrepared += 1;
    },
    async runProcess(request) {
      calls.push(request);
      if (
        request.arguments.includes("venv") ||
        request.arguments.includes("pip")
      ) {
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
      if (request.command === privatePython) {
        return probeResult({
          executable: privatePython,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      return missingDependencyProbeResult(request.command);
    },
    files: {
      async pathExists() {
        return false;
      },
      async canonicalizeExisting(path) {
        return path;
      },
      async createDirectory(path) {
        created.push(path);
      },
      async createDirectoryExclusive(path) {
        created.push(path);
      },
      async readText() {
        return sourceRules();
      },
      async copyExclusiveContained() {},
      async removeDirectory() {},
    },
    nextRequestID: () => "00000000-0000-4000-8000-000000000000",
  };
  const port = createPythonScanSciPort(runtime, downloadOptions());

  const result = await port.prepareRuntime({
    allowInstall: true,
    executableOverride: "D:\\Python\\Python3.12\\python.exe",
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.capability.executable, privatePython);
  assert.equal(result.capability.selectionReason, "private environment");
  assert.deepEqual(created, [
    "C:\\profile\\reference-for-zotero\\python",
    "C:\\profile\\reference-for-zotero\\python\\venv",
  ]);
  assert.equal(assetsPrepared, 1);
  const venvCall = calls.find((call) => call.arguments.includes("venv"));
  assert.deepEqual(venvCall?.arguments, [
    "-E",
    "-s",
    "-m",
    "venv",
    "C:\\profile\\reference-for-zotero\\python\\venv",
  ]);
  assert.equal(
    venvCall?.workingDirectory,
    "C:\\profile\\reference-for-zotero\\python",
  );
  const pipCall = calls.find((call) => call.arguments.includes("pip"));
  assert.deepEqual(pipCall?.arguments, [
    "-E",
    "-s",
    "-m",
    "pip",
    "--isolated",
    "--disable-pip-version-check",
    "install",
    "--no-input",
    "--index-url",
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "--require-hashes",
    "--only-binary=:all:",
    "-r",
    "C:\\addon\\python\\reference_for_zotero_scansci\\requirements.lock",
  ]);
  assert.equal(
    pipCall?.workingDirectory,
    "C:\\profile\\reference-for-zotero\\python\\venv",
  );
});

test("visible login stays disabled until an institution route is audited and enabled", async () => {
  let processCalls = 0;
  const runtime = runtimeWith(async () => {
    processCalls += 1;
    throw new Error("must not start Python for a disabled route");
  }, sourceRules());
  const port = createPythonScanSciPort(runtime, {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    privateRuntimeRoot: "C:\\profile\\reference-for-zotero\\python",
    hostArchitecture: "x64",
  });

  assert.deepEqual(
    await port.startVisibleLogin({
      userInitiated: true,
      routeID: "institution-browser",
    }),
    {
      status: "failed",
      error:
        "Institution browser route is disabled pending strict-TLS, source, egress, Windows, and Zotero acceptance",
    },
  );
  assert.equal(processCalls, 0);
});

test("one-paper download isolates Python output and exclusively commits the canonical target", async () => {
  const requestID = "9d8937a4-d7d8-45c4-a8d4-1531632f7269";
  const requestDirectory = `E:\\paper\\ScanSciCache\\${requestID}`;
  const sourcePath = `${requestDirectory}\\2101.00001.pdf`;
  const processCalls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const created: string[] = [];
  const copied: Array<readonly [string, string]> = [];
  const removed: string[] = [];
  const runtime: PythonScanSciRuntime = {
    async ensureModuleAssets() {},
    async runProcess(request) {
      processCalls.push(request);
      const input = JSON.parse(request.stdin || "{}") as {
        operation?: string;
      };
      if (input.operation === "probe") {
        return probeResult({
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      assert.equal(input.operation, "download-one");
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          schemaVersion: 3,
          sourceRulesVersion: 3,
          operation: "download-one",
          ok: true,
          result: {
            source: {
              id: "arxiv",
              url: "https://arxiv.org/pdf/2101.00001.pdf",
              egressHosts: ["arxiv.org"],
            },
            outputPath: sourcePath,
          },
        })}\n`,
        stderr: "",
        timedOut: false,
      };
    },
    files: {
      async pathExists() {
        return false;
      },
      async canonicalizeExisting(path) {
        return path;
      },
      async createDirectory(path) {
        created.push(path);
      },
      async createDirectoryExclusive(path) {
        created.push(path);
      },
      async readText() {
        return sourceRules();
      },
      async copyExclusiveContained(source, _destinationRoot, destination) {
        copied.push([source, destination]);
      },
      async removeDirectory(path) {
        removed.push(path);
      },
    },
    nextRequestID: () => requestID,
  };
  const port = createPythonScanSciPort(runtime, {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    privateRuntimeRoot: "C:\\profile\\reference-for-zotero\\python",
    hostArchitecture: "x64",
  });
  await prepareReady(port);

  assert.deepEqual(
    await port.downloadOnePaper({
      paper: {
        title: "Audited arXiv paper",
        arxivID: "2101.00001",
        primaryResultURL: "https://arxiv.org/abs/2101.00001",
      },
      downloadDestination: "E:\\paper",
      canonicalFinalTarget: "E:\\paper\\Audited arXiv paper.pdf",
    }),
    {
      status: "downloaded",
      savedPath: "E:\\paper\\Audited arXiv paper.pdf",
    },
  );
  assert.deepEqual(created, ["E:\\paper\\ScanSciCache", requestDirectory]);
  assert.deepEqual(copied, [
    [sourcePath, "E:\\paper\\Audited arXiv paper.pdf"],
  ]);
  assert.deepEqual(removed, [requestDirectory]);

  const downloadCall = processCalls.find((call) =>
    call.stdin.includes('"operation":"download-one"'),
  );
  assert.ok(downloadCall);
  assert.equal(downloadCall.workingDirectory, requestDirectory);
  assert.deepEqual(JSON.parse(downloadCall.stdin), {
    schemaVersion: 3,
    sourceRulesVersion: 3,
    operation: "download-one",
    request: {
      paper: {
        title: "Audited arXiv paper",
        arxivID: "2101.00001",
        primaryResultURL: "https://arxiv.org/abs/2101.00001",
      },
      outputDirectory: requestDirectory,
      policy: {
        strategy: "legal_only",
        scihubEnabled: false,
        useTor: false,
        useVpnsci: false,
      },
    },
  });
  assert.deepEqual(downloadCall.removeEnvironment, [
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
  ]);
});

test("an ordinary Python download failure is returned and its request directory is cleaned", async () => {
  const requestID = "ddf2670d-b7a0-423d-98b1-e54e148b87ee";
  const removed: string[] = [];
  const runtime = runtimeWithDownload(
    async (request) => {
      const input = JSON.parse(request.stdin) as { operation: string };
      if (input.operation === "probe") {
        return probeResult({
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          schemaVersion: 3,
          sourceRulesVersion: 3,
          operation: "download-one",
          ok: false,
          error: { code: "network", message: "Publisher returned 403" },
        })}\n`,
        stderr: "",
        timedOut: false,
      };
    },
    requestID,
    removed,
  );
  const port = createPythonScanSciPort(runtime, downloadOptions());
  await prepareReady(port);

  assert.deepEqual(await port.downloadOnePaper(downloadRequest()), {
    status: "failed",
    error: "Publisher returned 403",
  });
  assert.deepEqual(removed, [`E:\\paper\\ScanSciCache\\${requestID}`]);
});

test("process diagnostics are bounded and redact URL queries and secret fields", async () => {
  const runtime = runtimeWithDownload(async (request) => {
    const input = JSON.parse(request.stdin) as { operation: string };
    if (input.operation === "probe") {
      return probeResult({
        executable: request.command,
        pythonVersion: "3.12.10",
        architecture: "x64",
      });
    }
    return {
      exitCode: 7,
      stdout: "",
      stderr:
        "request failed at https://publisher.example/paper?token=secret-value " +
        "cookie=private-cookie " +
        "x".repeat(20_000),
      timedOut: false,
    };
  }, "d1c0ae80-da40-4adb-9a87-dfecde61ebd0");
  const port = createPythonScanSciPort(runtime, downloadOptions());
  await prepareReady(port);

  const result = await port.downloadOnePaper(downloadRequest());

  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.match(result.error, /exit code 7/u);
  assert.match(result.error, /\[query omitted\]/u);
  assert.match(result.error, /cookie=\[redacted\]/u);
  assert.doesNotMatch(result.error, /secret-value|private-cookie/u);
  assert.ok(result.error.length <= 1_100);
});

test("prohibited, unknown, and non-HTTPS sources never reach the final commit", async () => {
  const cases = [
    {
      source: {
        id: "scihub",
        url: "https://sci-hub.example/paper.pdf",
        egressHosts: ["sci-hub.example"],
      },
      error: "Prohibited ScanSci source: scihub",
    },
    {
      source: {
        id: "local_cache",
        url: "https://arxiv.org/pdf/2101.00001.pdf",
        egressHosts: ["arxiv.org"],
      },
      error: "Unknown or disabled ScanSci source: local_cache",
    },
    {
      source: {
        id: "arxiv",
        url: "http://arxiv.org/pdf/2101.00001.pdf",
        egressHosts: ["arxiv.org"],
      },
      error: "ScanSci source arxiv failed strict egress validation",
    },
  ] as const;

  for (const [index, current] of cases.entries()) {
    let copied = false;
    const requestID = `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
    const outputPath = `E:\\paper\\ScanSciCache\\${requestID}\\paper.pdf`;
    const runtime = runtimeWithDownload(
      processReturningDownload(current.source, outputPath),
      requestID,
    );
    runtime.files.copyExclusiveContained = async () => {
      copied = true;
    };
    const port = createPythonScanSciPort(runtime, downloadOptions());
    await prepareReady(port);

    assert.deepEqual(await port.downloadOnePaper(downloadRequest()), {
      status: "failed",
      error: current.error,
    });
    assert.equal(copied, false);
  }
});

test("canonical final target and Python output must remain inside their authoritative roots", async () => {
  let processCalls = 0;
  const outsideTargetRuntime = runtimeWithDownload(async () => {
    processCalls += 1;
    throw new Error("must reject the target before starting Python");
  }, "22222222-2222-4222-8222-222222222222");
  const outsideTargetPort = createPythonScanSciPort(
    outsideTargetRuntime,
    downloadOptions(),
  );
  assert.deepEqual(
    await outsideTargetPort.downloadOnePaper({
      ...downloadRequest(),
      canonicalFinalTarget: "E:\\outside\\Paper.pdf",
    }),
    {
      status: "failed",
      error: "Canonical final target is outside the download destination",
    },
  );
  assert.equal(processCalls, 0);
  assert.deepEqual(
    await outsideTargetPort.downloadOnePaper({
      ...downloadRequest(),
      downloadDestination: "\\\\?\\E:\\paper",
      canonicalFinalTarget: "\\\\?\\E:\\paper\\Paper.pdf",
    }),
    {
      status: "failed",
      error: "Download destination must be an absolute Windows path",
    },
  );
  assert.equal(processCalls, 0);

  const requestID = "33333333-3333-4333-8333-333333333333";
  const outsideOutputRuntime = runtimeWithDownload(
    processReturningDownload(
      {
        id: "arxiv",
        url: "https://arxiv.org/pdf/2101.00001.pdf",
        egressHosts: ["arxiv.org"],
      },
      "E:\\paper\\untrusted-cache.pdf",
    ),
    requestID,
  );
  const outsideOutputPort = createPythonScanSciPort(
    outsideOutputRuntime,
    downloadOptions(),
  );
  await prepareReady(outsideOutputPort);
  assert.deepEqual(
    await outsideOutputPort.downloadOnePaper(downloadRequest()),
    {
      status: "failed",
      error: "ScanSci output escaped its request directory",
    },
  );
});

test("an exclusive-copy race fails without overwrite or automatic renaming", async () => {
  const requestID = "44444444-4444-4444-8444-444444444444";
  const removed: string[] = [];
  let copyAttempts = 0;
  const runtime = runtimeWithDownload(
    processReturningDownload(
      {
        id: "arxiv",
        url: "https://arxiv.org/pdf/2101.00001.pdf",
        egressHosts: ["arxiv.org"],
      },
      `E:\\paper\\ScanSciCache\\${requestID}\\paper.pdf`,
    ),
    requestID,
    removed,
  );
  runtime.files.copyExclusiveContained = async () => {
    copyAttempts += 1;
    throw new Error("Destination already exists");
  };
  const port = createPythonScanSciPort(runtime, downloadOptions());
  await prepareReady(port);

  assert.deepEqual(await port.downloadOnePaper(downloadRequest()), {
    status: "failed",
    error: "Destination already exists",
  });
  assert.equal(copyAttempts, 1);
  assert.deepEqual(removed, [`E:\\paper\\ScanSciCache\\${requestID}`]);
});

test("a request-directory collision never deletes the pre-existing directory", async () => {
  const requestID = "66666666-6666-4666-8666-666666666666";
  const removed: string[] = [];
  const runtime = runtimeWithDownload(
    async (request) =>
      probeResult({
        executable: request.command,
        pythonVersion: "3.12.10",
        architecture: "x64",
      }),
    requestID,
    removed,
  );
  runtime.files.createDirectoryExclusive = async () => {
    throw new Error("request directory already exists");
  };
  const port = createPythonScanSciPort(runtime, downloadOptions());
  await prepareReady(port);

  assert.deepEqual(await port.downloadOnePaper(downloadRequest()), {
    status: "failed",
    error: "request directory already exists",
  });
  assert.deepEqual(removed, []);
});

test("a cleanup failure preserves the committed result and remains explicit", async () => {
  const requestID = "55555555-5555-4555-8555-555555555555";
  const runtime = runtimeWithDownload(
    processReturningDownload(
      {
        id: "arxiv",
        url: "https://arxiv.org/pdf/2101.00001.pdf",
        egressHosts: ["arxiv.org"],
      },
      `E:\\paper\\ScanSciCache\\${requestID}\\paper.pdf`,
    ),
    requestID,
  );
  runtime.files.removeDirectory = async () => {
    throw new Error("request directory is locked");
  };
  const port = createPythonScanSciPort(runtime, downloadOptions());
  await prepareReady(port);

  assert.deepEqual(await port.downloadOnePaper(downloadRequest()), {
    status: "downloaded",
    savedPath: "E:\\paper\\Audited arXiv paper.pdf",
    cleanupWarning:
      "ScanSci request cleanup failed: request directory is locked",
  });
});

function runtimeWith(
  runProcess: PythonScanSciRuntime["runProcess"],
  rules = "",
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
        if (!rules) throw new Error("not used by capability probe");
        return rules;
      },
      async copyExclusiveContained() {},
      async removeDirectory() {},
    },
    nextRequestID: () => "00000000-0000-4000-8000-000000000000",
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
    prohibitedSources: ["scihub", "libgen", "scibban", "tor", "vpnsci"],
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

function probeResult(input: {
  executable: string;
  pythonVersion: string;
  architecture: "x64" | "arm64" | "x86";
}): Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: false;
}> {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      schemaVersion: 3,
      sourceRulesVersion: 3,
      operation: "probe",
      ok: true,
      result: {
        ...input,
        moduleVersion: "3.0.0",
        dependencies: availableDependencies(),
        features: {
          onePaperDownload: "available",
          visibleLogin: "disabled",
        },
      },
    })}\n`,
    stderr: "",
    timedOut: false,
  };
}

function missingDependencyProbeResult(executable: string) {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      schemaVersion: 3,
      sourceRulesVersion: 3,
      operation: "probe",
      ok: true,
      result: {
        executable,
        pythonVersion: "3.12.10",
        architecture: "x64",
        moduleVersion: "3.0.0",
        dependencies: availableDependencies().map((dependency) =>
          dependency.name === "requests"
            ? { ...dependency, installedVersion: undefined, status: "missing" }
            : dependency,
        ),
        features: {
          onePaperDownload: "unavailable",
          visibleLogin: "disabled",
        },
      },
    })}\n`,
    stderr: "",
    timedOut: false as const,
  };
}

function availableDependencies() {
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

function runtimeWithDownload(
  runProcess: PythonScanSciRuntime["runProcess"],
  requestID: string,
  removed: string[] = [],
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
      async copyExclusiveContained() {},
      async removeDirectory(path) {
        removed.push(path);
      },
    },
    nextRequestID: () => requestID,
  };
}

function downloadOptions() {
  return {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    privateRuntimeRoot: "C:\\profile\\reference-for-zotero\\python",
    hostArchitecture: "x64" as const,
  };
}

async function prepareReady(
  port: ReturnType<typeof createPythonScanSciPort>,
): Promise<void> {
  const preparation = await port.prepareRuntime({
    allowInstall: false,
    executableOverride: "D:\\Python\\Python3.12\\python.exe",
  });
  assert.equal(preparation.status, "ready");
}

function downloadRequest() {
  return {
    paper: {
      title: "Audited arXiv paper",
      arxivID: "2101.00001",
      primaryResultURL: "https://arxiv.org/abs/2101.00001",
    },
    downloadDestination: "E:\\paper",
    canonicalFinalTarget: "E:\\paper\\Audited arXiv paper.pdf",
  };
}

function processReturningDownload(
  source: Readonly<{
    id: string;
    url: string;
    egressHosts: readonly string[];
  }>,
  outputPath: string,
): PythonScanSciRuntime["runProcess"] {
  return async (request) => {
    const input = JSON.parse(request.stdin) as { operation: string };
    if (input.operation === "probe") {
      return probeResult({
        executable: request.command,
        pythonVersion: "3.12.10",
        architecture: "x64",
      });
    }
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        schemaVersion: 3,
        sourceRulesVersion: 3,
        operation: "download-one",
        ok: true,
        result: { source, outputPath },
      })}\n`,
      stderr: "",
      timedOut: false,
    };
  };
}
