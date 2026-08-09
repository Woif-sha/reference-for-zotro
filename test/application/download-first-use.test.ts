import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DOWNLOAD_DESTINATION,
  DOWNLOAD_DESTINATION_PREFERENCE,
  DownloadFirstUseCoordinator,
  PYTHON_EXECUTABLE_PREFERENCE,
  PYTHON_VERSION_PREFERENCE,
  RUNTIME_MODULE_VERSION_PREFERENCE,
  type DownloadFirstUsePorts,
} from "../../src/application/download-first-use";
import type {
  ScanSciInstallPlan,
  ScanSciPort,
  ScanSciRuntimePreparation,
} from "../../src/scansci/scan-sci-port";

test("first use defaults to E:\\paper and persists only the selected folder and runtime identity", async () => {
  const writes: Array<readonly [string, string]> = [];
  const cleared: string[] = [];
  const preferences = new Map<string, string>();
  const preparations: ScanSciRuntimePreparation[] = [readyPreparation()];
  const calls: Array<
    Readonly<{ allowInstall: boolean; executableOverride?: string }>
  > = [];
  const coordinator = new DownloadFirstUseCoordinator(
    portsWith({
      preferences,
      writes,
      cleared,
      preparations,
      calls,
      destination: "D:/Research/Papers/",
    }),
  );

  assert.equal(
    coordinator.getState().downloadDestination,
    DEFAULT_DOWNLOAD_DESTINATION,
  );
  await coordinator.changeDownloadDestination();
  assert.equal(
    coordinator.getState().downloadDestination,
    "D:\\Research\\Papers",
  );
  await coordinator.checkRuntime();

  assert.deepEqual(calls, [{ allowInstall: false }]);
  assert.equal(coordinator.getState().runtime.status, "ready");
  assert.deepEqual(writes, [
    [DOWNLOAD_DESTINATION_PREFERENCE, "D:\\Research\\Papers"],
    [PYTHON_EXECUTABLE_PREFERENCE, "C:\\Python313\\python.exe"],
    [PYTHON_VERSION_PREFERENCE, "3.13.1"],
    [RUNTIME_MODULE_VERSION_PREFERENCE, "3.0.0"],
  ]);
  assert.ok(
    writes.every(
      ([key, value]) =>
        !/password|passcode|cookie|token|profile/iu.test(`${key} ${value}`),
    ),
  );

  coordinator.resetDownloadDestination();
  assert.equal(
    coordinator.getState().downloadDestination,
    DEFAULT_DOWNLOAD_DESTINATION,
  );
  assert.deepEqual(cleared, [DOWNLOAD_DESTINATION_PREFERENCE]);
});

test("runtime installation requires confirmation, cancellation writes nothing, and failure remains retryable", async () => {
  const writes: Array<readonly [string, string]> = [];
  const calls: Array<
    Readonly<{ allowInstall: boolean; executableOverride?: string }>
  > = [];
  const plan = installPlan();
  const preparations: ScanSciRuntimePreparation[] = [
    {
      status: "needs-install",
      plan,
      candidates: [],
    },
  ];
  const coordinator = new DownloadFirstUseCoordinator(
    portsWith({ preparations, calls, writes }),
  );

  await coordinator.checkRuntime();
  assert.equal(coordinator.getState().runtime.status, "needs-install");
  assert.equal(calls.length, 1);
  coordinator.cancelRuntimeInstallation();
  assert.equal(coordinator.getState().runtime.status, "unavailable");
  assert.equal(calls.length, 1);
  assert.deepEqual(writes, []);

  preparations.push(
    { status: "needs-install", plan, candidates: [] },
    {
      status: "unavailable",
      error:
        "ScanSci private environment installation failed; interpreter=C:\\Python312\\python.exe; privateEnvironment=C:\\profile\\rfz\\venv; packageIndex=https://pypi.tuna.tsinghua.edu.cn/simple: mirror unavailable",
      candidates: [],
    },
    readyPreparation(),
  );
  await coordinator.checkRuntime();
  await coordinator.installRuntime();
  const failed = coordinator.getState().runtime;
  assert.equal(failed.status, "unavailable");
  if (failed.status !== "unavailable") return;
  assert.equal(failed.retryPlan, plan);
  assert.match(failed.error, /mirror unavailable/u);
  assert.deepEqual(
    calls.map((call) => call.allowInstall),
    [false, false, true],
  );

  await coordinator.installRuntime();
  assert.equal(coordinator.getState().runtime.status, "ready");
  assert.deepEqual(
    calls.map((call) => call.allowInstall),
    [false, false, true, true],
  );
});

test("one-time Python selection appears only after automatic detection is unavailable", async () => {
  const calls: Array<
    Readonly<{ allowInstall: boolean; executableOverride?: string }>
  > = [];
  const preparations: ScanSciRuntimePreparation[] = [
    {
      status: "unavailable",
      error: "No compatible Python found",
      candidates: [],
    },
    readyPreparation("D:\\Python312\\python.exe"),
  ];
  const coordinator = new DownloadFirstUseCoordinator(
    portsWith({
      preparations,
      calls,
      executable: "D:/Python312/python.exe",
    }),
  );

  await coordinator.choosePythonExecutable();
  assert.equal(calls.length, 0);
  await coordinator.checkRuntime();
  const unavailable = coordinator.getState().runtime;
  assert.equal(unavailable.status, "unavailable");
  if (unavailable.status !== "unavailable") return;
  assert.equal(unavailable.allowExecutableSelection, true);

  await coordinator.choosePythonExecutable();
  assert.deepEqual(calls[1], {
    allowInstall: false,
    executableOverride: "D:\\Python312\\python.exe",
  });
  assert.equal(coordinator.getState().runtime.status, "ready");
});

