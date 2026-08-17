import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  OPENALEX_API_KEY_PREFERENCE,
  OpenAlexSettingsStore,
} from "../../src/application/openalex-settings";
import {
  mountOpenAlexPreferences,
  OPENALEX_SETTINGS_URL,
} from "../../src/preferences/download-preferences";

test("OpenAlex API Key is locally saved, hidden by default, and restored after reload", () => {
  const preferences = new Map<string, string>();
  const writes: Array<readonly [string, string]> = [];
  const store = new OpenAlexSettingsStore({
    get: (key) => preferences.get(key),
    set(key, value) {
      preferences.set(key, value);
      writes.push([key, value]);
    },
  });
  const opened: string[] = [];
  const first = preferencesDocument();
  const row = requiredElement(first.root, "[data-openalex-api-row]");
  const cacheError = requiredElement(
    first.root,
    "[data-cache-directory-error]",
  );
  const label = requiredElement(row, "[data-openalex-api-label]");
  const input = requiredElement<HTMLInputElement>(
    row,
    "[data-openalex-api-key]",
  );
  const toggle = requiredElement<HTMLButtonElement>(
    row,
    "[data-toggle-openalex-api-key]",
  );
  const link = requiredElement<HTMLAnchorElement>(
    row,
    "[data-openalex-api-registration]",
  );
  const mounted = mountOpenAlexPreferences(first.root, store, (url) =>
    opened.push(url),
  );

  assert.equal(cacheError.nextElementSibling, row);
  assert.equal(label.textContent?.trim(), "OpenAlex API：");
  assert.equal(link.getAttribute("href"), OPENALEX_SETTINGS_URL);
  assert.match(link.textContent ?? "", /免费注册\/获取 API Key/u);
  assert.match(row.textContent ?? "", /仅保存在本地/u);
  assert.match(row.textContent ?? "", /提高摘要查询可用性/u);
  assert.equal(input.type, "password");
  assert.equal(input.value, "");
  assert.equal(toggle.getAttribute("aria-label"), "显示 OpenAlex API Key");

  input.value = "  test-openalex-secret  ";
  input.dispatchEvent(new first.dom.window.Event("input", { bubbles: true }));
  assert.equal(input.type, "password");
  input.dispatchEvent(new first.dom.window.Event("change", { bubbles: true }));
  assert.deepEqual(writes, [
    [OPENALEX_API_KEY_PREFERENCE, "test-openalex-secret"],
  ]);

  toggle.click();
  assert.equal(input.type, "text");
  assert.equal(input.value, "  test-openalex-secret  ");
  assert.equal(toggle.getAttribute("aria-label"), "隐藏 OpenAlex API Key");
  toggle.click();
  assert.equal(input.type, "password");
  assert.equal(input.value, "  test-openalex-secret  ");

  link.click();
  assert.deepEqual(opened, [OPENALEX_SETTINGS_URL]);
  mounted.destroy();

  const reloaded = preferencesDocument();
  const reloadedInput = requiredElement<HTMLInputElement>(
    reloaded.root,
    "[data-openalex-api-key]",
  );
  const reloadedMount = mountOpenAlexPreferences(
    reloaded.root,
    new OpenAlexSettingsStore({
      get: (key) => preferences.get(key),
      set: () => undefined,
    }),
    () => undefined,
  );
  assert.equal(reloadedInput.type, "password");
  assert.equal(reloadedInput.value, "test-openalex-secret");
  reloadedMount.destroy();
});

test("an empty OpenAlex API Key is treated as unconfigured", () => {
  const values = new Map([[OPENALEX_API_KEY_PREFERENCE, "   "]]);
  const store = new OpenAlexSettingsStore({
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
  });

  assert.equal(store.getApiKey(), undefined);
  store.setApiKey(" \t ");
  assert.equal(values.get(OPENALEX_API_KEY_PREFERENCE), "");
  assert.equal(store.getApiKey(), undefined);
});

function preferencesDocument(): Readonly<{ dom: JSDOM; root: Element }> {
  const fragment = readFileSync(
    new URL("../../addon/chrome/content/preferences.xhtml", import.meta.url),
    "utf8",
  )
    .replaceAll("html:", "")
    .replace(' xmlns:html="http://www.w3.org/1999/xhtml"', "");
  const dom = new JSDOM(`<!doctype html><body>${fragment}</body>`);
  const root = dom.window.document.querySelector(
    "[data-reference-for-zotero-preferences]",
  );
  assert.ok(root);
  return { dom, root };
}

function requiredElement<T extends Element = Element>(
  root: Element,
  selector: string,
): T {
  const element = root.querySelector(selector);
  assert.ok(element);
  return element as T;
}
