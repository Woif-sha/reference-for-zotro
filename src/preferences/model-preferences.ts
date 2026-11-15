import type { DiscoveredModel } from "../model/model-catalog";
import { attachProviderModelSelect } from "./provider-model-select";
import { openModelPicker } from "./model-picker";
import type { ModelPreferencesController } from "../application/model-settings";
import {
  createProvider,
  createProviderModel,
  LEGACY_CODEX_RESPONSES_ENDPOINT,
  type ModelAuthMode,
  type ModelProvider,
  type ModelProviderConfiguration,
  type ProviderModel,
} from "../model/model-configuration";

type ModelSelect = ReturnType<typeof attachProviderModelSelect>;
type CatalogRequest = {
  identity: string;
  controller: AbortController;
  promise: Promise<DiscoveredModel[]>;
};
type EditorResources = {
  catalogs: Map<string, { identity: string; models: DiscoveredModel[] }>;
  requests: Map<string, CatalogRequest>;
  selects: Map<string, ModelSelect[]>;
  pickers: Map<string, () => void>;
};

export interface MountedModelPreferences {
  destroy(): void;
}

export function mountModelPreferences(
  root: Element,
  settings: ModelPreferencesController,
): MountedModelPreferences {
  const cards = requiredElement(root, "[data-model-provider-cards]");
  const addProvider = requiredElement(root, "[data-add-model-provider]");
  let configuration = settings.getConfiguration();
  let drafts = cloneProviders(configuration.providers);
  let active = true;
  const openProviderIds = new Set(drafts.map((provider) => provider.id));
  const resources: EditorResources = {
    catalogs: new Map(),
    requests: new Map(),
    selects: new Map(),
    pickers: new Map(),
  };

  const render = (): void => {
    if (!active) return;
    disposeEditorResources(resources);
    cards.replaceChildren(
      ...drafts.map((provider, providerIndex) =>
        createProviderCard({
          root,
          provider,
          providerIndex,
          configuration,
          drafts,
          settings,
          resources,
          openProviderIds,
          onDraftsChanged(next) {
            drafts = next;
            render();
          },
          onSaved(saved, savedProviderId) {
            configuration = saved;
            drafts = cloneProviders(saved.providers);
            render();
            if (!savedProviderId) return;
            const savedCard = Array.from(
              cards.querySelectorAll<HTMLElement>("[data-provider-card]"),
            ).find((entry) => entry.dataset.providerCard === savedProviderId);
            if (savedCard) showCardStatus(savedCard, "已保存", false);
          },
        }),
      ),
    );
  };

  const onAddProvider = (): void => {
    const provider = createProvider("openai_compatible");
    provider.name = nextProviderName(drafts);
    provider.models.push(createProviderModel());
    drafts = [...drafts, provider];
    openProviderIds.add(provider.id);
    render();
  };
  addProvider.addEventListener("click", onAddProvider);
  const unsubscribe = settings.subscribe(() => {
    configuration = settings.getConfiguration();
    drafts = cloneProviders(configuration.providers);
    render();
  });
  render();

  return {
    destroy() {
      if (!active) return;
      active = false;
      addProvider.removeEventListener("click", onAddProvider);
      unsubscribe();
      settings.cancelConnectionTests();
      disposeEditorResources(resources);
      resources.catalogs.clear();
      cards.replaceChildren();
    },
  };
}

type ProviderCardParams = {
  root: Element;
  provider: ModelProvider;
  providerIndex: number;
  configuration: ModelProviderConfiguration;
  drafts: ModelProvider[];
  settings: ModelPreferencesController;
  resources: EditorResources;
  openProviderIds: Set<string>;
  onDraftsChanged(providers: ModelProvider[]): void;
  onSaved(
    configuration: ModelProviderConfiguration,
    savedProviderId?: string,
  ): void;
};

