import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DOWNLOAD_DESTINATION,
  DOWNLOAD_DESTINATION_PREFERENCE,
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

test("a failed automatic probe becomes an explicit unavailable state", async () => {
  const settings = new DownloadSettingsCoordinator({
    runtime: {
      async probe() {
        throw new Error("compatible ScanSci sidecar is missing");
      },
      async startVisibleLogin() {
        throw new Error("Institution login remains unavailable");
      },
      async downloadPapers() {
        return [];
      },
    },
    getPreference() {
      return undefined;
    },
    setPreference() {},
    clearPreference() {},
    async chooseDownloadDestination() {
      return undefined;
    },
  });

  await settings.probeRuntime();

  assert.deepEqual(settings.getState().runtime, {
    status: "unavailable",
    error: "compatible ScanSci sidecar is missing",
  });
});

test("confirming a destination persists the absolute path and publishes it immediately", async () => {
  const writes: Array<readonly [string, string]> = [];
  const states: string[] = [];
  const settings = new DownloadSettingsCoordinator({
    runtime: unusedRuntime(),
    getPreference() {
      return undefined;
    },
    setPreference(key, value) {
      writes.push([key, value]);
    },
    clearPreference() {},
    async chooseDownloadDestination(current) {
      assert.equal(current, DEFAULT_DOWNLOAD_DESTINATION);
      return "D:/Research/Papers/";
    },
  });
  settings.subscribe((state) => states.push(state.downloadDestination));

  await settings.changeDownloadDestination();

  assert.deepEqual(writes, [
    [DOWNLOAD_DESTINATION_PREFERENCE, "D:\\Research\\Papers"],
  ]);
  assert.equal(settings.getState().downloadDestination, "D:\\Research\\Papers");
  assert.deepEqual(states, ["D:\\Research\\Papers"]);
});

test("cancelling destination selection leaves the path and preference unchanged", async () => {
  let writes = 0;
  let notifications = 0;
  const settings = new DownloadSettingsCoordinator({
    runtime: unusedRuntime(),
    getPreference() {
      return "C:\\Saved\\Papers";
    },
    setPreference() {
      writes += 1;
    },
    clearPreference() {},
    async chooseDownloadDestination(current) {
      assert.equal(current, "C:\\Saved\\Papers");
      return undefined;
    },
  });
  settings.subscribe(() => {
    notifications += 1;
  });

  await settings.changeDownloadDestination();

  assert.equal(settings.getState().downloadDestination, "C:\\Saved\\Papers");
  assert.equal(writes, 0);
  assert.equal(notifications, 0);
});

function unusedRuntime(): ScanSciPort {
  return {
    async probe() {
      throw new Error("not used");
    },
    async startVisibleLogin() {
      throw new Error("not used");
    },
    async downloadPapers() {
      throw new Error("not used");
    },
  };
}

function capability(): ScanSciCapability {
  return {
    status: "available",
    executable: "C:\\Python313\\python.exe",
    pythonVersion: "3.13.1",
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
  };
}
