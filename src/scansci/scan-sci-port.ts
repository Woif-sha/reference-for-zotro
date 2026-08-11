export const SCANSCI_SCHEMA_VERSION = 3 as const;
export const SCANSCI_SOURCE_RULES_VERSION = 3 as const;
export const SCANSCI_SIDECAR_PROTOCOL =
  "reference-for-zotero.scansci-sidecar" as const;
export const SCANSCI_SIDECAR_CONTRACT_VERSION = "1.0.0" as const;
export const SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION = "1.0.0" as const;

export type ScanSciArchitecture = "x64" | "arm64" | "x86";

export type ScanSciDependency = Readonly<{
  name: string;
  requirement: string;
  installedVersion?: string;
  status: "available" | "missing" | "incompatible";
}>;

export type ScanSciCapability = Readonly<{
  status: "available";
  executable: string;
  pythonVersion: string;
  architecture: ScanSciArchitecture;
  moduleVersion: string;
  schemaVersion: typeof SCANSCI_SCHEMA_VERSION;
  sourceRulesVersion: typeof SCANSCI_SOURCE_RULES_VERSION;
  sidecar: Readonly<{
    protocol: typeof SCANSCI_SIDECAR_PROTOCOL;
    contractVersion: typeof SCANSCI_SIDECAR_CONTRACT_VERSION;
    resultSchemaVersion: typeof SCANSCI_SIDECAR_RESULT_SCHEMA_VERSION;
    upstreamRevision: string;
    dirty: false;
  }>;
  selectionReason:
    "configured override" | "automatic detection" | "private environment";
  dependencies: readonly ScanSciDependency[];
  features: Readonly<{
    onePaperDownload: "available";
    batchDownload: "available";
    visibleLogin: "available" | "disabled";
  }>;
  routes: readonly ScanSciRouteCapability[];
}>;

export type ScanSciRouteCapability =
  | Readonly<{
      routeID: "open-access";
      status: "available";
      sources: readonly ("arxiv" | "pmc")[];
      operations: readonly ("downloadOne" | "downloadBatch")[];
    }>
  | Readonly<{
      routeID: "institution-webvpn/ieee/one-click-single";
      status: "candidate";
      reason: "real-world-route-audit-pending";
      operations: readonly ("visibleLogin" | "downloadOne")[];
    }>;

export type VisibleLoginResult =
  | Readonly<{ status: "ready"; routeID: string }>
  | Readonly<{ status: "failed"; error: string }>;

export type ConfirmedPaper = Readonly<{
  title: string;
  doi?: string;
  arxivID?: string;
  pmcid?: string;
  primaryResultURL?: string;
}>;

export type OnePaperDownloadResult =
  | Readonly<{
      status: "downloaded";
      savedPath: string;
      cleanupWarning?: string;
    }>
  | Readonly<{ status: "failed"; error: string }>;

export type PaperDownloadItem = Readonly<{
  itemID: string;
  paper: ConfirmedPaper;
  canonicalFinalTarget: string;
}>;

export type PaperDownloadItemResult = Readonly<{
  itemID: string;
  result: OnePaperDownloadResult;
}>;

export type PaperDownloadRequest = Readonly<{
  items: readonly PaperDownloadItem[];
  downloadDestination: string;
  timeoutMilliseconds?: number;
  signal?: AbortSignal;
  onProgress?(result: PaperDownloadItemResult): void;
}>;

export type ScanSciInstallPlan = Readonly<{
  baseExecutable: string;
  privateEnvironment: string;
  packageIndex: "https://pypi.tuna.tsinghua.edu.cn/simple";
  requirementsLock: string;
  dependencies: readonly ScanSciDependency[];
  packages: readonly Readonly<{
    name: string;
    version: string;
    sha256: readonly string[];
  }>[];
  actions: readonly string[];
  cancelResult: string;
}>;

export type ScanSciRuntimeCandidate = Readonly<{
  executable: string;
  pythonVersion?: string;
  architecture?: ScanSciArchitecture;
  dependencies: readonly ScanSciDependency[];
  error?: string;
}>;

export type ScanSciRuntimePreparation =
  | Readonly<{
      status: "ready";
      capability: ScanSciCapability;
    }>
  | Readonly<{
      status: "needs-install";
      plan: ScanSciInstallPlan;
      candidates: readonly ScanSciRuntimeCandidate[];
    }>
  | Readonly<{
      status: "unavailable";
      error: string;
      candidates: readonly ScanSciRuntimeCandidate[];
    }>;

export interface ScanSciPort {
  prepareRuntime(
    request: Readonly<{
      allowInstall: boolean;
      executableOverride?: string;
      signal?: AbortSignal;
    }>,
  ): Promise<ScanSciRuntimePreparation>;
  startVisibleLogin(
    request: Readonly<{
      userInitiated: true;
      routeID: string;
    }>,
  ): Promise<VisibleLoginResult>;
  downloadPapers(
    request: PaperDownloadRequest,
  ): Promise<readonly PaperDownloadItemResult[]>;
}