function createProviderCard(params: ProviderCardParams): HTMLElement {
  const { root, provider } = params;
  const card = createHtml(root, "section");
  card.dataset.providerCard = provider.id;
  card.dataset.providerIndex = String(params.providerIndex);
  card.className = "pt-provider-card";
  const header = createProviderHeader(params, card, provider);
  const body = createHtml(root, "div");
  body.className = "pt-provider-body";
  body.id = `reference-provider-${provider.id}`;
  body.hidden = !params.openProviderIds.has(provider.id);
  header.querySelector("button")!.setAttribute("aria-controls", body.id);
  const connectionTitle = createHtml(root, "h3");
  connectionTitle.className = "pt-provider-section-title";
  connectionTitle.textContent = "连接设置";
  const name = labeledInput(root, "服务商名称", provider.name);
  name.input.placeholder = "未命名服务商";
  name.input.dataset.providerName = "";
  name.input.addEventListener("input", () => {
    provider.name = name.input.value;
    updateProviderHeader(card, provider, params.configuration.activeModelId);
  });
  body.append(connectionTitle, name.wrap);
  const removeProvider = actionButton(root, "×");
  removeProvider.title = "删除服务商";
  removeProvider.setAttribute("aria-label", "删除服务商");
  removeProvider.dataset.removeProvider = "";
  removeProvider.addEventListener("click", () => {
    if (
      provider.models.some(
        (model) => model.id === params.configuration.activeModelId,
      )
    ) {
      showCardStatus(card, "不能删除包含当前模型的服务商", true);
      return;
    }
    const next = params.drafts.filter((entry) => entry.id !== provider.id);
    if (
      params.configuration.providers.some((entry) => entry.id === provider.id)
    ) {
      try {
        const saved = params.settings.saveConfiguration({
          schemaVersion: 1,
          providers: next,
          activeModelId: params.configuration.activeModelId,
        });
        params.onSaved(saved);
      } catch (error) {
        showCardStatus(card, errorMessage(error), true);
      }
      return;
    }
    params.onDraftsChanged(next);
  });
  removeProvider.classList.add("pt-danger-button");

  const auth = labeledSelect(
    root,
    "认证方式",
    [
      ["codex_auth", "Codex Auth"],
      ["openai_compatible", "OpenAI Compatible"],
    ],
    provider.authMode,
  );
  auth.select.dataset.providerAuthMode = "";
  auth.select.addEventListener("change", () => {
    const next = auth.select.value as ModelAuthMode;
    resetProviderCatalog(params.resources, provider.id);
    provider.authMode = next;
    provider.apiBase =
      next === "codex_auth" ? LEGACY_CODEX_RESPONSES_ENDPOINT : "";
    provider.apiKey = "";
    for (const model of provider.models) {
      model.effort = next === "codex_auth" ? "medium" : "";
    }
    params.onDraftsChanged([...params.drafts]);
  });

  body.append(auth.wrap);
  if (provider.authMode === "openai_compatible") {
    const apiBase = labeledInput(root, "API Base", provider.apiBase);
    apiBase.input.placeholder = "https://api.example.com/v1";
    apiBase.input.dataset.providerApiBase = "";
    apiBase.input.addEventListener("input", () => {
      provider.apiBase = apiBase.input.value;
      resetProviderCatalog(params.resources, provider.id);
    });
    const apiKey = labeledInput(root, "API Key", provider.apiKey, "password");
    apiKey.input.placeholder = "sk-…";
    apiKey.input.autocomplete = "off";
    apiKey.input.dataset.providerApiKey = "";
    apiKey.input.addEventListener("input", () => {
      provider.apiKey = apiKey.input.value;
      resetProviderCatalog(params.resources, provider.id);
    });
    body.append(apiBase.wrap, apiKey.wrap);
  }

  const modelHeading = createHtml(root, "div");
  modelHeading.className = "pt-provider-model-heading";
  const modelTitle = createHtml(root, "strong");
  modelTitle.textContent = "模型";
  modelTitle.className = "pt-provider-section-title";
  const modelActions = createHtml(root, "div");
  modelActions.className = "pt-model-heading-actions";
  const chooseModels = actionButton(root, "批量选择模型");
  chooseModels.dataset.chooseProviderModels = "";
  chooseModels.classList.add("pt-fetch-models");
  chooseModels.addEventListener("click", () => {
    void chooseProviderModels(params, card, provider, chooseModels);
  });
  const addModel = actionButton(root, "+");
  addModel.classList.add("pt-icon-button", "pt-add-model");
  addModel.title = "添加模型";
  addModel.setAttribute("aria-label", "添加模型");
  addModel.dataset.addProviderModel = "";
  addModel.addEventListener("click", () => {
    provider.models.push(createProviderModel());
    params.onDraftsChanged([...params.drafts]);
  });
  modelActions.append(chooseModels, addModel);
  modelHeading.append(modelTitle, modelActions);
  body.append(modelHeading);

  for (const model of provider.models) {
    body.append(createModelRow(params, card, provider, model));
  }

  const footer = createHtml(root, "div");
  footer.className = "pt-provider-footer";
  const save = actionButton(root, "保存");
  save.dataset.saveProvider = "";
  save.classList.add("pt-save-button");
  save.addEventListener("click", () => {
    try {
      const saved = params.settings.saveConfiguration({
        schemaVersion: 1,
        providers: params.drafts,
        activeModelId: params.configuration.activeModelId,
      });
      params.onSaved(saved, provider.id);
    } catch (error) {
      showCardStatus(card, errorMessage(error), true);
    }
  });
  const status = createHtml(root, "div");
  status.className = "pt-provider-status";
  status.setAttribute("role", "status");
  status.dataset.providerStatus = "";
  status.hidden = true;
  footer.append(save, removeProvider);
  body.append(footer, status);
  card.append(header, body);
  updateProviderHeader(card, provider, params.configuration.activeModelId);
  return card;
}

