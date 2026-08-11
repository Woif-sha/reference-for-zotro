import assert from "node:assert/strict";
import test from "node:test";
import type {
  PaperDownloadRequest,
  ScanSciCapability,
  ScanSciPort,
  VisibleLoginResult,
} from "../../src/scansci/scan-sci-port";
import {
  createPythonScanSciPort,
  type PythonScanSciRuntime,
} from "../../src/scansci/python-scan-sci-port";

for (const adapter of [
  {
    name: "test fake adapter",
    create: (): ScanSciPort => new FakeScanSciPort(),
  },
  {
    name: "production Python adapter",
    create: createProductionAdapterAtSystemBoundaries,
  },
]) {
  test(`${adapter.name} satisfies the ScanSciPort v3 contract`, async () => {
    await assertScanSciPortContract(adapter.create());
  });
}

async function assertScanSciPortContract(port: ScanSciPort): Promise<void> {
  const preparation = await port.prepareRuntime({
    allowInstall: false,
    executableOverride: "D:\\Python\\Python3.12\\python.exe",
  });
  assert.equal(preparation.status, "ready");
  if (preparation.status !== "ready") return;
  const capability = preparation.capability;
  assert.equal(capability.schemaVersion, 3);
  assert.equal(capability.sourceRulesVersion, 3);
  assert.equal(capability.features.onePaperDownload, "available");
  assert.equal(capability.features.batchDownload, "available");
  assert.equal(capability.sidecar.contractVersion, "1.0.0");

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

  assert.deepEqual(await port.downloadPapers(downloadRequest()), [
    {
      itemID: "contract-paper",
      result: {
        status: "downloaded",
        savedPath: "E:\\paper\\Contract paper.pdf",
      },
    },
  ]);
}

class FakeScanSciPort implements ScanSciPort {
  async prepareRuntime() {
    return { status: "ready" as const, capability: availableCapability() };
  }

  async startVisibleLogin(): Promise<VisibleLoginResult> {
    return {
      status: "failed",
      error:
        "route-candidate: The institution route remains a candidate until its real-world audit passes.",
    };
  }

  async downloadPapers(request: PaperDownloadRequest) {
    return request.items.map(({ itemID, canonicalFinalTarget }) => ({
      itemID,
      result: {
        status: "downloaded" as const,
        savedPath: canonicalFinalTarget,
      },
    }));
  }
}

function createProductionAdapterAtSystemBoundaries(): ScanSciPort {
  const requestID = "288837e4-303e-4c72-bda5-ea1c58096f24";
  const runtime: PythonScanSciRuntime = {
    async ensureModuleAssets() {},
    async runProcess(request) {
      if (request.arguments.includes("-c")) {
        return runtimeInspectionResult(request.command);
      }
      const input = JSON.parse(request.stdin) as {
        requestId: string;
        operation: string;
      };
      if (input.operation === "probe")
        return sidecarProbeResult(input, request.command);
      if (input.operation === "visibleLogin") {
        return sidecarComplete(input, undefined, {
          code: "route-candidate",
          message:
            "The institution route remains a candidate until its real-world audit passes.",
          retryable: false,
        });
      }
      return sidecarComplete(input, {
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
          relativePath: "arxiv_2101.00001.pdf",
          error: null,
        },
      });
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
      },
      async copyExclusiveContained() {},
      async removeDirectory() {},
    },
    nextRequestID: () => requestID,
  };
  return createPythonScanSciPort(runtime, {
    moduleRoot: "C:\\addon\\python\\reference_for_zotero_scansci",
    privateRuntimeRoot: "C:\\profile\\reference-for-zotero\\python",
    hostArchitecture: "x64",
  });
}

function availableCapability(): ScanSciCapability {
  return {
    status: "available",
    executable: "D:\\Python\\Python3.12\\python.exe",
    pythonVersion: "3.12.10",
    architecture: "x64",
    moduleVersion: "3.0.0",
    schemaVersion: 3,
    sourceRulesVersion: 3,
    selectionReason: "configured override",
    dependencies: [
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
    })),
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
      contractVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      upstreamRevision: "5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5",
      dirty: false,
    },
  };
}

function runtimeInspectionResult(executable: string) {
  const capability = availableCapability();
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      executable,
      pythonVersion: capability.pythonVersion,
      architecture: capability.architecture,
      moduleVersion: capability.moduleVersion,
      dependencies: capability.dependencies,
      dependencySetAvailable: true,
    })}\n`,
    stderr: "",
    timedOut: false,
  };
}

function sidecarProbeResult(
  request: Readonly<{ requestId: string; operation: string }>,
  executable: string,
) {
  return sidecarComplete(request, {
    application: { name: "reference-for-zotero-scansci", version: "3.0.0" },
    runtime: {
      implementation: "CPython",
      pythonVersion: "3.12.10",
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
    contractVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    operations: ["downloadBatch", "downloadOne", "probe", "visibleLogin"],
    routeCapabilities: [
      {
        routeId: "open-access",
        available: true,
        sources: ["arxiv", "pmc"],
        operations: ["downloadOne", "downloadBatch"],
      },
      {
        routeId: "institution-webvpn/ieee/one-click-single",
        status: "candidate",
        available: false,
        operations: ["visibleLogin", "downloadOne"],
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

function downloadRequest(): PaperDownloadRequest {
  return {
    items: [
      {
        itemID: "contract-paper",
        paper: {
          title: "Contract paper",
          arxivID: "2101.00001",
        },
        canonicalFinalTarget: "E:\\paper\\Contract paper.pdf",
      },
    ],
    downloadDestination: "E:\\paper",
  };
}
