import {
  SCANSCI_SIDECAR_CONTRACT_VERSION,
  SCANSCI_SIDECAR_PROTOCOL,
  SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION,
  type ConfirmedPaper,
  type ScanSciArchitecture,
  type ScanSciDependency,
  type ScanSciRouteCapability,
} from "./scan-sci-port";

export const SCANSCI_MODULE_VERSION = "3.2.0" as const;
export const SCANSCI_UPSTREAM_REVISION =
  "5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5" as const;
export const INSTITUTION_ROUTE_ID =
  "institution-webvpn/ieee/one-click-single" as const;
const EXPECTED_DEPENDENCIES = [
  ["requests", "==2.34.2"],
  ["certifi", "==2026.7.22"],
  ["charset-normalizer", "==3.4.9"],
  ["idna", "==3.18"],
  ["urllib3", "==2.7.0"],
] as const;

export type SidecarOperation =
  "probe" | "visibleLogin" | "downloadOne" | "downloadBatch";

export type SidecarRequest = Readonly<{
  protocol: typeof SCANSCI_SIDECAR_PROTOCOL;
  contractVersion: typeof SCANSCI_SIDECAR_CONTRACT_VERSION;
  resultSchemaVersion: typeof SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION;
  requestId: string;
  operation: SidecarOperation;
  params: Readonly<Record<string, unknown>>;
}>;

export type SidecarProbe = Readonly<{
  applicationVersion: typeof SCANSCI_MODULE_VERSION;
  executable: string;
  pythonVersion: string;
  architecture: ScanSciArchitecture;
  upstreamRevision: typeof SCANSCI_UPSTREAM_REVISION;
  dirty: false;
  dependencies: readonly ScanSciDependency[];
  routes: readonly ScanSciRouteCapability[];
}>;

export type SidecarDownloadResult =
  | Readonly<{
      status: "downloaded";
      identifier: string;
      relativePath: string;
      sourceEvidence: Readonly<{
        routeID: "open-access";
        source: string;
        sourceURL: string;
        egressHosts: readonly string[];
      }>;
    }>
  | Readonly<{
      status: "failed";
      identifier: string;
      error: Readonly<{ code: string; message: string }>;
    }>;

export type SidecarMessage =
  | Readonly<{
      type: "progress";
      operation: "downloadBatch";
      payload: Readonly<{
        sequence: number;
        completed: number;
        total: number;
        itemID: string;
        result: SidecarDownloadResult;
      }>;
    }>
  | Readonly<{
      type: "complete";
      operation: SidecarOperation;
      ok: true;
      payload: unknown;
    }>
  | Readonly<{
      type: "complete";
      operation: SidecarOperation;
      ok: false;
      error: Readonly<{ code: string; message: string; retryable: boolean }>;
    }>;

export function createSidecarRequest(
  requestID: string,
  operation: SidecarOperation,
  params: Readonly<Record<string, unknown>>,
): SidecarRequest {
  return {
    protocol: SCANSCI_SIDECAR_PROTOCOL,
    contractVersion: SCANSCI_SIDECAR_CONTRACT_VERSION,
    resultSchemaVersion: SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION,
    requestId: requestID,
    operation,
    params,
  };
}

export function protocolPaper(paper: ConfirmedPaper) {
  if (!paper.title.trim()) throw new Error("Confirmed paper title is required");
  if (!paper.doi && !paper.arxivID && !paper.pmcid) {
    throw new Error("Confirmed paper requires DOI, arXiv id, or PMCID");
  }
  return {
    title: paper.title,
    ...(paper.doi ? { doi: paper.doi } : {}),
    ...(paper.arxivID ? { arxivID: paper.arxivID } : {}),
    ...(paper.pmcid ? { pmcid: paper.pmcid } : {}),
  };
}

