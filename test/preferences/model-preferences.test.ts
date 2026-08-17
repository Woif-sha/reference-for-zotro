import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import type { ModelPreferencesController } from "../../src/application/model-settings";
import {
  DEFAULT_MODEL_CONFIGURATION,
  flattenRuntimeModels,
  type ModelProvider,
  type ModelProviderConfiguration,
  type ProviderModel,
} from "../../src/model/model-configuration";
import { mountModelPreferences } from "../../src/preferences/model-preferences";

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
