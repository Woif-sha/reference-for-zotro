import { validateWindowsAbsolutePath } from "./download-settings";

export const CACHE_ROOT_PREFERENCE = "extensions.referenceforzotero.cacheRoot";

export type CacheSettingsState = Readonly<{
  cacheRoot: string;
  usingDefaultRoot: boolean;
  rootError?: string;
}>;

export interface CacheSettingsPorts {
  defaultCacheRoot(): string;
  getPreference(key: string): string | undefined;
  setPreference(key: string, value: string): void;
  clearPreference(key: string): void;
  chooseCacheRoot(current: string, owner?: Window): Promise<string | undefined>;
}

export interface CacheSettingsController {
  getState(): CacheSettingsState;
  cacheRoot(): string;
  subscribe(listener: (state: CacheSettingsState) => void): () => void;
  changeCacheRoot(owner?: Window): Promise<void>;
  resetCacheRoot(): void;
  dispose(): void;
}

export class CacheSettingsCoordinator implements CacheSettingsController {
  private state: CacheSettingsState;
  private readonly listeners = new Set<(state: CacheSettingsState) => void>();
  private disposed = false;

  constructor(private readonly ports: CacheSettingsPorts) {
    const configuredRoot = ports.getPreference(CACHE_ROOT_PREFERENCE);
    if (!configuredRoot) {
      this.state = {
        cacheRoot: this.defaultRoot(),
        usingDefaultRoot: true,
      };
      return;
    }
    try {
      this.state = {
        cacheRoot: validateWindowsAbsolutePath(
          configuredRoot,
          "Stored Cache root",
        ),
        usingDefaultRoot: false,
      };
    } catch (error) {
      this.state = {
        cacheRoot: configuredRoot.trim(),
        usingDefaultRoot: false,
        rootError: originalError(error),
      };
    }
  }

  getState(): CacheSettingsState {
    if (!this.state.usingDefaultRoot) return this.state;
    return { ...this.state, cacheRoot: this.defaultRoot() };
  }

  cacheRoot(): string {
    const state = this.getState();
    if (state.rootError) throw new Error(state.rootError);
    return state.cacheRoot;
  }

  subscribe(listener: (state: CacheSettingsState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async changeCacheRoot(owner?: Window): Promise<void> {
    if (this.disposed) return;
    try {
      const selected = await this.ports.chooseCacheRoot(
        this.getState().cacheRoot,
        owner,
      );
      if (this.disposed || !selected) return;
      const cacheRoot = validateWindowsAbsolutePath(selected, "Cache root");
      this.ports.setPreference(CACHE_ROOT_PREFERENCE, cacheRoot);
      this.update({ cacheRoot, usingDefaultRoot: false, rootError: undefined });
    } catch (error) {
      this.update({ rootError: originalError(error) });
    }
  }

  resetCacheRoot(): void {
    if (this.disposed) return;
    try {
      this.ports.clearPreference(CACHE_ROOT_PREFERENCE);
      this.update({
        cacheRoot: this.defaultRoot(),
        usingDefaultRoot: true,
        rootError: undefined,
      });
    } catch (error) {
      this.update({ rootError: originalError(error) });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  private defaultRoot(): string {
    return validateWindowsAbsolutePath(
      this.ports.defaultCacheRoot(),
      "Default Cache root",
    );
  }

  private update(patch: Partial<CacheSettingsState>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...patch };
    this.state = next.rootError
      ? next
      : {
          cacheRoot: next.cacheRoot,
          usingDefaultRoot: next.usingDefaultRoot,
        };
    for (const listener of this.listeners) listener(this.getState());
  }
}

function originalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