export function parseSidecarMessage(
  line: string,
  expected: Readonly<{ requestID: string; operation: SidecarOperation }>,
): SidecarMessage {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error("ScanSci sidecar stdout contained invalid JSON", {
      cause: error,
    });
  }
  if (
    !isRecord(value) ||
    value.protocol !== SCANSCI_SIDECAR_PROTOCOL ||
    value.contractVersion !== SCANSCI_SIDECAR_CONTRACT_VERSION ||
    value.resultSchemaVersion !== SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION ||
    value.requestId !== expected.requestID ||
    value.operation !== expected.operation
  ) {
    throw new Error("ScanSci sidecar response identity is incompatible");
  }
  if (value.type === "progress") {
    if (
      expected.operation !== "downloadBatch" ||
      !hasExactKeys(value, [
        "protocol",
        "contractVersion",
        "resultSchemaVersion",
        "requestId",
        "operation",
        "type",
        "payload",
      ]) ||
      !isRecord(value.payload) ||
      !hasExactKeys(value.payload, [
        "sequence",
        "completed",
        "total",
        "itemId",
        "result",
      ])
    ) {
      throw new Error("ScanSci sidecar emitted unexpected progress");
    }
    const { sequence, completed, total, itemId, result } = value.payload;
    if (
      !positiveInteger(sequence) ||
      completed !== sequence ||
      !positiveInteger(total) ||
      sequence > total ||
      typeof itemId !== "string"
    ) {
      throw new Error("ScanSci batch progress is invalid");
    }
    return {
      type: "progress",
      operation: "downloadBatch",
      payload: {
        sequence,
        completed,
        total,
        itemID: itemId,
        result: parseSidecarDownloadResult(result),
      },
    };
  }
  if (value.type !== "complete" || typeof value.ok !== "boolean") {
    throw new Error("ScanSci sidecar response type is invalid");
  }
  const completionKeys = [
    "protocol",
    "contractVersion",
    "resultSchemaVersion",
    "requestId",
    "operation",
    "type",
    "ok",
    value.ok ? "payload" : "error",
  ];
  if (!hasExactKeys(value, completionKeys)) {
    throw new Error("ScanSci sidecar response contains unexpected fields");
  }
  if (!value.ok) {
    if (
      !isRecord(value.error) ||
      !hasExactKeys(value.error, ["code", "message", "retryable"]) ||
      typeof value.error.code !== "string" ||
      typeof value.error.message !== "string" ||
      typeof value.error.retryable !== "boolean"
    ) {
      throw new Error("ScanSci sidecar error response is invalid");
    }
    return {
      type: "complete",
      operation: expected.operation,
      ok: false,
      error: {
        code: value.error.code,
        message: value.error.message,
        retryable: value.error.retryable,
      },
    };
  }
  if (!("payload" in value)) {
    throw new Error("ScanSci sidecar completion has no payload");
  }
  return {
    type: "complete",
    operation: expected.operation,
    ok: true,
    payload: value.payload,
  };
}

