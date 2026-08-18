import type { DownloadSettingsPorts } from "../application/download-settings";
import { OpenAlexSettingsStore } from "../application/openalex-settings";
import type { ScanSciPort } from "../scansci/scan-sci-port";
import { chooseZoteroDirectory } from "./zotero-directory-picker";

export function createZoteroDownloadSettingsPorts(options: {
  runtime: ScanSciPort;
}): DownloadSettingsPorts {
  return {
    runtime: options.runtime,
    getPreference(key) {
      const value = Zotero.Prefs.get(key, true);
      return typeof value === "string" && value.trim() ? value : undefined;
    },
    setPreference(key, value) {
      Zotero.Prefs.set(key, value, true);
    },
    chooseDownloadDestination(current, owner) {
      return chooseZoteroDirectory({
        title: "Choose download destination",
        current,
        owner,
      });
    },
    chooseCacheDirectory(current, owner) {
      return chooseZoteroDirectory({
        title: "Choose ScanSci Cache directory",
        current,
        owner,
      });
    },
  };
}

export function createZoteroOpenAlexSettings(): OpenAlexSettingsStore {
  return new OpenAlexSettingsStore({
    get(key) {
      const value = Zotero.Prefs.get(key, true);
      return typeof value === "string" ? value : undefined;
    },
    set(key, value) {
      Zotero.Prefs.set(key, value, true);
    },
  });
}

export function zoteroSidecarDataRoot(): string {
  const dataDirectory = (
    Zotero as typeof Zotero & { DataDirectory?: { dir?: string } }
  ).DataDirectory?.dir?.trim();
  if (!dataDirectory) throw new Error("Cannot resolve Zotero data directory");
  return joinWindows(dataDirectory, "reference-for-zotero-sidecar\\v3");
}

function joinWindows(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/u, "")}\\${right.replace(/^[\\/]+/u, "")}`;
}
