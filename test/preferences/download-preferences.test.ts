import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import { DownloadSettingsCoordinator } from "../../src/application/download-settings";
import {
  mountDownloadPreferences,
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

  const settings = settingsController({
    async chooseDownloadDestination() {
      pickerCalls += 1;
      return undefined;
    },
  });
  const handle = await registerReferenceForZoteroPreferences({
    manager,
    pluginID: "referenceforzotero@woif-sha.github.io",
    rootURI: "resource://reference-for-zotero/",
    settings,
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
  );
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

test("Preferences exposes one read-only download row and updates it only after confirmation", async () => {
  const fragment = readFileSync(
    new URL("../../addon/chrome/content/preferences.xhtml", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(`<!doctype html><body>${fragment}</body>`);
  const root = dom.window.document.querySelector(
    "[data-reference-for-zotero-preferences]",
  );
  assert.ok(root);
  const writes: Array<readonly [string, string]> = [];
  let selected: string | undefined = "D:\\Selected\\Papers";
  let pickerCalls = 0;
  const settings = settingsController({
    setPreference(key, value) {
      writes.push([key, value]);
    },
    async chooseDownloadDestination() {
      pickerCalls += 1;
      return selected;
    },
  });
  const mounted = mountDownloadPreferences(root, settings);

  const row = root.querySelector("[data-download-directory-row]");
  const label = row?.querySelector("[data-download-directory-label]");
  const path = row?.querySelector("[data-download-directory-path]");
  const button = row?.querySelector("[data-change-download-directory]");
  assert.ok(row && label && path && button);
  assert.equal(label.textContent?.trim(), "下载目录");
  assert.match(path.localName, /(?:^|:)span$/u);
  assert.equal(root.querySelector("input, textarea"), null);
  assert.equal(path.textContent, "E:\\paper");
  assert.equal(label.parentElement, row);
  assert.equal(path.parentElement, row);
  assert.equal(button.parentElement, row);
  assert.equal(
    button.firstElementChild?.hasAttribute("data-folder-icon"),
    true,
  );
  assert.match(button.textContent ?? "", /^\s*📁\s*更改目录\s*$/u);
  assert.equal(root.textContent?.includes("Cache"), false);
  assert.ok(root.querySelector("[data-recommendation-model-settings]"));

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(path.textContent, "D:\\Selected\\Papers");
  assert.equal(writes.length, 1);

  selected = undefined;
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(path.textContent, "D:\\Selected\\Papers");
  assert.equal(writes.length, 1);

  mounted.destroy();
  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pickerCalls, 2);
});

function settingsController(
  overrides: Partial<{
    setPreference(key: string, value: string): void;
    chooseDownloadDestination(current: string): Promise<string | undefined>;
  }> = {},
): DownloadSettingsCoordinator {
  return new DownloadSettingsCoordinator({
    runtime: unusedRuntime(),
    getPreference() {
      return undefined;
    },
    setPreference: overrides.setPreference ?? (() => undefined),
    clearPreference() {},
    chooseDownloadDestination:
      overrides.chooseDownloadDestination ?? (async () => undefined),
  });
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