function createModelRow(
  params: ProviderCardParams,
  card: HTMLElement,
  provider: ModelProvider,
  model: ProviderModel,
): HTMLElement {
  const row = createHtml(params.root, "div");
  row.dataset.modelRow = model.id;
  row.className = "pt-provider-model-row";
  const wrap = createHtml(params.root, "div");
  wrap.className = "pt-provider-model";
  const modelInput = createHtml(params.root, "input") as HTMLInputElement;
  modelInput.type = "text";
  modelInput.value = model.model;
  modelInput.placeholder = "模型 ID";
  modelInput.dataset.modelId = "";
  applyInputStyle(modelInput);
  modelInput.classList.add("pt-model-input");
  modelInput.addEventListener("input", () => {
    model.model = modelInput.value;
    updateProviderHeader(card, provider, params.configuration.activeModelId);
  });
  const cached = params.resources.catalogs.get(provider.id);
  const modelSelect = attachProviderModelSelect({
    input: modelInput,
    canAutoLoad: () =>
      provider.authMode === "codex_auth" ||
      Boolean(provider.apiBase.trim() && provider.apiKey.trim()),
    initialModels:
      cached?.identity === catalogIdentity(provider)
        ? cached.models
        : undefined,
    loadModels: (options) =>
      loadProviderCatalog(params, provider, options?.force),
    onModelPicked(id) {
      model.model = id;
      updateProviderHeader(card, provider, params.configuration.activeModelId);
    },
  });
  const selects = params.resources.selects.get(provider.id) ?? [];
  selects.push(modelSelect);
  params.resources.selects.set(provider.id, selects);
  row.append(modelSelect.container);

  if (provider.authMode === "codex_auth") {
    const effort = createHtml(params.root, "select") as HTMLSelectElement;
    effort.dataset.modelEffort = "";
    for (const value of ["auto", "low", "medium", "high", "xhigh"]) {
      const option = createHtml(params.root, "option") as HTMLOptionElement;
      option.value = value;
      option.textContent = value;
      effort.append(option);
    }
    effort.value = model.effort || "medium";
    applyInputStyle(effort);
    effort.style.width = "100px";
    effort.setAttribute("aria-label", "思考强度");
    effort.addEventListener("change", () => {
      model.effort = effort.value;
    });
    row.append(effort);
  }

  const use = actionButton(
    params.root,
    model.id === params.configuration.activeModelId ? "当前" : "使用",
  );
  use.dataset.useModel = model.id;
  use.disabled = model.id === params.configuration.activeModelId;
  use.addEventListener("click", () => {
    try {
      const saved = params.settings.saveConfiguration({
        schemaVersion: 1,
        providers: params.drafts,
        activeModelId: params.configuration.activeModelId,
      });
      params.settings.selectActiveModel(model.id);
      params.onSaved({ ...saved, activeModelId: model.id });
    } catch (error) {
      showCardStatus(card, errorMessage(error), true);
    }
  });
  const test = actionButton(params.root, "测试连接");
  test.dataset.testModel = model.id;
  test.addEventListener("click", () => {
    test.disabled = true;
    showCardStatus(card, "测试中…", false);
    void params.settings
      .testDraftModel(provider, model)
      .then((reply) => showCardStatus(card, `连接成功：${reply}`, false))
      .catch((error: unknown) =>
        showCardStatus(card, `连接失败：${errorMessage(error)}`, true),
      )
      .finally(() => {
        test.disabled = false;
      });
  });
  const remove = actionButton(params.root, "×");
  remove.title = "删除模型";
  remove.setAttribute("aria-label", "删除模型");
  remove.dataset.removeModel = model.id;
  remove.addEventListener("click", () => {
    if (model.id === params.configuration.activeModelId) {
      showCardStatus(card, "不能删除当前模型", true);
      return;
    }
    provider.models = provider.models.filter((entry) => entry.id !== model.id);
    params.onDraftsChanged([...params.drafts]);
  });
  row.append(use, test, remove);
  wrap.append(row, modelSelect.details);
  return wrap;
}

