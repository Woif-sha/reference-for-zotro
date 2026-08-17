import type { ScanSciCapability, ScanSciPort } from "../scansci/scan-sci-port";

export const DOWNLOAD_DESTINATION_PREFERENCE =
  "extensions.referenceforzotero.downloadDestination";
export const DOWNLOAD_CACHE_DIRECTORY_PREFERENCE =
  "extensions.referenceforzotero.cacheRoot";
export const DOWNLOAD_DESTINATION_REQUIRED_ERROR = "请先配置下载目录。";
export const CACHE_DIRECTORY_REQUIRED_ERROR = "请先配置 Cache 路径。";

export type DownloadRuntimeState =
  | Readonly<{ status: "unchecked" }>
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "ready"; capability: ScanSciCapability }>
  | Readonly<{ status: "unavailable"; error: string }>;

export type DownloadSettingsState = Readonly<{
  downloadDestination?: string;
  cacheDirectory?: string;
  destinationError?: string;
  cacheDirectoryError?: string;
  runtime: DownloadRuntimeState;
}>;

export interface DownloadSettingsPorts {
  runtime: ScanSciPort;
  getPreference(key: string): string | undefined;
  setPreference(key: string, value: string): void;
  chooseDownloadDestination(
    current?: string,
    owner?: Window,
  ): Promise<string | undefined>;
  chooseCacheDirectory(
    current?: string,
    owner?: Window,
  ): Promise<string | undefined>;
}

export interface DownloadSettingsController {
  getState(): DownloadSettingsState;
  subscribe(listener: (state: DownloadSettingsState) => void): () => void;
  changeDownloadDestination(owner?: Window): Promise<void>;
  changeCacheDirectory(owner?: Window): Promise<void>;
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
    const destination = loadConfiguredPath(
      ports.getPreference(DOWNLOAD_DESTINATION_PREFERENCE),
      "Stored download destination",
      DOWNLOAD_DESTINATION_REQUIRED_ERROR,
    );
    const cache = loadConfiguredPath(
      ports.getPreference(DOWNLOAD_CACHE_DIRECTORY_PREFERENCE),
      "Stored Cache path",
      CACHE_DIRECTORY_REQUIRED_ERROR,
    );
    this.state = {
      ...(destination.path ? { downloadDestination: destination.path } : {}),
      ...(destination.error ? { destinationError: destination.error } : {}),
      ...(cache.path ? { cacheDirectory: cache.path } : {}),
      ...(cache.error ? { cacheDirectoryError: cache.error } : {}),
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
      this.update({ downloadDestination, destinationError: undefined });
    } catch (error) {
      this.update({ destinationError: originalError(error) });
    }
  }

  async changeCacheDirectory(owner?: Window): Promise<void> {
    if (this.disposed) return;
    try {
      const selected = await this.ports.chooseCacheDirectory(
        this.state.cacheDirectory,
        owner,
      );
      if (this.disposed || !selected) return;
      const cacheDirectory = validateWindowsAbsolutePath(
        selected,
        "Cache path",
      );
      this.ports.setPreference(
        DOWNLOAD_CACHE_DIRECTORY_PREFERENCE,
        cacheDirectory,
      );
      this.update({ cacheDirectory, cacheDirectoryError: undefined });
    } catch (error) {
      this.update({ cacheDirectoryError: originalError(error) });
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
    const next = { ...this.state, ...patch };
    const {
      downloadDestination,
      cacheDirectory,
      destinationError,
      cacheDirectoryError,
      runtime,
    } = next;
    this.state = {
      ...(downloadDestination ? { downloadDestination } : {}),
      ...(cacheDirectory ? { cacheDirectory } : {}),
      ...(destinationError ? { destinationError } : {}),
      ...(cacheDirectoryError ? { cacheDirectoryError } : {}),
      runtime,
    };
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

function loadConfiguredPath(
  configured: string | undefined,
  label: string,
  requiredError: string,
): Readonly<{ path?: string; error?: string }> {
  if (!configured) return { error: requiredError };
  try {
    return { path: validateWindowsAbsolutePath(configured, label) };
  } catch (error) {
    return { path: configured.trim(), error: originalError(error) };
  }
}

function originalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