export function parseProbePayload(value: unknown): SidecarProbe {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "application",
      "runtime",
      "source",
      "contractVersion",
      "resultSchemaVersion",
      "operations",
      "compatibility",
      "routeCapabilities",
      "policy",
    ]) ||
    !isRecord(value.application) ||
    !hasExactKeys(value.application, ["name", "version"]) ||
    value.application.name !== "reference-for-zotero-scansci" ||
    value.application.version !== SCANSCI_MODULE_VERSION ||
    !isRecord(value.runtime) ||
    !hasExactKeys(value.runtime, [
      "implementation",
      "pythonVersion",
      "executable",
      "architecture",
      "platform",
    ]) ||
    value.runtime.implementation !== "CPython" ||
    value.runtime.platform !== "Windows" ||
    typeof value.runtime.executable !== "string" ||
    typeof value.runtime.pythonVersion !== "string" ||
    !isArchitecture(value.runtime.architecture) ||
    !isRecord(value.source) ||
    !hasExactKeys(value.source, [
      "repository",
      "revision",
      "installKind",
      "dirty",
    ]) ||
    value.source.repository !== "Rimagination/scansci-pdf" ||
    value.source.revision !== SCANSCI_UPSTREAM_REVISION ||
    value.source.installKind !== "audited-plugin-fragments" ||
    value.source.dirty !== false ||
    value.contractVersion !== SCANSCI_SIDECAR_CONTRACT_VERSION ||
    value.resultSchemaVersion !== SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION ||
    !Array.isArray(value.operations) ||
    !sameStringSet(value.operations, [
      "downloadBatch",
      "downloadOne",
      "probe",
      "visibleLogin",
    ]) ||
    !Array.isArray(value.routeCapabilities) ||
    !isRecord(value.compatibility) ||
    !hasExactKeys(value.compatibility, [
      "status",
      "minimumPython",
      "dependencies",
    ]) ||
    value.compatibility.minimumPython !== "3.11" ||
    !Array.isArray(value.compatibility.dependencies) ||
    !isRecord(value.policy) ||
    !hasExactKeys(value.policy, ["mode", "disabledRoutes"]) ||
    value.policy.mode !== "legal-only" ||
    !Array.isArray(value.policy.disabledRoutes)
  ) {
    throw new Error("ScanSci sidecar probe payload is incompatible");
  }
  const disabledRoutes = value.policy.disabledRoutes;
  const requiredDisabledRoutes = [
    "sci-hub",
    "libgen",
    "scibban",
    "tor",
    "proxy-pool",
    "vpnsci",
    "unknown",
  ];
  if (!sameStringSet(disabledRoutes, requiredDisabledRoutes)) {
    throw new Error("ScanSci sidecar disabled-route policy is incompatible");
  }
  const dependencies =
    value.compatibility.dependencies.map(parseProbeDependency);
  const requirements = new Map(
    dependencies.map(({ name, requirement }) => [name, requirement]),
  );
  if (
    dependencies.length !== EXPECTED_DEPENDENCIES.length ||
    EXPECTED_DEPENDENCIES.some(
      ([name, requirement]) => requirements.get(name) !== requirement,
    )
  ) {
    throw new Error("ScanSci sidecar dependency set is incompatible");
  }
  const issues = dependencies
    .filter(
      ({ requirement, installedVersion, status }) =>
        status !== "available" || installedVersion !== requirement.slice(2),
    )
    .map(({ name, requirement, installedVersion, status }) =>
      status === "missing"
        ? `${name}${requirement} is missing`
        : `${name}${requirement} is incompatible (installed ${installedVersion ?? "unknown"})`,
    );
  if (value.compatibility.status !== "compatible" || issues.length > 0) {
    throw new Error(
      `ScanSci sidecar runtime is incompatible: ${issues.join("; ") || `Python ${value.runtime.pythonVersion} is older than 3.11`}`,
    );
  }
  const routes = parseRoutes(value.routeCapabilities);
  return {
    applicationVersion: SCANSCI_MODULE_VERSION,
    executable: value.runtime.executable,
    pythonVersion: value.runtime.pythonVersion,
    architecture: value.runtime.architecture,
    upstreamRevision: SCANSCI_UPSTREAM_REVISION,
    dirty: false,
    dependencies,
    routes,
  };
}

function parseProbeDependency(value: unknown): ScanSciDependency {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["name", "requirement", "status"],
      ["installedVersion"],
    ) ||
    typeof value.name !== "string" ||
    typeof value.requirement !== "string" ||
    (value.installedVersion !== undefined &&
      typeof value.installedVersion !== "string") ||
    (value.status !== "available" &&
      value.status !== "missing" &&
      value.status !== "incompatible")
  ) {
    throw new Error("ScanSci sidecar dependency capability is invalid");
  }
  return {
    name: value.name,
    requirement: value.requirement,
    ...(value.installedVersion
      ? { installedVersion: value.installedVersion }
      : {}),
    status: value.status,
  };
}

export function parseDownloadOnePayload(value: unknown): SidecarDownloadResult {
  if (!isRecord(value) || !hasExactKeys(value, ["result"])) {
    throw new Error("ScanSci downloadOne completion is invalid");
  }
  return parseSidecarDownloadResult(value.result);
}

export function parseDownloadBatchPayload(
  value: unknown,
): readonly Readonly<{ itemID: string; result: SidecarDownloadResult }>[] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["total", "downloaded", "failed", "results"]) ||
    !nonNegativeInteger(value.total) ||
    !nonNegativeInteger(value.downloaded) ||
    !nonNegativeInteger(value.failed) ||
    value.downloaded + value.failed !== value.total ||
    !Array.isArray(value.results) ||
    value.results.length !== value.total
  ) {
    throw new Error("ScanSci downloadBatch completion is invalid");
  }
  const results = value.results.map((item) => {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ["itemId", "result"]) ||
      typeof item.itemId !== "string"
    ) {
      throw new Error("ScanSci downloadBatch item is invalid");
    }
    return {
      itemID: item.itemId,
      result: parseSidecarDownloadResult(item.result),
    };
  });
  if (new Set(results.map(({ itemID }) => itemID)).size !== results.length) {
    throw new Error("ScanSci downloadBatch item ids are not unique");
  }
  return results;
}

