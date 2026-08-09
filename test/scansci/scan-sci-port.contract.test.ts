import assert from "node:assert/strict";
import test from "node:test";
import type {
  OnePaperDownloadRequest,
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

  assert.deepEqual(await port.downloadOnePaper(downloadRequest()), {
    status: "downloaded",
    savedPath: "E:\\paper\\Contract paper.pdf",
  });
}

class FakeScanSciPort implements ScanSciPort {
  async prepareRuntime() {
    return { status: "ready" as const, capability: availableCapability() };
  }

  async startVisibleLogin(): Promise<VisibleLoginResult> {
    return {
      status: "failed",
      error:
        "Institution browser route is disabled pending strict-TLS, source, egress, Windows, and Zotero acceptance",
    };
  }

  async downloadOnePaper() {
    return {
      status: "downloaded" as const,
      savedPath: "E:\\paper\\Contract paper.pdf",
    };
  }
}

function createProductionAdapterAtSystemBoundaries(): ScanSciPort {
  const requestID = "288837e4-303e-4c72-bda5-ea1c58096f24";
  const outputPath = `E:\\paper\\ScanSciCache\\${requestID}\\arxiv_2101.00001.pdf`;
  const runtime: PythonScanSciRuntime = {
    async ensureModuleAssets() {},
    async runProcess(request) {
      const input = JSON.parse(request.stdin) as { operation: string };
      if (input.operation === "probe")
        return probeProcessResult(request.command);
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
            outputPath,
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
      visibleLogin: "disabled",
    },
  };
}

function probeProcessResult(executable: string) {
  const capability = availableCapability();
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      schemaVersion: 3,
      sourceRulesVersion: 3,
      operation: "probe",
      ok: true,
      result: {
        executable,
        pythonVersion: capability.pythonVersion,
        architecture: capability.architecture,
        moduleVersion: capability.moduleVersion,
        dependencies: capability.dependencies,
        features: capability.features,
      },
    })}\n`,
    stderr: "",
    timedOut: false,
  };
}

function downloadRequest(): OnePaperDownloadRequest {
  return {
    paper: {
      title: "Contract paper",
      arxivID: "2101.00001",
    },
    downloadDestination: "E:\\paper",
    canonicalFinalTarget: "E:\\paper\\Contract paper.pdf",
  };
}
