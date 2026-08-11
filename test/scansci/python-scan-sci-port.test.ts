import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SCANSCI_SCHEMA_VERSION,
  SCANSCI_SOURCE_RULES_VERSION,
} from "../../src/scansci/scan-sci-port";
import {
  createPythonScanSciPort,
  type PythonScanSciRuntime,
} from "../../src/scansci/python-scan-sci-port";

const REQUIREMENTS_LOCK = await readFile(
  new URL(
    "../../addon/python/reference_for_zotero_scansci/requirements.lock",
    import.meta.url,
  ),
  "utf8",
);

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
  assert.equal(probeCall.stdin, "");
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

test("installation candidate selection prefers dependency completeness before Python version", async () => {
  const runtime = runtimeWith(async (request) => {
    if (request.command === "py") {
      return {
        exitCode: 0,
        stdout:
          " -V:3.13 *        C:\\Python313\\python.exe\r\n" +
          " -V:3.12          D:\\Python312\\python.exe\r\n",
        stderr: "",
        timedOut: false,
      };
    }
    if (request.command === "python") {
      return { exitCode: 1, stdout: "", stderr: "missing", timedOut: false };
    }
    const missing =
      request.command === "C:\\Python313\\python.exe"
        ? new Set(["requests", "certifi"])
        : new Set(["requests"]);
    return probeResultWithDependencies({
      executable: request.command,
      pythonVersion:
        request.command === "C:\\Python313\\python.exe" ? "3.13.1" : "3.12.10",
      missing,
    });
  });
  const port = createPythonScanSciPort(runtime, downloadOptions());

  const preparation = await port.prepareRuntime({ allowInstall: false });
  assert.equal(preparation.status, "needs-install");
  if (preparation.status !== "needs-install") return;
  assert.equal(preparation.plan.baseExecutable, "D:\\Python312\\python.exe");
});

test("equally compatible Python candidates use a normalized absolute path tie-break", async () => {
  const runtime = runtimeWith(async (request) => {
    if (request.command === "py") {
      return {
        exitCode: 0,
        stdout:
          " -V:3.12 *        D:/Zulu/./python.exe\r\n" +
          " -V:3.12          C:\\Alpha\\python.exe\r\n",
        stderr: "",
        timedOut: false,
      };
    }
    if (request.command === "python") {
      return { exitCode: 1, stdout: "", stderr: "missing", timedOut: false };
    }
    return probeResult({
      executable: request.command,
      pythonVersion: "3.12.10",
      architecture: "x64",
    });
  });
  const port = createPythonScanSciPort(runtime, downloadOptions());

  const preparation = await port.prepareRuntime({ allowInstall: false });
  assert.equal(preparation.status, "ready");
  if (preparation.status !== "ready") return;
  assert.equal(preparation.capability.executable, "C:\\Alpha\\python.exe");
});

