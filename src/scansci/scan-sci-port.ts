export const SCANSCI_SCHEMA_VERSION = 3 as const;
export const SCANSCI_SOURCE_RULES_VERSION = 3 as const;
export const SCANSCI_SIDECAR_PROTOCOL =
  "reference-for-zotero.scansci-sidecar" as const;
export const SCANSCI_SIDECAR_CONTRACT_VERSION = "1.1.0" as const;
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
  cacheDirectory: string;
  timeoutMilliseconds?: number;
  signal?: AbortSignal;
  onProgress?(result: PaperDownloadItemResult): void;
}>;

export interface ScanSciPort {
  probe(
    request?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ScanSciCapability>;
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