test("institution policy stays visibly disabled while vendor source, license, and signature are unresolved", async () => {
  const coordinator = new DownloadFirstUseCoordinator(portsWith({}));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const institution = coordinator.getState().institutionLogin;
  assert.equal(institution.status, "disabled");
  if (institution.status !== "disabled") return;
  assert.equal(institution.policy.vendor, "CloakBrowser");
  assert.equal(institution.policy.approximateDownloadBytes, 209_715_200);
  assert.match(institution.policy.source, /accepted vendor artifact URL/u);
  assert.match(institution.policy.binaryLicense, /resolved and displayed/u);
  assert.match(institution.policy.signatureVerification, /implemented/u);
});

test("disposing first-use setup aborts active preparation and prevents late preference writes", async () => {
  const writes: Array<readonly [string, string]> = [];
  let aborted = false;
  const ports = portsWith({ writes });
  ports.runtime.prepareRuntime = async (request) => {
    await new Promise<void>((resolve) => {
      request.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          resolve();
        },
        { once: true },
      );
    });
    return readyPreparation();
  };
  const coordinator = new DownloadFirstUseCoordinator(ports);

  const pending = coordinator.checkRuntime();
  coordinator.dispose();
  await pending;

  assert.equal(aborted, true);
  assert.deepEqual(writes, []);
});

test("a folder picker returning after disposal cannot write preferences", async () => {
  const writes: Array<readonly [string, string]> = [];
  let finishPicker: ((path: string) => void) | undefined;
  const ports = portsWith({ writes });
  ports.chooseDownloadDestination = () =>
    new Promise((resolve) => {
      finishPicker = resolve;
    });
  const coordinator = new DownloadFirstUseCoordinator(ports);

  const pending = coordinator.changeDownloadDestination();
  coordinator.dispose();
  assert.ok(finishPicker);
  finishPicker("D:\\late");
  await pending;

  assert.deepEqual(writes, []);
});

function portsWith(options: {
  preferences?: Map<string, string>;
  writes?: Array<readonly [string, string]>;
  cleared?: string[];
  preparations?: ScanSciRuntimePreparation[];
  calls?: Array<
    Readonly<{ allowInstall: boolean; executableOverride?: string }>
  >;
  destination?: string;
  executable?: string;
}): DownloadFirstUsePorts {
  const preferences = options.preferences ?? new Map<string, string>();
  const writes = options.writes ?? [];
  const cleared = options.cleared ?? [];
  const preparations = options.preparations ?? [];
  const calls = options.calls ?? [];
  const runtime: ScanSciPort = {
    async prepareRuntime(request) {
      calls.push({
        allowInstall: request.allowInstall,
        ...(request.executableOverride
          ? { executableOverride: request.executableOverride }
          : {}),
      });
      const result = preparations.shift();
      if (!result) throw new Error("Unexpected runtime preparation");
      return result;
    },
    async startVisibleLogin() {
      throw new Error("Institution login must remain disabled");
    },
    async downloadOnePaper() {
      throw new Error("Download is outside this first-use test");
    },
  };
  return {
    runtime,
    getPreference: (key) => preferences.get(key),
    setPreference(key, value) {
      preferences.set(key, value);
      writes.push([key, value]);
    },
    clearPreference(key) {
      preferences.delete(key);
      cleared.push(key);
    },
    async chooseDownloadDestination() {
      return options.destination;
    },
    async choosePythonExecutable() {
      return options.executable;
    },
    async loadBrowserRuntimePolicy() {
      return browserPolicy();
    },
  };
}

function readyPreparation(
  executable = "C:\\Python313\\python.exe",
): ScanSciRuntimePreparation {
  return {
    status: "ready",
    capability: {
      status: "available",
      executable,
      pythonVersion: "3.13.1",
      architecture: "x64",
      moduleVersion: "3.0.0",
      schemaVersion: 3,
      sourceRulesVersion: 3,
      selectionReason: "automatic detection",
      dependencies: [],
      features: {
        onePaperDownload: "available",
        visibleLogin: "disabled",
      },
    },
  };
}

function installPlan(): ScanSciInstallPlan {
  return {
    baseExecutable: "C:\\Python312\\python.exe",
    privateEnvironment: "C:\\profile\\rfz\\venv",
    packageIndex: "https://pypi.tuna.tsinghua.edu.cn/simple",
    requirementsLock: "C:\\addon\\requirements.lock",
    dependencies: [],
    packages: [
      {
        name: "requests",
        version: "2.34.2",
        sha256: ["a".repeat(64)],
      },
    ],
    actions: ["Create private venv", "Install hash lock"],
    cancelResult: "No environment is created or changed",
  };
}

function browserPolicy(): unknown {
  return {
    routeID: "institution-browser",
    status: "disabled-pending-acceptance",
    binary: {
      vendor: "CloakBrowser",
      approximateDownloadBytes: 209_715_200,
      target: "<private-runtime>/cloakbrowser/chromium",
      automaticDownload: false,
      requiresSeparateUserConfirmation: true,
      source: "Must be pinned to the accepted vendor artifact URL",
      binaryLicense:
        "Must be resolved and displayed for the accepted vendor artifact",
      signatureVerification:
        "Must be pinned and implemented for the accepted vendor artifact",
    },
  };
}
