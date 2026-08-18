import type { ModelPreferencesController } from "../application/model-settings";
import {
  createProvider,
  createProviderModel,
  type ModelAuthMode,
  type ModelProvider,
  type ModelProviderConfiguration,
  type ProviderModel,
} from "../model/model-configuration";

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

  const render = (): void => {
    if (!active) return;
    cards.replaceChildren(
      ...drafts.map((provider, providerIndex) =>
        createProviderCard({
          root,
          provider,
          providerIndex,
          configuration,
          drafts,
          settings,
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
  Object.assign(card.style, {
    padding: "10px",
    border: "1px solid var(--fill-quinary, #d2d2d2)",
    borderRadius: "8px",
    background: "var(--material-background, #fff)",
  });

  const header = createHtml(root, "div");
  Object.assign(header.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "10px",
  });
  const name = createHtml(root, "input") as HTMLInputElement;
  name.type = "text";
  name.value = provider.name;
  name.placeholder = "未命名服务商";
  name.setAttribute("aria-label", "服务商名称");
  name.dataset.providerName = "";
  Object.assign(name.style, {
    boxSizing: "border-box",
    flex: "1",
    minWidth: "0",
    padding: "5px 8px",
    fontWeight: "600",
  });
  name.addEventListener("input", () => {
    provider.name = name.value;
  });
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
  header.append(name, removeProvider);

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
    provider.authMode = next;
    provider.apiBase = "";
    provider.apiKey = "";
    for (const model of provider.models) {
      model.effort = next === "codex_auth" ? "medium" : "";
    }
    params.onDraftsChanged([...params.drafts]);
  });

  card.append(header, auth.wrap);
  if (provider.authMode === "openai_compatible") {
    const apiBase = labeledInput(root, "API Base", provider.apiBase);
    apiBase.input.placeholder = "https://api.example.com/v1";
    apiBase.input.dataset.providerApiBase = "";
    apiBase.input.addEventListener("input", () => {
      provider.apiBase = apiBase.input.value;
    });
    const apiKey = labeledInput(root, "API Key", provider.apiKey, "password");
    apiKey.input.placeholder = "sk-…";
    apiKey.input.autocomplete = "off";
    apiKey.input.dataset.providerApiKey = "";
    apiKey.input.addEventListener("input", () => {
      provider.apiKey = apiKey.input.value;
    });
    card.append(apiBase.wrap, apiKey.wrap);
  }

  const modelHeading = createHtml(root, "div");
  Object.assign(modelHeading.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "10px",
    marginBottom: "6px",
  });
  const modelTitle = createHtml(root, "strong");
  modelTitle.textContent = "模型";
  modelTitle.style.flex = "1";
  const addModel = actionButton(root, "+");
  addModel.title = "添加模型";
  addModel.setAttribute("aria-label", "添加模型");
  addModel.dataset.addProviderModel = "";
  addModel.addEventListener("click", () => {
    provider.models.push(createProviderModel());
    params.onDraftsChanged([...params.drafts]);
  });
  modelHeading.append(modelTitle, addModel);
  card.append(modelHeading);

  for (const model of provider.models) {
    card.append(createModelRow(params, card, provider, model));
  }

  const footer = createHtml(root, "div");
  Object.assign(footer.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginTop: "10px",
  });
  const save = actionButton(root, "保存");
  save.dataset.saveProvider = "";
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
  const status = createHtml(root, "span");
  status.dataset.providerStatus = "";
  status.hidden = true;
  Object.assign(status.style, {
    flex: "1",
    overflowWrap: "anywhere",
    fontSize: "0.9em",
  });
  footer.append(save, status);
  card.append(footer);
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
  Object.assign(row.style, {
    display: "grid",
    gridTemplateColumns:
      provider.authMode === "codex_auth"
        ? "minmax(120px, 1fr) 110px auto auto auto"
        : "minmax(120px, 1fr) auto auto auto",
    gap: "6px",
    alignItems: "center",
    marginBottom: "6px",
  });
  const modelInput = createHtml(params.root, "input") as HTMLInputElement;
  modelInput.type = "text";
  modelInput.value = model.model;
  modelInput.placeholder = "模型 ID";
  modelInput.dataset.modelId = "";
  applyInputStyle(modelInput);
  modelInput.addEventListener("input", () => {
    model.model = modelInput.value;
  });
  row.append(modelInput);

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
  return row;
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
  Object.assign(wrap.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    marginBottom: "8px",
  });
  const label = createHtml(root, "span");
  label.textContent = labelText;
  label.style.fontWeight = "600";
  wrap.append(label);
  return wrap;
}

function applyInputStyle(input: HTMLInputElement | HTMLSelectElement): void {
  Object.assign(input.style, {
    boxSizing: "border-box",
    width: "100%",
    minWidth: "0",
    padding: "6px 8px",
  });
}

function actionButton(root: Element, label: string): HTMLButtonElement {
  const button = createHtml(root, "button") as HTMLButtonElement;
  button.type = "button";
  button.textContent = label;
  Object.assign(button.style, {
    padding: "4px 9px",
    whiteSpace: "nowrap",
  });
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
