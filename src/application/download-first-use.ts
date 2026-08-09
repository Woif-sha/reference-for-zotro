import type {
  ScanSciCapability,
  ScanSciInstallPlan,
  ScanSciPort,
  ScanSciRuntimeCandidate,
} from "../scansci/scan-sci-port";

export const DEFAULT_DOWNLOAD_DESTINATION = "E:\\paper";
export const DOWNLOAD_DESTINATION_PREFERENCE =
  "extensions.referenceforzotero.downloadDestination";
export const PYTHON_EXECUTABLE_PREFERENCE =
  "extensions.referenceforzotero.pythonExecutable";
export const PYTHON_VERSION_PREFERENCE =
  "extensions.referenceforzotero.pythonVersion";
export const RUNTIME_MODULE_VERSION_PREFERENCE =
  "extensions.referenceforzotero.runtimeModuleVersion";

export type BrowserRuntimePolicy = Readonly<{
  routeID: string;
  status: "disabled-pending-acceptance";
  vendor: string;
  source: string;
  approximateDownloadBytes: number;
  binaryLicense: string;
  target: string;
  signatureVerification: string;
}>;

export type DownloadRuntimeState =
  | Readonly<{ status: "unchecked" }>
  | Readonly<{ status: "checking" }>
  | Readonly<{
      status: "ready";
      capability: ScanSciCapability;
      persistenceWarning?: string;
    }>
  | Readonly<{
      status: "needs-install";
      plan: ScanSciInstallPlan;
      candidates: readonly ScanSciRuntimeCandidate[];
    }>
  | Readonly<{ status: "installing"; plan: ScanSciInstallPlan }>
  | Readonly<{
      status: "unavailable";
      error: string;
      candidates: readonly ScanSciRuntimeCandidate[];
      allowExecutableSelection: boolean;
      retryPlan?: ScanSciInstallPlan;
    }>;

export type InstitutionLoginState =
  | Readonly<{ status: "loading-policy" }>
  | Readonly<{ status: "disabled"; policy: BrowserRuntimePolicy }>
  | Readonly<{ status: "unavailable"; error: string }>;

export type DownloadFirstUseState = Readonly<{
  downloadDestination: string;
  usingDefaultDestination: boolean;
  destinationError?: string;
  runtime: DownloadRuntimeState;
  institutionLogin: InstitutionLoginState;
}>;

export interface DownloadFirstUsePorts {
  runtime: ScanSciPort;
  getPreference(key: string): string | undefined;
  setPreference(key: string, value: string): void;
  clearPreference(key: string): void;
  chooseDownloadDestination(current: string): Promise<string | undefined>;
  choosePythonExecutable(): Promise<string | undefined>;
  loadBrowserRuntimePolicy(): Promise<unknown>;
}

export interface DownloadFirstUseController {
  getState(): DownloadFirstUseState;
  subscribe(listener: (state: DownloadFirstUseState) => void): () => void;
  changeDownloadDestination(): Promise<void>;
  resetDownloadDestination(): void;
  checkRuntime(): Promise<void>;
  choosePythonExecutable(): Promise<void>;
  installRuntime(): Promise<void>;
  cancelRuntimeInstallation(): void;
  dispose(): void;
}

export class DownloadFirstUseCoordinator implements DownloadFirstUseController {
  private state: DownloadFirstUseState;
  private readonly listeners = new Set<
    (state: DownloadFirstUseState) => void
  >();
  private operation = 0;
  private operationController?: AbortController;
  private disposed = false;

  constructor(private readonly ports: DownloadFirstUsePorts) {
    const configuredDestination = ports.getPreference(
      DOWNLOAD_DESTINATION_PREFERENCE,
    );
    let downloadDestination = DEFAULT_DOWNLOAD_DESTINATION;
    let destinationError: string | undefined;
    if (configuredDestination) {
      try {
        downloadDestination = validateWindowsAbsolutePath(
          configuredDestination,
          "Stored download destination",
        );
      } catch (error) {
        destinationError = originalError(error);
      }
    }
    this.state = {
      downloadDestination,
      usingDefaultDestination:
        !configuredDestination || Boolean(destinationError),
      ...(destinationError ? { destinationError } : {}),
      runtime: { status: "unchecked" },
      institutionLogin: { status: "loading-policy" },
    };
    void this.loadInstitutionPolicy();
  }

  getState(): DownloadFirstUseState {
    return this.state;
  }

