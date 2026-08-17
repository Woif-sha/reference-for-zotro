import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import { DownloadSettingsCoordinator } from "../../src/application/download-settings";
import {
  mountDownloadPreferences,
  mountModelPreferences,
  registerReferenceForZoteroPreferences,
  type PreferencePanesPort,
} from "../../src/preferences/download-preferences";
import type { ModelPreferencesController } from "../../src/application/model-settings";
import {
  DEFAULT_MODEL_CONFIGURATION,
  flattenRuntimeModels,
  type ModelProvider,
  type ModelProviderConfiguration,
  type ProviderModel,
} from "../../src/model/model-configuration";
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
    modelSettings: modelSettingsController().value,
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

test("Preferences renders provider cards, tests unsaved drafts, and cancels tests on unmount", async () => {
  const fragment = readFileSync(
    new URL("../../addon/chrome/content/preferences.xhtml", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(`<!doctype html><body>${fragment}</body>`);
  const root = dom.window.document.querySelector(
    "[data-reference-for-zotero-preferences]",
  ) as Element | null;
  assert.ok(root);
  const harness = modelSettingsController();
  const mounted = mountModelPreferences(root, harness.value);

  const active = root.querySelector<HTMLSelectElement>(
    "[data-active-model-select]",
  );
  assert.ok(active);
  assert.deepEqual(
    Array.from(active.options, (option) => option.textContent),
    ["Legacy Codex / gpt-5.4"],
  );
  active.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.deepEqual(harness.selected, ["model-codex"]);

  const defaultCard = root.querySelector("[data-provider-card]");
  assert.ok(defaultCard);
  assert.deepEqual(
    Array.from(
      defaultCard.querySelectorAll<HTMLOptionElement>(
        "[data-provider-auth-mode] option",
      ),
      (option) => option.value,
    ),
    ["codex_auth", "openai_compatible"],
  );
  assert.equal(
    defaultCard.querySelector<HTMLSelectElement>("[data-model-effort]")?.value,
    "medium",
  );

  root
    .querySelector("[data-add-model-provider]")
    ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const cards = root.querySelectorAll<HTMLElement>("[data-provider-card]");
  assert.equal(cards.length, 2);
  const draft = cards[1];
  setInput(dom, draft, "[data-provider-name]", "Draft API");
  setInput(
    dom,
    draft,
    "[data-provider-api-base]",
    "https://api.example.com/v1",
  );
  setInput(dom, draft, "[data-provider-api-key]", "draft-secret");
  setInput(dom, draft, "[data-model-id]", "draft-model");
  assert.equal(
    draft.querySelector<HTMLInputElement>("[data-provider-api-key]")?.type,
    "password",
  );
  draft
    .querySelector("[data-test-model]")
    ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(harness.saved.length, 0);
  assert.deepEqual(
    harness.tested.map(({ provider, model }) => ({
      name: provider.name,
      apiBase: provider.apiBase,
      apiKey: provider.apiKey,
      model: model.model,
    })),
    [
      {
        name: "Draft API",
        apiBase: "https://api.example.com/v1",
        apiKey: "draft-secret",
        model: "draft-model",
      },
    ],
  );
  assert.match(draft.textContent ?? "", /连接成功：OK/u);
  assert.equal(root.textContent?.includes("Cache"), false);

  mounted.destroy();
  assert.equal(harness.cancelled, 1);
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

function modelSettingsController(): {
  value: ModelPreferencesController;
  saved: ModelProviderConfiguration[];
  selected: string[];
  tested: Array<{ provider: ModelProvider; model: ProviderModel }>;
  cancelled: number;
} {
  const harness = {
    configuration: structuredClone(DEFAULT_MODEL_CONFIGURATION),
    listeners: new Set<() => void>(),
    saved: [] as ModelProviderConfiguration[],
    selected: [] as string[],
    tested: [] as Array<{ provider: ModelProvider; model: ProviderModel }>,
    cancelled: 0,
    value: undefined as unknown as ModelPreferencesController,
  };
  harness.value = {
    getConfiguration: () => structuredClone(harness.configuration),
    subscribe(listener) {
      harness.listeners.add(listener);
      return () => harness.listeners.delete(listener);
    },
    saveConfiguration(configuration) {
      harness.saved.push(structuredClone(configuration));
      harness.configuration = structuredClone(configuration);
      for (const listener of harness.listeners) listener();
      return structuredClone(configuration);
    },
    selectActiveModel(modelId) {
      harness.selected.push(modelId);
      harness.configuration.activeModelId = modelId;
      const selected = flattenRuntimeModels(harness.configuration).find(
        (model) => model.id === modelId,
      );
      if (!selected) throw new Error(`missing model ${modelId}`);
      return selected;
    },
    async testDraftModel(provider, model) {
      harness.tested.push({
        provider: structuredClone(provider),
        model: structuredClone(model),
      });
      return "OK";
    },
    cancelConnectionTests() {
      harness.cancelled += 1;
    },
  };
  return harness;
}

function setInput(
  dom: JSDOM,
  root: Element,
  selector: string,
  value: string,
): void {
  const input = root.querySelector<HTMLInputElement>(selector);
  assert.ok(input);
  input.value = value;
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
