import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOWNLOAD_DESTINATION,
  DownloadSettingsCoordinator,
  type DownloadSettingsPorts,
} from "../../src/application/download-settings";
import type {
  ScanSciCapability,
  ScanSciPort,
} from "../../src/scansci/scan-sci-port";

test("download settings keep only the destination and automatically probed capability", async () => {
  const preferenceWrites: Array<readonly [string, string]> = [];
  let probes = 0;
  const runtime: ScanSciPort = {
    async probe() {
      probes += 1;
      return capability();
    },
    async startVisibleLogin() {
      throw new Error("Institution login remains unavailable");
    },
    async downloadPapers() {
      return [];
    },
  };
  const ports: DownloadSettingsPorts = {
    runtime,
    getPreference() {
      return undefined;
    },
    setPreference(key, value) {
      preferenceWrites.push([key, value]);
    },
    clearPreference() {},
    async chooseDownloadDestination() {
      return undefined;
    },
  };
  const settings = new DownloadSettingsCoordinator(ports);

  assert.deepEqual(settings.getState(), {
    downloadDestination: DEFAULT_DOWNLOAD_DESTINATION,
    usingDefaultDestination: true,
    runtime: { status: "unchecked" },
  });

  await settings.probeRuntime();

  assert.equal(probes, 1);
  assert.deepEqual(settings.getState().runtime, {
    status: "ready",
    capability: capability(),
  });
  assert.deepEqual(preferenceWrites, []);
});

function capability(): ScanSciCapability {
  return {
    status: "available",
    executable: "C:\\Python313\\python.exe",
    pythonVersion: "3.13.1",
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
  };
}