test("launcher enumeration failure remains visible while PATH probing continues", async () => {
  const runtime = runtimeWith(async (request) =>
    request.command === "py"
      ? {
          exitCode: 2,
          stdout: "",
          stderr: "launcher registry is unavailable",
          timedOut: false,
        }
      : {
          exitCode: 1,
          stdout: "",
          stderr: "python is not on PATH",
          timedOut: false,
        },
  );
  const port = createPythonScanSciPort(runtime, downloadOptions());

  const preparation = await port.prepareRuntime({ allowInstall: false });

  assert.equal(preparation.status, "unavailable");
  if (preparation.status !== "unavailable") return;
  assert.deepEqual(
    preparation.candidates.map(({ executable }) => executable),
    ["py launcher", "python"],
  );
  assert.match(
    preparation.candidates[0]?.error ?? "",
    /exit code 2: launcher registry is unavailable/u,
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
    result.plan.packages.map((pkg) => [
      pkg.name,
      pkg.version,
      pkg.sha256.length,
    ]),
    [
      ["requests", "2.34.2", 1],
      ["certifi", "2026.7.22", 1],
      ["charset-normalizer", "3.4.9", 11],
      ["idna", "3.18", 1],
      ["urllib3", "2.7.0", 1],
    ],
  );
  assert.ok(
    result.plan.packages.every((pkg) =>
      pkg.sha256.every((hash) => /^[0-9a-f]{64}$/u.test(hash)),
    ),
  );
  assert.deepEqual(result.plan.packages, packagesFromLock(REQUIREMENTS_LOCK));
  assert.match(result.plan.actions.join(" "), /private virtual environment/u);
  assert.match(result.plan.cancelResult, /No environment is created/u);
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
      if (request.arguments.at(-1)?.endsWith("sidecar.py")) {
        return sidecarProbeResult(request, {
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
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
      return missingDependencyProbeResult(
        request.command === "python"
          ? "D:\\Python\\Python3.12\\python.exe"
          : request.command,
      );
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
      async readText(path) {
        return runtimeAsset(path);
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
  assert.equal(calls[0]?.command, "D:\\Python\\Python3.12\\python.exe");
  assert.ok(
    calls.every((call) => call.command !== "py" && call.command !== "python"),
  );
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

test("installation stops before creating a venv when the packaged lock differs from the confirmed plan", async () => {
  const created: string[] = [];
  const calls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const runtime: PythonScanSciRuntime = {
    async ensureModuleAssets() {},
    async runProcess(request) {
      calls.push(request);
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
      async readText(path) {
        return path.endsWith("requirements.lock")
          ? REQUIREMENTS_LOCK.replace("requests==2.34.2", "requests==2.34.1")
          : sourceRules();
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

  assert.equal(result.status, "unavailable");
  if (result.status !== "unavailable") return;
  assert.match(result.error, /does not match the confirmed installation plan/u);
  assert.deepEqual(created, []);
  assert.equal(calls.length, 1);
});

test("a stale private venv is removed only after renewed installation confirmation", async () => {
  const privateEnvironment = "C:\\profile\\reference-for-zotero\\python\\venv";
  const privatePython = `${privateEnvironment}\\Scripts\\python.exe`;
  const removed: string[] = [];
  const created: string[] = [];
  const calls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  let privateReady = false;
  const runtime: PythonScanSciRuntime = {
    async ensureModuleAssets() {},
    async runProcess(request) {
      calls.push(request);
      if (request.arguments.at(-1)?.endsWith("sidecar.py")) {
        return sidecarProbeResult(request, {
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      if (request.arguments.includes("venv")) {
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
      if (request.arguments.includes("pip")) {
        privateReady = true;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
      if (request.command === privatePython) {
        return privateReady
          ? probeResult({
              executable: privatePython,
              pythonVersion: "3.12.10",
              architecture: "x64",
            })
          : {
              exitCode: 1,
              stdout: "",
              stderr: "incomplete venv",
              timedOut: false,
            };
      }
      return missingDependencyProbeResult(
        request.command === "python"
          ? "D:\\Python\\Python3.12\\python.exe"
          : request.command,
      );
    },
    files: {
      async pathExists(path) {
        return path === privateEnvironment || path === privatePython;
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
      async readText(path) {
        return runtimeAsset(path);
      },
      async copyExclusiveContained() {},
      async removeDirectory(path) {
        removed.push(path);
      },
    },
    nextRequestID: () => "00000000-0000-4000-8000-000000000000",
  };
  const port = createPythonScanSciPort(runtime, downloadOptions());

  const plan = await port.prepareRuntime({ allowInstall: false });
  assert.equal(plan.status, "needs-install");
  assert.equal(removed.length, 0);
  assert.equal(created.length, 0);

  const installed = await port.prepareRuntime({ allowInstall: true });
  assert.equal(installed.status, "ready");
  assert.deepEqual(removed, [privateEnvironment]);
  assert.ok(created.includes(privateEnvironment));
});

test("a mirror failure reports the selected interpreter, venv, mirror, and original pip error without fallback", async () => {
  const calls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const runtime: PythonScanSciRuntime = {
    async ensureModuleAssets() {},
    async runProcess(request) {
      calls.push(request);
      if (request.arguments.includes("venv")) {
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
      if (request.arguments.includes("pip")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "TUNA mirror refused the wheel",
          timedOut: false,
        };
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
      async createDirectory() {},
      async createDirectoryExclusive() {},
      async readText(path) {
        return runtimeAsset(path);
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
  assert.equal(result.status, "unavailable");
  if (result.status !== "unavailable") return;
  assert.match(
    result.error,
    /interpreter=D:\\Python\\Python3\.12\\python\.exe/u,
  );
  assert.match(result.error, /privateEnvironment=.*\\venv/u);
  assert.match(
    result.error,
    /packageIndex=https:\/\/pypi\.tuna\.tsinghua\.edu\.cn\/simple/u,
  );
  assert.match(result.error, /TUNA mirror refused the wheel/u);
  assert.equal(
    calls.filter((call) => call.arguments.includes("pip")).length,
    1,
  );
  assert.ok(
    calls.every(
      (call) =>
        !call.arguments.some((argument) =>
          /pypi\.org|trusted-host/iu.test(argument),
        ),
    ),
  );
});

test("visible login stays disabled until an institution route is audited and enabled", async () => {
  let processCalls = 0;
  const runtime = runtimeWith(async () => {
    processCalls += 1;
    return probeResult({
      executable: "D:\\Python\\Python3.12\\python.exe",
      pythonVersion: "3.12.10",
      architecture: "x64",
    });
  }, sourceRules());
  const port = createPythonScanSciPort(runtime, {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    privateRuntimeRoot: "C:\\profile\\reference-for-zotero\\python",
    hostArchitecture: "x64",
  });

  assert.deepEqual(
    await port.startVisibleLogin({
      userInitiated: true,
      routeID: "institution-webvpn/ieee/one-click-single",
    }),
    {
      status: "failed",
      error:
        "route-candidate: The institution route remains a candidate until its real-world audit passes.",
    },
  );
  assert.ok(processCalls >= 1);
});

test("one-paper download creates a missing destination, isolates Python output, and exclusively commits the canonical target", async () => {
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
      if (request.arguments.includes("-c")) {
        return probeResult({
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      const input = JSON.parse(request.stdin || "{}") as {
        requestId: string;
        operation?: string;
      };
      if (input.operation === "probe") {
        return sidecarProbeResult(request, {
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      assert.equal(input.operation, "downloadOne");
      return sidecarComplete(
        { requestId: input.requestId, operation: input.operation },
        {
          result: {
            schemaVersion: "1.0.0",
            status: "downloaded",
            identifier: "2101.00001",
            sourceEvidence: {
              routeId: "open-access",
              source: "arxiv",
              sourceUrl: "https://arxiv.org/pdf/2101.00001.pdf",
              egressHosts: ["arxiv.org"],
              legal: true,
            },
            relativePath: "2101.00001.pdf",
            error: null,
          },
        },
      );
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
    await downloadOne(port, {
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
  assert.deepEqual(created, [
    "E:\\paper",
    "E:\\paper\\ScanSciCache",
    requestDirectory,
  ]);
  assert.deepEqual(copied, [
    [sourcePath, "E:\\paper\\Audited arXiv paper.pdf"],
  ]);
  assert.deepEqual(removed, [requestDirectory]);

  const downloadCall = processCalls.find((call) =>
    call.stdin.includes('"operation":"downloadOne"'),
  );
  assert.ok(downloadCall);
  assert.equal(downloadCall.workingDirectory, requestDirectory);
  assert.deepEqual(JSON.parse(downloadCall.stdin), {
    protocol: "reference-for-zotero.scansci-sidecar",
    contractVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    requestId: requestID,
    operation: "downloadOne",
    params: {
      paper: {
        title: "Audited arXiv paper",
        arxivID: "2101.00001",
      },
      outputDir: requestDirectory,
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

test("multi-paper download invokes one sidecar batch and consumes per-paper progress", async () => {
  const requestID = "7d62f649-5ed2-47d3-b8bf-50e8c50857be";
  const requestDirectory = `E:\\paper\\ScanSciCache\\${requestID}`;
  const processCalls: Parameters<PythonScanSciRuntime["runProcess"]>[0][] = [];
  const copied: Array<readonly [string, string]> = [];
  const removed: string[] = [];
  const runtime = runtimeWithDownload(
    async (request) => {
      processCalls.push(request);
      const input = JSON.parse(request.stdin) as {
        requestId: string;
        operation: string;
      };
      assert.equal(input.operation, "downloadBatch");
      const downloaded = sidecarDownloadedResult(
        "2101.00001",
        "arxiv_2101.00001.pdf",
      );
      const failed = {
        schemaVersion: "1.0.0",
        status: "failed",
        identifier: "PMC9999",
        sourceEvidence: null,
        relativePath: null,
        error: { code: "no-pdf", message: "No audited PDF was found" },
      };
      const messages = [
        sidecarProgress(input, 1, 2, "item-1", downloaded),
        sidecarProgress(input, 2, 2, "item-2", failed),
        sidecarCompletionMessage(input, {
          total: 2,
          downloaded: 1,
          failed: 1,
          results: [
            { itemId: "item-1", result: downloaded },
            { itemId: "item-2", result: failed },
          ],
        }),
      ];
      for (const message of messages) {
        await request.onStdoutLine?.(JSON.stringify(message));
      }
      return {
        exitCode: 0,
        stdout: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`,
        stderr: "",
        timedOut: false,
      };
    },
    requestID,
    removed,
  );
  runtime.files.copyExclusiveContained = async (source, _root, target) => {
    copied.push([source, target]);
  };
  const port = createPythonScanSciPort(runtime, downloadOptions());
  await prepareReady(port);
  const progress: unknown[] = [];

  const result = await port.downloadPapers({
    items: [
      {
        itemID: "arxiv-paper",
        paper: { title: "arXiv paper", arxivID: "2101.00001" },
        canonicalFinalTarget: "E:\\paper\\arXiv paper.pdf",
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

  assert.equal(
    processCalls.filter((call) =>
      call.stdin.includes('"operation":"downloadBatch"'),
    ).length,
    1,
  );
  assert.deepEqual(result, [
    {
      itemID: "arxiv-paper",
      result: {
        status: "downloaded",
        savedPath: "E:\\paper\\arXiv paper.pdf",
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
  assert.deepEqual(copied, [
    [`${requestDirectory}\\arxiv_2101.00001.pdf`, "E:\\paper\\arXiv paper.pdf"],
  ]);
  assert.deepEqual(removed, [requestDirectory]);
});

test("an ordinary Python download failure is returned and its request directory is cleaned", async () => {
  const requestID = "ddf2670d-b7a0-423d-98b1-e54e148b87ee";
  const removed: string[] = [];
  const runtime = runtimeWithDownload(
    async (request) => {
      const input = JSON.parse(request.stdin) as {
        requestId: string;
        operation: string;
      };
      return sidecarComplete(input, undefined, {
        code: "network",
        message: "Publisher returned 403",
        retryable: false,
      });
    },
    requestID,
    removed,
  );
  const port = createPythonScanSciPort(runtime, downloadOptions());
  await prepareReady(port);

  assert.deepEqual(await downloadOne(port, downloadRequest()), {
    status: "failed",
    error: "network: Publisher returned 403",
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

  const result = await downloadOne(port, downloadRequest());

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

    assert.deepEqual(await downloadOne(port, downloadRequest()), {
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
    await downloadOne(outsideTargetPort, {
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
    await downloadOne(outsideTargetPort, {
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
  assert.deepEqual(await downloadOne(outsideOutputPort, downloadRequest()), {
    status: "failed",
    error: "ScanSci sidecar returned an invalid relative output path",
  });
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

  assert.deepEqual(await downloadOne(port, downloadRequest()), {
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

  assert.deepEqual(await downloadOne(port, downloadRequest()), {
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

  assert.deepEqual(await downloadOne(port, downloadRequest()), {
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
  const identities = new Map<
    string,
    Readonly<{
      executable: string;
      pythonVersion: string;
      architecture: string;
    }>
  >();
  return {
    async ensureModuleAssets() {},
    async runProcess(request) {
      if (request.arguments.at(-1)?.endsWith("sidecar.py")) {
        const protocol = JSON.parse(request.stdin) as {
          requestId: string;
          operation: string;
        };
        if (protocol.operation === "visibleLogin") {
          return sidecarComplete(protocol, undefined, {
            code: "route-candidate",
            message:
              "The institution route remains a candidate until its real-world audit passes.",
            retryable: false,
          });
        }
        return sidecarProbeResult(request, identities.get(request.command));
      }
      const result = await runProcess(request);
      if (request.arguments.includes("-c") && result.exitCode === 0) {
        const identity = JSON.parse(result.stdout) as {
          executable: string;
          pythonVersion: string;
          architecture: string;
        };
        identities.set(request.command, identity);
        identities.set(identity.executable, identity);
      }
      return result;
    },
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
      ...input,
      moduleVersion: "3.0.0",
      dependencies: availableDependencies(),
      dependencySetAvailable: true,
    })}\n`,
    stderr: "",
    timedOut: false,
  };
}

function sidecarProbeResult(
  request: Parameters<PythonScanSciRuntime["runProcess"]>[0],
  identity:
    | Readonly<{
        executable: string;
        pythonVersion: string;
        architecture: string;
      }>
    | undefined,
) {
  const protocol = JSON.parse(request.stdin) as {
    requestId: string;
    operation: string;
  };
  const runtime = identity ?? {
    executable: request.command,
    pythonVersion: "3.12.10",
    architecture: "x64",
  };
  return sidecarComplete(protocol, {
    application: { name: "reference-for-zotero-scansci", version: "3.0.0" },
    runtime: {
      implementation: "CPython",
      ...runtime,
      platform: "Windows",
    },
    source: {
      repository: "Rimagination/scansci-pdf",
      revision: "5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5",
      installKind: "audited-plugin-fragments",
      dirty: false,
    },
    contractVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    operations: ["downloadBatch", "downloadOne", "probe", "visibleLogin"],
    routeCapabilities: [
      {
        routeId: "open-access",
        available: true,
        sources: ["arxiv", "pmc"],
        operations: ["downloadOne", "downloadBatch"],
        concurrency: "bounded",
      },
      {
        routeId: "institution-webvpn/ieee/one-click-single",
        status: "candidate",
        available: false,
        operations: ["visibleLogin", "downloadOne"],
        concurrency: "single-profile-writer",
        profileId: "zotero",
        reason: "real-world-route-audit-pending",
      },
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
  });
}

function sidecarComplete(
  request: Readonly<{ requestId: string; operation: string }>,
  payload?: unknown,
  error?: Readonly<{ code: string; message: string; retryable: boolean }>,
) {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      protocol: "reference-for-zotero.scansci-sidecar",
      contractVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      requestId: request.requestId,
      operation: request.operation,
      type: "complete",
      ok: !error,
      ...(error ? { error } : { payload }),
    })}\n`,
    stderr: "",
    timedOut: false as const,
  };
}

function sidecarCompletionMessage(
  request: Readonly<{ requestId: string; operation: string }>,
  payload: unknown,
) {
  return {
    protocol: "reference-for-zotero.scansci-sidecar",
    contractVersion: "1.0.0",
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
    contractVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    requestId: request.requestId,
    operation: request.operation,
    type: "progress",
    payload: { sequence, completed: sequence, total, itemId, result },
  };
}

function sidecarDownloadedResult(identifier: string, relativePath: string) {
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

function missingDependencyProbeResult(executable: string) {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      executable,
      pythonVersion: "3.12.10",
      architecture: "x64",
      moduleVersion: "3.0.0",
      dependencies: availableDependencies().map((dependency) =>
        dependency.name === "requests"
          ? { ...dependency, installedVersion: undefined, status: "missing" }
          : dependency,
      ),
      dependencySetAvailable: false,
    })}\n`,
    stderr: "",
    timedOut: false as const,
  };
}

function probeResultWithDependencies(input: {
  executable: string;
  pythonVersion: string;
  missing: ReadonlySet<string>;
}) {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      executable: input.executable,
      pythonVersion: input.pythonVersion,
      architecture: "x64",
      moduleVersion: "3.0.0",
      dependencies: availableDependencies().map((dependency) =>
        input.missing.has(dependency.name)
          ? { ...dependency, installedVersion: undefined, status: "missing" }
          : dependency,
      ),
      dependencySetAvailable: false,
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
    async runProcess(request) {
      if (request.arguments.includes("-c")) {
        return probeResult({
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      const input = JSON.parse(request.stdin) as { operation: string };
      if (input.operation === "probe") {
        return sidecarProbeResult(request, {
          executable: request.command,
          pythonVersion: "3.12.10",
          architecture: "x64",
        });
      }
      return runProcess(request);
    },
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

function runtimeAsset(path: string): string {
  return path.endsWith("requirements.lock") ? REQUIREMENTS_LOCK : sourceRules();
}

function packagesFromLock(lock: string) {
  return lock
    .replace(/\\\r?\n\s*/gu, " ")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const requirement = /^([A-Za-z0-9_.-]+)==([^\s]+)(.*)$/u.exec(line);
      assert.ok(requirement);
      return {
        name: requirement[1] ?? "",
        version: requirement[2] ?? "",
        sha256: [
          ...(requirement[3] ?? "").matchAll(/sha256:([0-9a-f]{64})/gu),
        ].map((match) => match[1] ?? ""),
      };
    });
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

async function downloadOne(
  port: ReturnType<typeof createPythonScanSciPort>,
  request: ReturnType<typeof downloadRequest>,
) {
  const [outcome] = await port.downloadPapers({
    items: [
      {
        itemID: "paper-1",
        paper: request.paper,
        canonicalFinalTarget: request.canonicalFinalTarget,
      },
    ],
    downloadDestination: request.downloadDestination,
  });
  assert.ok(outcome);
  return outcome.result;
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
    const input = JSON.parse(request.stdin) as {
      requestId: string;
      operation: string;
      params: { outputDir: string };
    };
    const prefix = `${input.params.outputDir.replace(/[\\/]+$/u, "")}\\`;
    const relativePath = outputPath.startsWith(prefix)
      ? outputPath.slice(prefix.length)
      : "..\\..\\untrusted-cache.pdf";
    return sidecarComplete(input, {
      result: {
        schemaVersion: "1.0.0",
        status: "downloaded",
        identifier: "2101.00001",
        sourceEvidence: {
          routeId: "open-access",
          source: source.id,
          sourceUrl: source.url,
          egressHosts: source.egressHosts,
          legal: true,
        },
        relativePath,
        error: null,
      },
    });
  };
}
