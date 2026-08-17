import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import { CacheSettingsCoordinator } from "../../src/application/cache-settings";
import { mountCachePreferences } from "../../src/preferences/cache-preferences";

test("Preferences exposes Cache path controls and keeps the native picker owned by Preferences", async () => {
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
  let pickerOwner: Window | undefined;
  const settings = new CacheSettingsCoordinator({
    defaultCacheRoot: () => "C:\\ZoteroData\\reference-for-zotero-cache",
    getPreference: () => undefined,
    setPreference() {},
    clearPreference() {},
    async chooseCacheRoot(_current, owner) {
      pickerOwner = owner;
      return undefined;
    },
  });
  mountCachePreferences(root, settings);

  const row = root.querySelector("[data-cache-directory-row]");
  assert.ok(row);
  assert.equal(
    row.querySelector("[data-cache-directory-label]")?.textContent?.trim(),
    "Cache 路径",
  );
  assert.equal(
    row.querySelector("[data-cache-directory-path]")?.textContent,
    "C:\\ZoteroData\\reference-for-zotero-cache",
  );
  assert.match(
    root.querySelector("[data-cache-directory-description]")?.textContent ?? "",
    /不会迁移、复制或删除旧缓存.*不会回退默认目录/u,
  );

  row
    .querySelector("[data-change-cache-directory]")
    ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pickerOwner, ownerWindow);
});
