import { FilePickerHelper } from "zotero-plugin-toolkit";
import type { DownloadFirstUsePorts } from "../application/download-first-use";
import type { ScanSciPort } from "../scansci/scan-sci-port";

const BROWSER_POLICY_PATH =
  "python/reference_for_zotero_scansci/browser-runtime-policy-v3.json";

export function createZoteroDownloadFirstUsePorts(options: {
  runtime: ScanSciPort;
  packagedRootURI: string;
}): DownloadFirstUsePorts {
  return {
    runtime: options.runtime,
    getPreference(key) {
      const value = Zotero.Prefs.get(key, true);
      return typeof value === "string" && value.trim() ? value : undefined;
    },
    setPreference(key, value) {
      Zotero.Prefs.set(key, value, true);
    },
    clearPreference(key) {
      Zotero.Prefs.clear(key, true);
    },
    async chooseDownloadDestination(current) {
      const selected = await new FilePickerHelper(
        "Choose download destination",
        "folder",
        undefined,
        undefined,
        Zotero.getMainWindow(),
        undefined,
        current,
      ).open();
      return selected || undefined;
    },
    async choosePythonExecutable() {
      const selected = await new FilePickerHelper(
        "Choose Python executable",
        "open",
        [["Python executable", "python.exe"]],
        "python.exe",
        Zotero.getMainWindow(),
        "apps",
      ).open();
      return selected || undefined;
    },
    async loadBrowserRuntimePolicy() {
      const response = await fetch(
        `${options.packagedRootURI}${BROWSER_POLICY_PATH}`,
      );
      if (!response.ok) {
        throw new Error(
          `Packaged institution browser policy is unavailable: ${response.status}`,
        );
      }
      return response.json() as Promise<unknown>;
    },
  };
}

export function zoteroPrivateRuntimeRoot(): string {
  const dataDirectory = (
    Zotero as typeof Zotero & { DataDirectory?: { dir?: string } }
  ).DataDirectory?.dir?.trim();
  if (!dataDirectory) throw new Error("Cannot resolve Zotero data directory");
  return joinWindows(dataDirectory, "reference-for-zotero-runtime\\v3");
}

function joinWindows(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/u, "")}\\${right.replace(/^[/\\]+/u, "")}`;
}