function labeledInput(
  root: Element,
  labelText: string,
  value: string,
  type = "text",
): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = fieldWrap(root, labelText);
  const input = createHtml(root, "input") as HTMLInputElement;
  input.type = type;
  input.value = value;
  applyInputStyle(input);
  wrap.append(input);
  return { wrap, input };
}

function labeledSelect(
  root: Element,
  labelText: string,
  options: readonly (readonly [string, string])[],
  value: string,
): { wrap: HTMLLabelElement; select: HTMLSelectElement } {
  const wrap = fieldWrap(root, labelText);
  const select = createHtml(root, "select") as HTMLSelectElement;
  for (const [optionValue, text] of options) {
    const option = createHtml(root, "option") as HTMLOptionElement;
    option.value = optionValue;
    option.textContent = text;
    select.append(option);
  }
  select.value = value;
  applyInputStyle(select);
  wrap.append(select);
  return { wrap, select };
}

function fieldWrap(root: Element, labelText: string): HTMLLabelElement {
  const wrap = createHtml(root, "label") as HTMLLabelElement;
  const span = createHtml(root, "span");
  span.textContent = labelText;
  wrap.className = "pt-provider-field";
  span.className = "pt-provider-field-label";
  wrap.append(span);
  return wrap;
}

function applyInputStyle(input: HTMLInputElement | HTMLSelectElement): void {
  input.classList.add("pt-provider-input");
}

function actionButton(root: Element, label: string): HTMLButtonElement {
  const button = createHtml(root, "button") as HTMLButtonElement;
  button.type = "button";
  button.textContent = label;
  button.className = "pt-provider-button";
  return button;
}

function showCardStatus(
  card: HTMLElement,
  message: string,
  failed: boolean,
): void {
  const status = card.querySelector<HTMLElement>("[data-provider-status]");
  if (!status) return;
  status.hidden = false;
  status.style.color = failed ? "#b42318" : "#168c68";
  status.textContent = message;
}

