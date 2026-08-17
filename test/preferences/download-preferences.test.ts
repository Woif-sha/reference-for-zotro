import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import { DownloadSettingsCoordinator } from "../../src/application/download-settings";
import { mountDownloadPreferences } from "../../src/preferences/download-preferences";
import type { ScanSciPort } from "../../src/scansci/scan-sci-port";

test("Preferences exposes one read-only download row and updates it only after confirmation", async () => {
  const fragment = readFileSync(
    new URL("../../addon/chrome/content/preferences.xhtml", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(`<!doctype html><body>${fragment}</body>`);
  const ownerWindow = dom.window as unknown as Window;
  const root = dom.window.document.querySelector(
    "[data-reference-for-zotero-preferences]",
  );
  assert.ok(root);
  const writes: Array<readonly [string, string]> = [];
  let selected: string | undefined = "D:\\Selected\\Papers";
  let pickerCalls = 0;
  let pickerOwner: Window | undefined;
  const settings = settingsController({
    setPreference(key, value) {
      writes.push([key, value]);
    },
    async chooseDownloadDestination(_current, owner) {
      pickerCalls += 1;
      pickerOwner = owner;
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
  assert.equal(root.textContent?.includes("Cache 路径"), true);
  assert.ok(root.querySelector("[data-recommendation-model-settings]"));

  button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pickerOwner, ownerWindow);
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
    chooseDownloadDestination(
      current: string,
      owner?: Window,
    ): Promise<string | undefined>;
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
