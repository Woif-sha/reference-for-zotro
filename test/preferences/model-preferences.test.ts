import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import type { ModelPreferencesController } from "../../src/application/model-settings";
import {
  DEFAULT_MODEL_CONFIGURATION,
  LEGACY_CODEX_RESPONSES_ENDPOINT,
  createProviderModel,
  flattenRuntimeModels,
  type ModelProvider,
  type ModelProviderConfiguration,
  type ProviderModel,
} from "../../src/model/model-configuration";
import { mountModelPreferences } from "../../src/preferences/model-preferences";
import type { DiscoveredModel } from "../../src/model/model-catalog";

test("Preferences matches Paper Translate provider cards without visible Legacy UI", async () => {
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

  assert.equal(root.querySelector("[data-active-model-select]"), null);
  assert.doesNotMatch(root.textContent ?? "", /legacy/iu);

  const defaultCard = root.querySelector("[data-provider-card]");
  assert.ok(defaultCard);
  assert.equal(
    defaultCard.querySelector<HTMLInputElement>("[data-model-id]")?.hidden,
    true,
  );
  assert.equal(
    defaultCard.querySelector<HTMLSelectElement>(".pt-provider-model-select")
      ?.hidden,
    false,
  );
  assert.equal(
    defaultCard.querySelector<HTMLInputElement>("[data-provider-name]")?.value,
    "服务商 A",
  );
  assert.deepEqual(
    Array.from(
      defaultCard.querySelectorAll<HTMLOptionElement>(
        "[data-provider-auth-mode] option",
      ),
      (option) => [option.value, option.textContent],
    ),
    [
      ["codex_auth", "Codex Auth"],
      ["openai_compatible", "OpenAI Compatible"],
    ],
  );
  assert.deepEqual(
    Array.from(
      defaultCard.querySelectorAll<HTMLOptionElement>(
        "[data-model-effort] option",
      ),
      (option) => option.value,
    ),
    ["auto", "low", "medium", "high", "xhigh"],
  );
  assert.equal(
    defaultCard.querySelector<HTMLSelectElement>("[data-model-effort]")?.value,
    "medium",
  );
  assert.equal(
    defaultCard.querySelector<HTMLButtonElement>("[data-use-model]")
      ?.textContent,
    "当前",
  );

  root
    .querySelector("[data-add-model-provider]")
    ?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const cards = root.querySelectorAll<HTMLElement>("[data-provider-card]");
  assert.equal(cards.length, 2);
  const draft = cards[1];
  assert.equal(
    draft.querySelector<HTMLInputElement>("[data-provider-name]")?.value,
    "服务商 B",
  );
  setInput(dom, draft, "[data-provider-name]", "Draft API");
  setInput(
    dom,
    draft,
    "[data-provider-api-base]",
    "https://api.example.com/v1",
  );
  setInput(dom, draft, "[data-provider-api-key]", "draft-secret");
  const modelSelect = draft.querySelector<HTMLSelectElement>(
    ".pt-provider-model-select",
  );
  assert.ok(modelSelect);
  modelSelect.selectedIndex = modelSelect.options.length - 1;
  modelSelect.dispatchEvent(new dom.window.Event("change"));
  await new Promise<void>((resolve) => setImmediate(resolve));
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
  assert.equal(root.textContent?.includes("Cache 路径"), true);

  mounted.destroy();
  assert.equal(harness.cancelled, 1);
});

function modelSettingsController(options?: {
  configuration?: ModelProviderConfiguration;
  loadModels?(
    provider: ModelProvider,
    signal: AbortSignal,
  ): Promise<DiscoveredModel[]>;
}): {
  value: ModelPreferencesController;
  saved: ModelProviderConfiguration[];
  selected: string[];
  tested: Array<{ provider: ModelProvider; model: ProviderModel }>;
  cancelled: number;
  loaded: Array<{ provider: ModelProvider; signal: AbortSignal }>;
} {
  const harness = {
    configuration: structuredClone(
      options?.configuration ?? DEFAULT_MODEL_CONFIGURATION,
    ),
    listeners: new Set<() => void>(),
    saved: [] as ModelProviderConfiguration[],
    selected: [] as string[],
    tested: [] as Array<{ provider: ModelProvider; model: ProviderModel }>,
    cancelled: 0,
    loaded: [] as Array<{ provider: ModelProvider; signal: AbortSignal }>,
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
    async loadModels(provider, signal): Promise<DiscoveredModel[]> {
      harness.loaded.push({ provider: structuredClone(provider), signal });
      return options?.loadModels?.(provider, signal) ?? [];
    },
    cancelConnectionTests() {
      harness.cancelled += 1;
    },
  };
  return harness;
}