  subscribe(listener: (state: DownloadFirstUseState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async changeDownloadDestination(): Promise<void> {
    if (this.disposed) return;
    try {
      const selected = await this.ports.chooseDownloadDestination(
        this.state.downloadDestination,
      );
      if (this.disposed) return;
      if (!selected) return;
      const downloadDestination = validateWindowsAbsolutePath(
        selected,
        "Download destination",
      );
      this.ports.setPreference(
        DOWNLOAD_DESTINATION_PREFERENCE,
        downloadDestination,
      );
      this.update({
        downloadDestination,
        usingDefaultDestination: false,
        destinationError: undefined,
      });
    } catch (error) {
      this.update({ destinationError: originalError(error) });
    }
  }

  resetDownloadDestination(): void {
    if (this.disposed) return;
    try {
      this.ports.clearPreference(DOWNLOAD_DESTINATION_PREFERENCE);
      this.update({
        downloadDestination: DEFAULT_DOWNLOAD_DESTINATION,
        usingDefaultDestination: true,
        destinationError: undefined,
      });
    } catch (error) {
      this.update({ destinationError: originalError(error) });
    }
  }

  async checkRuntime(): Promise<void> {
    if (this.disposed || this.runtimeBusy()) return;
    const { operation, signal } = this.beginOperation();
    this.update({ runtime: { status: "checking" } });
    const executableOverride = this.ports.getPreference(
      PYTHON_EXECUTABLE_PREFERENCE,
    );
    let result: Awaited<ReturnType<ScanSciPort["prepareRuntime"]>>;
    try {
      result = await this.ports.runtime.prepareRuntime({
        allowInstall: false,
        signal,
        ...(executableOverride ? { executableOverride } : {}),
      });
    } catch (error) {
      if (operation !== this.operation) return;
      this.publishRuntimeException(error, true);
      return;
    }
    if (operation !== this.operation) return;
    this.publishPreparation(result, true);
  }

  async choosePythonExecutable(): Promise<void> {
    if (
      this.disposed ||
      this.runtimeBusy() ||
      this.state.runtime.status !== "unavailable" ||
      !this.state.runtime.allowExecutableSelection
    ) {
      return;
    }
    let executable: string | undefined;
    try {
      executable = await this.ports.choosePythonExecutable();
    } catch (error) {
      this.publishRuntimeException(error, true);
      return;
    }
    if (!executable) return;
    if (this.disposed) return;
    const { operation, signal } = this.beginOperation();
    this.update({ runtime: { status: "checking" } });
    let result: Awaited<ReturnType<ScanSciPort["prepareRuntime"]>>;
    try {
      result = await this.ports.runtime.prepareRuntime({
        allowInstall: false,
        signal,
        executableOverride: validateWindowsAbsolutePath(
          executable,
          "Python executable",
        ),
      });
    } catch (error) {
      if (operation !== this.operation) return;
      this.publishRuntimeException(error, true);
      return;
    }
    if (operation !== this.operation) return;
    this.publishPreparation(result, false);
  }

  async installRuntime(): Promise<void> {
    const runtime = this.state.runtime;
    const plan =
      runtime.status === "needs-install"
        ? runtime.plan
        : runtime.status === "unavailable"
          ? runtime.retryPlan
          : undefined;
    if (this.disposed || !plan || this.runtimeBusy()) return;
    const { operation, signal } = this.beginOperation();
    this.update({ runtime: { status: "installing", plan } });
    let result: Awaited<ReturnType<ScanSciPort["prepareRuntime"]>>;
    try {
      result = await this.ports.runtime.prepareRuntime({
        allowInstall: true,
        signal,
        executableOverride: plan.baseExecutable,
      });
    } catch (error) {
      if (operation !== this.operation) return;
      this.update({
        runtime: {
          status: "unavailable",
          error: originalError(error),
          candidates: [],
          allowExecutableSelection: false,
          retryPlan: plan,
        },
      });
      return;
    }
    if (operation !== this.operation) return;
    if (result.status === "unavailable") {
      this.update({
        runtime: {
          status: "unavailable",
          error: result.error,
          candidates: result.candidates,
          allowExecutableSelection: false,
          retryPlan: plan,
        },
      });
      return;
    }
    this.publishPreparation(result, false);
  }

  cancelRuntimeInstallation(): void {
    if (this.disposed) return;
    const runtime = this.state.runtime;
    if (runtime.status !== "needs-install") return;
    this.operation += 1;
    this.update({
      runtime: {
        status: "unavailable",
        error:
          "Python environment installation canceled; existing Reader, destination, and translation features are unchanged",
        candidates: runtime.candidates,
        allowExecutableSelection: false,
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operation += 1;
    this.operationController?.abort();
    this.operationController = undefined;
    this.listeners.clear();
  }

  private publishPreparation(
    result: Awaited<ReturnType<ScanSciPort["prepareRuntime"]>>,
    automaticDetection: boolean,
  ): void {
    if (result.status === "ready") {
      const persistenceWarning = this.persistRuntimeIdentity(result.capability);
      this.update({
        runtime: {
          status: "ready",
          capability: result.capability,
          ...(persistenceWarning ? { persistenceWarning } : {}),
        },
      });
      return;
    }
    if (result.status === "needs-install") {
      this.update({
        runtime: {
          status: "needs-install",
          plan: result.plan,
          candidates: result.candidates,
        },
      });
      return;
    }
    this.update({
      runtime: {
        status: "unavailable",
        error: result.error,
        candidates: result.candidates,
        allowExecutableSelection: automaticDetection,
      },
    });
  }

  private persistRuntimeIdentity(
    capability: ScanSciCapability,
  ): string | undefined {
    try {
      this.ports.setPreference(
        PYTHON_EXECUTABLE_PREFERENCE,
        capability.executable,
      );
      this.ports.setPreference(
        PYTHON_VERSION_PREFERENCE,
        capability.pythonVersion,
      );
      this.ports.setPreference(
        RUNTIME_MODULE_VERSION_PREFERENCE,
        capability.moduleVersion,
      );
      return undefined;
    } catch (error) {
      return `Runtime is ready but its non-sensitive identity could not be persisted: ${originalError(error)}`;
    }
  }

  private publishRuntimeException(
    error: unknown,
    allowExecutableSelection: boolean,
  ): void {
    this.update({
      runtime: {
        status: "unavailable",
        error: originalError(error),
        candidates: [],
        allowExecutableSelection,
      },
    });
  }

  private async loadInstitutionPolicy(): Promise<void> {
    try {
      const policy = parseBrowserRuntimePolicy(
        await this.ports.loadBrowserRuntimePolicy(),
      );
      this.update({ institutionLogin: { status: "disabled", policy } });
    } catch (error) {
      this.update({
        institutionLogin: {
          status: "unavailable",
          error: originalError(error),
        },
      });
    }
  }

  private runtimeBusy(): boolean {
    return (
      this.state.runtime.status === "checking" ||
      this.state.runtime.status === "installing"
    );
  }

  private beginOperation(): Readonly<{
    operation: number;
    signal: AbortSignal;
  }> {
    this.operationController?.abort();
    const controller = new AbortController();
    this.operationController = controller;
    return { operation: ++this.operation, signal: controller.signal };
  }

  private update(patch: Partial<DownloadFirstUseState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }
}

export function validateWindowsAbsolutePath(
  value: string,
  label: string,
): string {
  const path = value.trim().replace(/\//gu, "\\");
  if (/^\\\\[?.]\\/u.test(path)) {
    throw new Error(`${label} cannot use a Windows device path`);
  }
  if (!/^[A-Za-z]:\\/u.test(path) && !/^\\\\[^\\]+\\[^\\]+/u.test(path)) {
    throw new Error(`${label} must be an absolute Windows path`);
  }
  return path.length > 3 ? path.replace(/\\+$/u, "") : path;
}

function parseBrowserRuntimePolicy(value: unknown): BrowserRuntimePolicy {
  if (!isRecord(value) || value.status !== "disabled-pending-acceptance") {
    throw new Error(
      "Institution browser policy is not in the required disabled-pending-acceptance state",
    );
  }
  const binary = value.binary;
  if (
    value.routeID !== "institution-browser" ||
    !isRecord(binary) ||
    typeof binary.vendor !== "string" ||
    typeof binary.source !== "string" ||
    typeof binary.approximateDownloadBytes !== "number" ||
    typeof binary.binaryLicense !== "string" ||
    typeof binary.target !== "string" ||
    typeof binary.signatureVerification !== "string" ||
    binary.automaticDownload !== false ||
    binary.requiresSeparateUserConfirmation !== true
  ) {
    throw new Error("Institution browser policy is incomplete");
  }
  return {
    routeID: value.routeID,
    status: value.status,
    vendor: binary.vendor,
    source: binary.source,
    approximateDownloadBytes: binary.approximateDownloadBytes,
    binaryLicense: binary.binaryLicense,
    target: binary.target,
    signatureVerification: binary.signatureVerification,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function originalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