function nextProviderName(providers: readonly ModelProvider[]): string {
  const existing = new Set(providers.map((provider) => provider.name.trim()));
  for (let index = 0; index < 26; index += 1) {
    const candidate = `服务商 ${String.fromCharCode(65 + index)}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `服务商 ${providers.length + 1}`;
}

function cloneProviders(providers: ModelProvider[]): ModelProvider[] {
  return providers.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => ({ ...model })),
  }));
}

// Catalog sharing and picker orchestration adapted from Paper Translate
// preferenceWindow.ts at 110a74aa (AGPL-3.0-or-later).
function catalogIdentity(provider: ModelProvider): string {
  return JSON.stringify([provider.authMode, provider.apiBase, provider.apiKey]);
}

function loadProviderCatalog(
  params: ProviderCardParams,
  provider: ModelProvider,
  force = false,
): Promise<DiscoveredModel[]> {
  const { resources } = params;
  const identity = catalogIdentity(provider);
  const pending = resources.requests.get(provider.id);
  if (pending?.identity === identity) return pending.promise;
  pending?.controller.abort(new Error("模型连接已变更"));
  const cached = resources.catalogs.get(provider.id);
  if (!force && cached?.identity === identity)
    return Promise.resolve(cached.models);
  resources.catalogs.delete(provider.id);
  const controller = new AbortController();
  const promise = params.settings
    .loadModels({ ...provider }, controller.signal)
    .then((models) => {
      if (controller.signal.aborted) throw controller.signal.reason;
      resources.catalogs.set(provider.id, { identity, models });
      for (const select of resources.selects.get(provider.id) ?? [])
        select.setModels(models);
      return models;
    })
    .finally(() => {
      if (resources.requests.get(provider.id)?.controller === controller)
        resources.requests.delete(provider.id);
    });
  resources.requests.set(provider.id, { identity, controller, promise });
  return promise;
}

function resetProviderCatalog(
  resources: EditorResources,
  providerId: string,
): void {
  resources.requests
    .get(providerId)
    ?.controller.abort(new Error("模型连接已变更"));
  resources.requests.delete(providerId);
  resources.catalogs.delete(providerId);
  resources.pickers.get(providerId)?.();
  for (const select of resources.selects.get(providerId) ?? []) select.reset();
}

function disposeEditorResources(resources: EditorResources): void {
  for (const select of resources.selects.values())
    for (const component of select) component.dispose();
  resources.selects.clear();
  for (const request of resources.requests.values())
    request.controller.abort(new Error("模型设置已关闭或重绘"));
  resources.requests.clear();
  for (const close of resources.pickers.values()) close();
  resources.pickers.clear();
}

async function chooseProviderModels(
  params: ProviderCardParams,
  card: HTMLElement,
  provider: ModelProvider,
  trigger: HTMLButtonElement,
): Promise<void> {
  trigger.disabled = true;
  showCardStatus(card, "正在获取模型列表…", false);
  const request = loadProviderCatalog(params, provider);
  const controller = params.resources.requests.get(provider.id)?.controller;
  try {
    const models = await request;
    if (!card.isConnected || controller?.signal.aborted) return;
    showCardStatus(card, "", false);
    params.resources.pickers.get(provider.id)?.();
    const close = openModelPicker({
      root: card,
      models,
      existing: new Set(provider.models.map((model) => model.model.trim())),
      trigger,
      onClose: () => params.resources.pickers.delete(provider.id),
      onConfirm(ids) {
        const existing = new Set(
          provider.models.map((model) => model.model.trim()),
        );
        const added = ids.filter((id) => !existing.has(id));
        if (!added.length) return;
        provider.models = provider.models.filter(
          (model) =>
            model.model.trim() ||
            model.id === params.configuration.activeModelId,
        );
        provider.models.push(
          ...added.map((id) => ({
            ...createProviderModel(id),
            effort: provider.authMode === "codex_auth" ? "medium" : "",
          })),
        );
        params.onDraftsChanged([...params.drafts]);
        const savedCard = Array.from(
          params.root.querySelectorAll<HTMLElement>("[data-provider-card]"),
        ).find((entry) => entry.dataset.providerCard === provider.id);
        if (savedCard)
          showCardStatus(
            savedCard,
            `已添加 ${added.length} 个模型，请保存服务商。`,
            false,
          );
      },
    });
    params.resources.pickers.set(provider.id, close);
  } catch (error) {
    if (card.isConnected && !controller?.signal.aborted)
      showCardStatus(card, `获取模型失败：${errorMessage(error)}`, true);
  } finally {
    trigger.disabled = false;
  }
}

function createProviderHeader(
  params: ProviderCardParams,
  card: HTMLElement,
  provider: ModelProvider,
): HTMLElement {
  const header = createHtml(params.root, "div");
  header.className = "pt-provider-head";
  const icon = createHtml(params.root, "span");
  icon.className = "pt-provider-brand-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = provider.authMode === "codex_auth" ? "C" : "API";
  const toggle = actionButton(params.root, "");
  toggle.className = "pt-provider-toggle";
  toggle.dataset.toggleProvider = "";
  toggle.setAttribute(
    "aria-expanded",
    String(params.openProviderIds.has(provider.id)),
  );
  const title = createHtml(params.root, "span");
  title.className = "pt-provider-title";
  const meta = createHtml(params.root, "span");
  meta.className = "pt-provider-meta";
  const dot = createHtml(params.root, "span");
  dot.className = "pt-provider-dot";
  const summary = createHtml(params.root, "span");
  summary.className = "pt-provider-summary";
  meta.append(dot, summary);
  toggle.append(title, meta);
  const tag = createHtml(params.root, "span");
  tag.className = "pt-provider-tag";
  tag.textContent =
    provider.authMode === "codex_auth" ? "Codex Auth" : "API Key";
  const chevron = createHtml(params.root, "span");
  chevron.className = "pt-provider-chevron";
  chevron.textContent = "›";
  chevron.setAttribute("aria-hidden", "true");
  toggle.addEventListener("click", () => {
    const open = !params.openProviderIds.has(provider.id);
    if (open) params.openProviderIds.add(provider.id);
    else params.openProviderIds.delete(provider.id);
    card.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    card.querySelector<HTMLElement>(".pt-provider-body")!.hidden = !open;
  });
  header.append(icon, toggle, tag, chevron);
  header.addEventListener("click", (event) => {
    if (!(event.target as Element).closest(".pt-provider-toggle"))
      toggle.click();
  });
  return header;
}

function updateProviderHeader(
  card: HTMLElement,
  provider: ModelProvider,
  activeModelId: string,
): void {
  const active = provider.models.find((model) => model.id === activeModelId);
  const model = active ?? provider.models.find((entry) => entry.model.trim());
  card.querySelector<HTMLElement>(".pt-provider-title")!.textContent =
    provider.name.trim() || "未命名服务商";
  card.querySelector<HTMLElement>(".pt-provider-summary")!.textContent =
    `${provider.authMode === "codex_auth" ? "Codex Auth" : "API Key"} · ${model?.model.trim() || "未选择模型"}`;
  const dot = card.querySelector<HTMLElement>(".pt-provider-dot")!;
  dot.dataset.current = String(Boolean(active));
  dot.title = active ? "当前" : "未使用";
  card.dataset.open = card
    .querySelector(".pt-provider-toggle")!
    .getAttribute("aria-expanded")!;
}

function createHtml(root: Element, tag: string): HTMLElement {
  return root.ownerDocument.createElementNS(
    "http://www.w3.org/1999/xhtml",
    tag,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredElement(root: Element, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Preferences element is missing: ${selector}`);
  return element;
}
