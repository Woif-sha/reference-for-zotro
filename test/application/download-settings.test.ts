import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_DIRECTORY_REQUIRED_ERROR,
  DOWNLOAD_CACHE_DIRECTORY_PREFERENCE,
  DOWNLOAD_DESTINATION_PREFERENCE,
  DOWNLOAD_DESTINATION_REQUIRED_ERROR,
  DownloadSettingsCoordinator,
  type DownloadSettingsPorts,
} from "../../src/application/download-settings";
import type {
  ScanSciCapability,
  ScanSciPort,
} from "../../src/scansci/scan-sci-port";

test("download settings require explicit destination and Cache paths", async () => {
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
    async chooseDownloadDestination() {
      return undefined;
    },
    async chooseCacheDirectory() {
      return undefined;
    },
  };
  const settings = new DownloadSettingsCoordinator(ports);

  assert.deepEqual(settings.getState(), {
    destinationError: DOWNLOAD_DESTINATION_REQUIRED_ERROR,
    cacheDirectoryError: CACHE_DIRECTORY_REQUIRED_ERROR,
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
    async chooseDownloadDestination() {
      return undefined;
    },
    async chooseCacheDirectory() {
      return undefined;
    },
  });

  await settings.probeRuntime();

  assert.deepEqual(settings.getState().runtime, {
    status: "unavailable",
    error: "compatible ScanSci sidecar is missing",
  });
});

test("confirming destination and Cache paths persists both absolute paths", async () => {
  const writes: Array<readonly [string, string]> = [];
  const states: Array<readonly [string | undefined, string | undefined]> = [];
  const settings = new DownloadSettingsCoordinator({
    runtime: unusedRuntime(),
    getPreference() {
      return undefined;
    },
    setPreference(key, value) {
      writes.push([key, value]);
    },
    async chooseDownloadDestination(current) {
      assert.equal(current, undefined);
      return "D:/Research/Papers/";
    },
    async chooseCacheDirectory(current) {
      assert.equal(current, undefined);
      return "D:/Research/ScanSciCache/";
    },
  });
  settings.subscribe((state) =>
    states.push([state.downloadDestination, state.cacheDirectory]),
  );

  await settings.changeDownloadDestination();
  await settings.changeCacheDirectory();

  assert.deepEqual(writes, [
    [DOWNLOAD_DESTINATION_PREFERENCE, "D:\\Research\\Papers"],
    [DOWNLOAD_CACHE_DIRECTORY_PREFERENCE, "D:\\Research\\ScanSciCache"],
  ]);
  assert.equal(settings.getState().downloadDestination, "D:\\Research\\Papers");
  assert.equal(
    settings.getState().cacheDirectory,
    "D:\\Research\\ScanSciCache",
  );
  assert.deepEqual(states, [
    ["D:\\Research\\Papers", undefined],
    ["D:\\Research\\Papers", "D:\\Research\\ScanSciCache"],
  ]);
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
    async chooseDownloadDestination(current) {
      assert.equal(current, "C:\\Saved\\Papers");
      return undefined;
    },
    async chooseCacheDirectory() {
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