function preferencesFixture(
  options?: Parameters<typeof modelSettingsController>[0],
) {
  const fragment = readFileSync(
    new URL("../../addon/chrome/content/preferences.xhtml", import.meta.url),
    "utf8",
  );
  const dom = new JSDOM(`<!doctype html><body>${fragment}</body>`);
  const root = dom.window.document.querySelector(
    "[data-reference-for-zotero-preferences]",
  ) as Element;
  const harness = modelSettingsController(options);
  const mounted = mountModelPreferences(root, harness.value);
  return {
    dom,
    root,
    harness,
    mounted,
    dispose() {
      mounted.destroy();
      dom.window.close();
    },
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

for (const authMode of ["codex_auth", "openai_compatible"] as const) {
  test(`${authMode} rows automatically share a catalog, preserve saved IDs and refresh without saving`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const configuration = structuredClone(DEFAULT_MODEL_CONFIGURATION);
    const provider = configuration.providers[0];
    provider.authMode = authMode;
    provider.apiBase =
      authMode === "codex_auth"
        ? LEGACY_CODEX_RESPONSES_ENDPOINT
        : "https://api.example.com/v1";
    provider.apiKey = authMode === "codex_auth" ? "" : "secret";
    provider.models.push(createProviderModel());
    const f = preferencesFixture({
      configuration,
      loadModels: async () => [
        { id: "newest", name: "Newest" },
        { id: "older", name: "Older" },
      ],
    });
    try {
      assert.equal(f.harness.loaded.length, 0);
      t.mock.timers.tick(300);
      await flush();
      assert.equal(f.harness.loaded.length, 1);
      const selects = Array.from(
        f.root.querySelectorAll<HTMLSelectElement>(".pt-provider-model-select"),
      );
      assert.deepEqual(
        Array.from(selects[0].options, (option) => option.value).slice(0, -1),
        ["newest", "older", provider.models[0].model],
      );
      assert.equal(selects[0].value, provider.models[0].model);
      assert.equal(selects[1].value, "");
      assert.equal(selects[1].options[0].disabled, true);
      selects[1].value = "newest";
      selects[1].dispatchEvent(new f.dom.window.Event("change"));
      await flush();
      assert.equal(
        f.root.querySelectorAll<HTMLInputElement>("[data-model-id]")[1].value,
        "newest",
      );
      f.root
        .querySelector<HTMLButtonElement>(".pt-provider-model-refresh")!
        .click();
      await flush();
      assert.equal(f.harness.loaded.length, 2);
      assert.equal(f.harness.saved.length, 0);
      assert.deepEqual(f.harness.selected, []);
    } finally {
      f.dispose();
    }
  });
}

test("editing connection fields cancels obsolete catalogs and switching to Codex loads before saving", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const configuration = structuredClone(DEFAULT_MODEL_CONFIGURATION);
  const provider = configuration.providers[0];
  provider.authMode = "openai_compatible";
  provider.apiBase = "";
  provider.apiKey = "";
  const pending: Array<(models: DiscoveredModel[]) => void> = [];
  const f = preferencesFixture({
    configuration,
    loadModels: () =>
      new Promise((resolve) => {
        pending.push(resolve);
      }),
  });
  try {
    t.mock.timers.tick(300);
    await flush();
    assert.equal(f.harness.loaded.length, 0);
    setInput(
      f.dom,
      f.root,
      "[data-provider-api-base]",
      "https://api.example.com",
    );
    setInput(f.dom, f.root, "[data-provider-api-key]", "first-key");
    t.mock.timers.tick(300);
    await flush();
    assert.equal(f.harness.loaded.length, 1);
    setInput(f.dom, f.root, "[data-provider-api-key]", "second-key");
    assert.equal(f.harness.loaded[0].signal.aborted, true);
    pending[0]([{ id: "obsolete", name: "" }]);
    await flush();
    assert.equal(f.root.querySelector('option[value="obsolete"]'), null);
    t.mock.timers.tick(300);
    await flush();
    assert.equal(f.harness.loaded[1].provider.apiKey, "second-key");
    pending[1]([{ id: "api-model", name: "" }]);
    await flush();
    assert.ok(f.root.querySelector('option[value="api-model"]'));
    const auth = f.root.querySelector<HTMLSelectElement>(
      "[data-provider-auth-mode]",
    )!;
    auth.value = "codex_auth";
    auth.dispatchEvent(new f.dom.window.Event("change"));
    t.mock.timers.tick(300);
    await flush();
    assert.equal(f.harness.loaded[2].provider.authMode, "codex_auth");
    assert.equal(
      f.harness.loaded[2].provider.apiBase,
      LEGACY_CODEX_RESPONSES_ENDPOINT,
    );
    assert.equal(f.harness.loaded[2].provider.apiKey, "");
    assert.equal(f.harness.saved.length, 0);
    f.mounted.destroy();
    assert.equal(f.harness.loaded[2].signal.aborted, true);
    pending[2]([{ id: "late-codex", name: "" }]);
    await flush();
    assert.equal(f.root.querySelector("[data-provider-card]"), null);
  } finally {
    f.dispose();
  }
});

