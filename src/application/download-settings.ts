import type { ScanSciCapability, ScanSciPort } from "../scansci/scan-sci-port";

export const DEFAULT_DOWNLOAD_DESTINATION = "E:\\paper";
export const DOWNLOAD_DESTINATION_PREFERENCE =
  "extensions.referenceforzotero.downloadDestination";

export type DownloadRuntimeState =
  | Readonly<{ status: "unchecked" }>
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "ready"; capability: ScanSciCapability }>
  | Readonly<{ status: "unavailable"; error: string }>;

export type DownloadSettingsState = Readonly<{
  downloadDestination: string;
  usingDefaultDestination: boolean;
  destinationError?: string;
  runtime: DownloadRuntimeState;
}>;

export interface DownloadSettingsPorts {
  runtime: ScanSciPort;
  getPreference(key: string): string | undefined;
  setPreference(key: string, value: string): void;
  clearPreference(key: string): void;
  chooseDownloadDestination(
    current: string,
    owner?: Window,
  ): Promise<string | undefined>;
}

export interface DownloadSettingsController {
  getState(): DownloadSettingsState;
  subscribe(listener: (state: DownloadSettingsState) => void): () => void;
  changeDownloadDestination(owner?: Window): Promise<void>;
  resetDownloadDestination(): void;
  probeRuntime(): Promise<void>;
  dispose(): void;
}

export class DownloadSettingsCoordinator implements DownloadSettingsController {
  private state: DownloadSettingsState;
  private readonly listeners = new Set<
    (state: DownloadSettingsState) => void
  >();
  private operation = 0;
  private operationController?: AbortController;
  private disposed = false;

  constructor(private readonly ports: DownloadSettingsPorts) {
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
    };
  }

  getState(): DownloadSettingsState {
    return this.state;
  }

  subscribe(listener: (state: DownloadSettingsState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async changeDownloadDestination(owner?: Window): Promise<void> {
    if (this.disposed) return;
    try {
      const selected = await this.ports.chooseDownloadDestination(
        this.state.downloadDestination,
        owner,
      );
      if (this.disposed || !selected) return;
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

  async probeRuntime(): Promise<void> {
    if (this.disposed || this.state.runtime.status === "checking") return;
    this.operationController?.abort();
    const controller = new AbortController();
    this.operationController = controller;
    const operation = ++this.operation;
    this.update({ runtime: { status: "checking" } });
    try {
      const capability = await this.ports.runtime.probe({
        signal: controller.signal,
      });
      if (operation !== this.operation) return;
      this.update({ runtime: { status: "ready", capability } });
    } catch (error) {
      if (operation !== this.operation) return;
      this.update({
        runtime: { status: "unavailable", error: originalError(error) },
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.operation += 1;
    this.operationController?.abort();
    this.operationController = undefined;
    this.listeners.clear();
  }

  private update(patch: Partial<DownloadSettingsState>): void {
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

function originalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
