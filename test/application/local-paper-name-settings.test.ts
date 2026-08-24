import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE,
  LOCAL_PAPER_ROOT_PREFERENCE,
  LOCAL_PAPER_ROOT_REQUIRED_ERROR,
  LocalPaperNameSettingsStore,
  type LocalPaperNameSettingsPorts,
} from "../../src/application/local-paper-name-settings";

test("local paper renaming is disabled and unconfigured by default", () => {
  const settings = new LocalPaperNameSettingsStore(memoryPorts());

  assert.deepEqual(settings.getState(), { enabled: false });
});

test("enabling requires a directory and persists both settings", async () => {
  const preferences = new Map<string, boolean | string>();
  const settings = new LocalPaperNameSettingsStore(
    memoryPorts(preferences, async () => "E:/paper/"),
  );
  const states: unknown[] = [];
  settings.subscribe((state) => states.push(state));

  settings.setEnabled(true);
  assert.deepEqual(settings.getState(), {
    enabled: true,
    error: LOCAL_PAPER_ROOT_REQUIRED_ERROR,
  });

  await settings.changePaperRoot();

  assert.deepEqual(settings.getState(), {
    enabled: true,
    paperRoot: "E:\\paper",
  });
  assert.equal(preferences.get(LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE), true);
  assert.equal(preferences.get(LOCAL_PAPER_ROOT_PREFERENCE), "E:\\paper");
  assert.equal(states.length, 2);
});

test("stored directory does not enable local renaming by itself", () => {
  const preferences = new Map<string, boolean | string>([
    [LOCAL_PAPER_ROOT_PREFERENCE, "D:\\Papers"],
  ]);
  const settings = new LocalPaperNameSettingsStore(memoryPorts(preferences));

  assert.deepEqual(settings.getState(), {
    enabled: false,
    paperRoot: "D:\\Papers",
  });
});

function memoryPorts(
  preferences = new Map<string, boolean | string>(),
  choosePaperRoot: LocalPaperNameSettingsPorts["choosePaperRoot"] = async () =>
    undefined,
): LocalPaperNameSettingsPorts {
  return {
    getBooleanPreference(key) {
      const value = preferences.get(key);
      return typeof value === "boolean" ? value : undefined;
    },
    getStringPreference(key) {
      const value = preferences.get(key);
      return typeof value === "string" ? value : undefined;
    },
    setBooleanPreference(key, value) {
      preferences.set(key, value);
    },
    setStringPreference(key, value) {
      preferences.set(key, value);
    },
    choosePaperRoot,
  };
}
