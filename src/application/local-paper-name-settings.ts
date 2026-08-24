import { validateWindowsAbsolutePath } from "./download-settings";

export const LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE =
  "extensions.referenceforzotero.localPaperNameSyncEnabled";
export const LOCAL_PAPER_ROOT_PREFERENCE =
  "extensions.referenceforzotero.localPaperRoot";
export const LOCAL_PAPER_ROOT_REQUIRED_ERROR = "请先选择本地论文目录。";

export type LocalPaperNameSettingsState = Readonly<{
  enabled: boolean;
  paperRoot?: string;
  error?: string;
}>;

export interface LocalPaperNameSettingsPorts {
  getBooleanPreference(key: string): boolean | undefined;
  getStringPreference(key: string): string | undefined;
  setBooleanPreference(key: string, value: boolean): void;
  setStringPreference(key: string, value: string): void;
  choosePaperRoot(
    current?: string,
    owner?: Window,
  ): Promise<string | undefined>;
}

export interface LocalPaperNameSettingsController {
  getState(): LocalPaperNameSettingsState;
  subscribe(listener: (state: LocalPaperNameSettingsState) => void): () => void;
  setEnabled(enabled: boolean): void;
  changePaperRoot(owner?: Window): Promise<void>;
  dispose(): void;
}

export class LocalPaperNameSettingsStore implements LocalPaperNameSettingsController {
  private state: LocalPaperNameSettingsState;
  private readonly listeners = new Set<
    (state: LocalPaperNameSettingsState) => void
  >();
  private disposed = false;

  constructor(private readonly ports: LocalPaperNameSettingsPorts) {
    const enabled =
      ports.getBooleanPreference(LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE) ===
      true;
    const configuredRoot = ports
      .getStringPreference(LOCAL_PAPER_ROOT_PREFERENCE)
      ?.trim();
    let paperRoot: string | undefined;
    let error: string | undefined;
    if (configuredRoot) {
      try {
        paperRoot = validateWindowsAbsolutePath(
          configuredRoot,
          "Local paper root",
        );
      } catch (cause) {
        error = errorMessage(cause);
      }
    } else if (enabled) {
      error = LOCAL_PAPER_ROOT_REQUIRED_ERROR;
    }
    this.state = {
      enabled,
      ...(paperRoot ? { paperRoot } : {}),
      ...(error ? { error } : {}),
    };
  }

  getState(): LocalPaperNameSettingsState {
    return this.state;
  }

  subscribe(
    listener: (state: LocalPaperNameSettingsState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed || enabled === this.state.enabled) return;
    this.ports.setBooleanPreference(
      LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE,
      enabled,
    );
    this.update({
      enabled,
      error:
        enabled && !this.state.paperRoot
          ? LOCAL_PAPER_ROOT_REQUIRED_ERROR
          : undefined,
    });
  }

  async changePaperRoot(owner?: Window): Promise<void> {
    if (this.disposed) return;
    try {
      const selected = await this.ports.choosePaperRoot(
        this.state.paperRoot,
        owner,
      );
      if (this.disposed || !selected) return;
      const paperRoot = validateWindowsAbsolutePath(
        selected,
        "Local paper root",
      );
      this.ports.setStringPreference(LOCAL_PAPER_ROOT_PREFERENCE, paperRoot);
      this.update({ paperRoot, error: undefined });
    } catch (cause) {
      this.update({ error: errorMessage(cause) });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  private update(patch: Partial<LocalPaperNameSettingsState>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...patch };
    this.state = {
      enabled: next.enabled,
      ...(next.paperRoot ? { paperRoot: next.paperRoot } : {}),
      ...(next.error ? { error: next.error } : {}),
    };
    for (const listener of this.listeners) listener(this.state);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