function parseRoutes(
  value: readonly unknown[],
): readonly ScanSciRouteCapability[] {
  const openAccess = value.find(
    (route) => isRecord(route) && route.routeId === "open-access",
  );
  const institution = value.find(
    (route) => isRecord(route) && route.routeId === INSTITUTION_ROUTE_ID,
  );
  if (
    value.length !== 2 ||
    !isRecord(openAccess) ||
    !hasExactKeys(openAccess, [
      "routeId",
      "available",
      "sources",
      "operations",
      "concurrency",
    ]) ||
    openAccess.available !== true ||
    !sameStringSet(openAccess.sources, ["arxiv", "pmc"]) ||
    !sameStringSet(openAccess.operations, ["downloadOne", "downloadBatch"]) ||
    openAccess.concurrency !== "bounded" ||
    !isRecord(institution) ||
    !hasExactKeys(institution, [
      "routeId",
      "status",
      "available",
      "operations",
      "concurrency",
      "profileId",
      "reason",
    ]) ||
    institution.status !== "candidate" ||
    institution.available !== false ||
    institution.reason !== "real-world-route-audit-pending" ||
    !sameStringSet(institution.operations, ["visibleLogin", "downloadOne"]) ||
    institution.concurrency !== "single-profile-writer" ||
    institution.profileId !== "zotero"
  ) {
    throw new Error("ScanSci sidecar route capabilities are incompatible");
  }
  return [
    {
      routeID: "open-access",
      status: "available",
      sources: ["arxiv", "pmc"],
      operations: ["downloadOne", "downloadBatch"],
    },
    {
      routeID: INSTITUTION_ROUTE_ID,
      status: "candidate",
      reason: "real-world-route-audit-pending",
      operations: ["visibleLogin", "downloadOne"],
    },
  ];
}

function parseSidecarDownloadResult(value: unknown): SidecarDownloadResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "identifier",
      "sourceEvidence",
      "relativePath",
      "error",
    ]) ||
    value.schemaVersion !== SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION ||
    typeof value.identifier !== "string"
  ) {
    throw new Error("ScanSci sidecar download result is invalid");
  }
  if (value.status === "failed") {
    if (
      value.sourceEvidence !== null ||
      value.relativePath !== null ||
      !isRecord(value.error) ||
      !hasExactKeys(value.error, ["code", "message"]) ||
      typeof value.error.code !== "string" ||
      typeof value.error.message !== "string"
    ) {
      throw new Error("ScanSci sidecar failed result is invalid");
    }
    return {
      status: "failed",
      identifier: value.identifier,
      error: { code: value.error.code, message: value.error.message },
    };
  }
  if (
    value.status !== "downloaded" ||
    typeof value.relativePath !== "string" ||
    !value.relativePath ||
    value.error !== null ||
    !isRecord(value.sourceEvidence) ||
    !hasExactKeys(value.sourceEvidence, [
      "routeId",
      "source",
      "sourceUrl",
      "egressHosts",
      "legal",
    ]) ||
    value.sourceEvidence.routeId !== "open-access" ||
    typeof value.sourceEvidence.source !== "string" ||
    typeof value.sourceEvidence.sourceUrl !== "string" ||
    !Array.isArray(value.sourceEvidence.egressHosts) ||
    !value.sourceEvidence.egressHosts.every(
      (host) => typeof host === "string",
    ) ||
    value.sourceEvidence.legal !== true
  ) {
    throw new Error("ScanSci sidecar downloaded result is invalid");
  }
  return {
    status: "downloaded",
    identifier: value.identifier,
    relativePath: value.relativePath,
    sourceEvidence: {
      routeID: "open-access",
      source: value.sourceEvidence.source,
      sourceURL: value.sourceEvidence.sourceUrl,
      egressHosts: value.sourceEvidence.egressHosts,
    },
  };
}

function sameStringSet(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    value.length === expected.length &&
    expected.every((item) => value.includes(item))
  );
}

function isArchitecture(value: unknown): value is ScanSciArchitecture {
  return value === "x64" || value === "arm64" || value === "x86";
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => allowed.has(key))
  );
}
