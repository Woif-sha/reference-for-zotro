import {
  LocalPaperNameSettingsStore,
  type LocalPaperNameSettingsController,
} from "../application/local-paper-name-settings";
import { chooseZoteroDirectory } from "./zotero-directory-picker";

export function createZoteroLocalPaperNameSettings(): LocalPaperNameSettingsController {
  return new LocalPaperNameSettingsStore({
    getBooleanPreference(key) {
      const value = Zotero.Prefs.get(key, true);
      return typeof value === "boolean" ? value : undefined;
    },
    getStringPreference(key) {
      const value = Zotero.Prefs.get(key, true);
      return typeof value === "string" && value.trim() ? value : undefined;
    },
    setBooleanPreference(key, value) {
      Zotero.Prefs.set(key, value, true);
    },
    setStringPreference(key, value) {
      Zotero.Prefs.set(key, value, true);
    },
    choosePaperRoot(current, owner) {
      return chooseZoteroDirectory({
        title: "Choose local paper directory",
        current,
        owner,
      });
    },
  });
}
