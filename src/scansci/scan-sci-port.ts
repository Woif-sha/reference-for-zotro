export const SCANSCI_SCHEMA_VERSION = 3 as const;
export const SCANSCI_SOURCE_RULES_VERSION = 3 as const;

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
  selectionReason:
    "configured override" | "automatic detection" | "private environment";
  dependencies: readonly ScanSciDependency[];
  features: Readonly<{
    onePaperDownload: "available";
    visibleLogin: "available" | "disabled";
  }>;
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

export type OnePaperDownloadRequest = Readonly<{
  paper: ConfirmedPaper;
  downloadDestination: string;
  canonicalFinalTarget: string;
  timeoutMilliseconds?: number;
}>;

export type OnePaperDownloadResult =
  | Readonly<{
      status: "downloaded";
      savedPath: string;
      cleanupWarning?: string;
    }>
  | Readonly<{ status: "failed"; error: string }>;

export type ScanSciInstallPlan = Readonly<{
  baseExecutable: string;
  privateEnvironment: string;
  packageIndex: "https://pypi.tuna.tsinghua.edu.cn/simple";
  requirementsLock: string;
  dependencies: readonly ScanSciDependency[];
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
    }>,
  ): Promise<ScanSciRuntimePreparation>;
  startVisibleLogin(
    request: Readonly<{
      userInitiated: true;
      routeID: string;
    }>,
  ): Promise<VisibleLoginResult>;
  downloadOnePaper(
    request: OnePaperDownloadRequest,
  ): Promise<OnePaperDownloadResult>;
}