test("bulk model selection searches and adds candidates without applying them until use", async () => {
  const existing = DEFAULT_MODEL_CONFIGURATION.providers[0].models[0].model;
  const f = preferencesFixture({
    loadModels: async () => [
      { id: "new-model", name: "Fresh model" },
      { id: "other-model", name: "Other" },
      { id: existing, name: "Saved" },
      { id: "text-embedding-3-small", name: "Embedding" },
    ],
  });
  try {
    f.root
      .querySelector<HTMLButtonElement>("[data-choose-provider-models]")!
      .click();
    await flush();
    const dialog = f.root.querySelector<HTMLDialogElement>("dialog")!;
    const checkbox = (id: string) =>
      dialog.querySelector<HTMLInputElement>(`input[value="${id}"]`)!;
    assert.equal(checkbox(existing).disabled, true);
    assert.equal(
      checkbox("text-embedding-3-small").closest<HTMLElement>("label")!.hidden,
      true,
    );
    const search = dialog.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    search.value = "Fresh";
    search.dispatchEvent(new f.dom.window.Event("input"));
    assert.equal(
      checkbox("new-model").closest<HTMLElement>("label")!.hidden,
      false,
    );
    assert.equal(
      checkbox("other-model").closest<HTMLElement>("label")!.hidden,
      true,
    );
    checkbox("new-model").click();
    search.value = "";
    search.dispatchEvent(new f.dom.window.Event("input"));
    checkbox("other-model").click();
    dialog.querySelector<HTMLButtonElement>(".pt-save-button")!.click();
    assert.equal(f.root.querySelector("dialog"), null);
    assert.deepEqual(
      Array.from(
        f.root.querySelectorAll<HTMLInputElement>("[data-model-id]"),
        (input) => input.value,
      ),
      [existing, "new-model", "other-model"],
    );
    assert.equal(f.harness.saved.length, 0);
    assert.deepEqual(f.harness.selected, []);
    const modelRow =
      f.root.querySelectorAll<HTMLElement>("[data-model-row]")[1];
    modelRow.querySelector<HTMLButtonElement>("[data-use-model]")!.click();
    assert.equal(f.harness.saved.length, 1);
    assert.equal(f.harness.saved[0].providers[0].models.length, 3);
    assert.equal(f.harness.selected.length, 1);
    assert.equal(
      f.root.querySelectorAll<HTMLButtonElement>("[data-use-model]")[1]
        .textContent,
      "当前",
    );
  } finally {
    f.dispose();
  }
});

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
