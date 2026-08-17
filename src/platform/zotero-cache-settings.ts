import type { CacheSettingsPorts } from "../application/cache-settings";
import { chooseZoteroDirectory } from "./zotero-directory-picker";

export function createZoteroCacheSettingsPorts(): CacheSettingsPorts {
  return {
    defaultCacheRoot: zoteroDefaultCacheRoot,
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
    chooseCacheRoot(current, owner) {
      return chooseZoteroDirectory({
        title: "Choose Reference for Zotero Cache root",
        current,
        owner,
      });
    },
  };
}

export function zoteroDefaultCacheRoot(): string {
  const dataDirectory = (
    Zotero as typeof Zotero & { DataDirectory?: { dir?: string } }
  ).DataDirectory?.dir?.trim();
  if (!dataDirectory) throw new Error("Cannot resolve Zotero data directory");
  return joinWindows(dataDirectory, "reference-for-zotero-cache");
}

function joinWindows(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/u, "")}\\${right.replace(/^[\\/]+/u, "")}`;
}
