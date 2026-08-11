import assert from "node:assert/strict";
import test from "node:test";
import {
  createSidecarRequest,
  parseProbePayload,
  parseSidecarMessage,
  protocolPaper,
} from "../../src/scansci/sidecar-protocol";

test("sidecar requests expose only the versioned four-operation contract", () => {
  assert.deepEqual(createSidecarRequest("request-1", "downloadOne", {}), {
    protocol: "reference-for-zotero.scansci-sidecar",
    contractVersion: "1.1.0",
    resultSchemaVersion: "1.0.0",
    requestId: "request-1",
    operation: "downloadOne",
    params: {},
  });
  assert.deepEqual(
    protocolPaper({
      title: "Paper",
      doi: "10.1000/example",
      primaryResultURL: "https://publisher.example/private",
    }),
    { title: "Paper", doi: "10.1000/example" },
  );
});

test("sidecar response parsing rejects incompatible protocol versions explicitly", () => {
  assert.throws(
    () =>
      parseSidecarMessage(
        JSON.stringify({
          protocol: "reference-for-zotero.scansci-sidecar",
          contractVersion: "2.0.0",
          resultSchemaVersion: "1.0.0",
          requestId: "request-1",
          operation: "probe",
          type: "complete",
          ok: true,
          payload: {},
        }),
        { requestID: "request-1", operation: "probe" },
      ),
    /identity is incompatible/u,
  );
});

test("sidecar probe rejects a dirty vendored source and never promotes the institution candidate", () => {
  const payload = compatibleProbePayload();
  assert.throws(
    () =>
      parseProbePayload({
        ...payload,
        source: { ...payload.source, dirty: true },
      }),
    /probe payload is incompatible/u,
  );

  const probe = parseProbePayload(payload);
  assert.deepEqual(probe.routes[1], {
    routeID: "institution-webvpn/ieee/one-click-single",
    status: "candidate",
    reason: "real-world-route-audit-pending",
    operations: ["visibleLogin", "downloadOne"],
  });
});

test("sidecar probe reports the exact incompatible dependency without an install fallback", () => {
  const payload = compatibleProbePayload();
  assert.throws(
    () =>
      parseProbePayload({
        ...payload,
        compatibility: {
          ...payload.compatibility,
          status: "incompatible",
          dependencies: compatibleDependencies().map((dependency) =>
            dependency.name === "requests"
              ? {
                  ...dependency,
                  installedVersion: undefined,
                  status: "missing",
                }
              : dependency,
          ),
        },
      }),
    /requests==2\.34\.2 is missing/u,
  );
});

test("sidecar probe rejects dependency details that contradict a compatible status", () => {
  const payload = compatibleProbePayload();
  assert.throws(
    () =>
      parseProbePayload({
        ...payload,
        compatibility: {
          ...payload.compatibility,
          dependencies: compatibleDependencies().map((dependency) =>
            dependency.name === "requests"
              ? { ...dependency, installedVersion: "2.34.1" }
              : dependency,
          ),
        },
      }),
    /requests==2\.34\.2 is incompatible \(installed 2\.34\.1\)/u,
  );
});

function compatibleProbePayload() {
  return {
    application: { name: "reference-for-zotero-scansci", version: "3.1.0" },
    runtime: {
      implementation: "CPython",
      pythonVersion: "3.12.10",
      executable: "C:\\Python312\\python.exe",
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
      dependencies: compatibleDependencies(),
    },
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
  } as const;
}

function compatibleDependencies() {
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
