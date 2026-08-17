import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import { DownloadSettingsCoordinator } from "../../src/application/download-settings";
import type { ModelPreferencesController } from "../../src/application/model-settings";
import { DEFAULT_MODEL_CONFIGURATION } from "../../src/model/model-configuration";
import { OpenAlexSettingsStore } from "../../src/application/openalex-settings";
import {
  registerReferenceForZoteroPreferences,
  type PreferencePanesPort,
} from "../../src/preferences/download-preferences";
import type { ScanSciPort } from "../../src/scansci/scan-sci-port";

test("Reference for Zotero registers and explicitly unregisters its Preferences page", async () => {
  const registrations: unknown[] = [];
  const unregistered: string[] = [];
  let pickerCalls = 0;
  const manager: PreferencePanesPort = {
    async register(options) {
      registrations.push(options);
      return "reference-for-zotero-preferences";
    },
    unregister(id) {
      unregistered.push(id);
    },
  };

  const settings = new DownloadSettingsCoordinator({
    runtime: unusedRuntime(),
    getPreference() {
      return undefined;
    },
    setPreference() {},
    async chooseDownloadDestination() {
      pickerCalls += 1;
      return undefined;
    },
    async chooseCacheDirectory() {
      pickerCalls += 1;
      return undefined;
    },
  });
  const handle = await registerReferenceForZoteroPreferences({
    manager,
    pluginID: "referenceforzotero@woif-sha.github.io",
    rootURI: "resource://reference-for-zotero/",
    settings,
    openAlexSettings: new OpenAlexSettingsStore({
      get: () => undefined,
      set() {},
    }),
    openExternalURL() {},
    modelSettings: unusedModelSettingsController(),
  });

  assert.deepEqual(registrations, [
    {
      pluginID: "referenceforzotero@woif-sha.github.io",
      id: "reference-for-zotero-preferences",
      label: "Reference for Zotero",
      src: "resource://reference-for-zotero/chrome/content/preferences.xhtml",
      stylesheets: [
        "resource://reference-for-zotero/chrome/content/preferences.css",
      ],
    },
  ]);

  const fragment = readFileSync(
    new URL("../../addon/chrome/content/preferences.xhtml", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(`<!doctype html><body>${fragment}</body>`);
  const root = dom.window.document.querySelector(
    "[data-reference-for-zotero-preferences]",
  ) as Element | null;
  assert.ok(root);
  handle.mount(root);
  dom.window.dispatchEvent(new dom.window.Event("unload"));
  root
    .querySelector("[data-change-download-directory]")
    ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pickerCalls, 0);

  handle.unregister();
  handle.unregister();
  assert.deepEqual(unregistered, ["reference-for-zotero-preferences"]);
});

function unusedModelSettingsController(): ModelPreferencesController {
  return {
    getConfiguration: () => structuredClone(DEFAULT_MODEL_CONFIGURATION),
    subscribe: () => () => undefined,
    saveConfiguration() {
      throw new Error("not used");
    },
    selectActiveModel() {
      throw new Error("not used");
    },
    async testDraftModel() {
      throw new Error("not used");
    },
    cancelConnectionTests() {},
  };
}

function unusedRuntime(): ScanSciPort {
  return {
    async probe() {
      throw new Error("not used");
    },
    async startVisibleLogin() {
      throw new Error("not used");
    },
    async downloadPapers() {
      throw new Error("not used");
    },
  };
}
