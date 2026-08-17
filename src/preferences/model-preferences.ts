import type { ModelPreferencesController } from "../application/model-settings";
import {
  createProvider,
  createProviderModel,
  flattenRuntimeModels,
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
  const activeSelectHost = requiredElement(
    root,
    "[data-active-model-select-host]",
  );
  const activeSelect = createHtml(root, "select") as HTMLSelectElement;
  activeSelect.dataset.activeModelSelect = "";
  activeSelectHost.replaceChildren(activeSelect);
  const pageError = requiredElement(root, "[data-model-settings-error]");
  let configuration = settings.getConfiguration();
  let drafts = cloneProviders(configuration.providers);
  let active = true;

  const showPageError = (error?: unknown): void => {
    const message = error === undefined ? "" : errorMessage(error);
    pageError.textContent = message;
    pageError.toggleAttribute("hidden", !message);
  };

  const render = (): void => {
    if (!active) return;
    activeSelect.replaceChildren();
    for (const model of flattenRuntimeModels(configuration)) {
      const option = createHtml(root, "option") as HTMLOptionElement;
      option.value = model.id;
      option.textContent = `${model.providerName} / ${model.model}`;
      option.selected = model.id === configuration.activeModelId;
      activeSelect.append(option);
    }
    cards.replaceChildren(
      ...drafts.map((provider) =>
        createProviderCard(root, provider, {
          getConfiguration: () => configuration,
          getDrafts: () => drafts,
          setDrafts(next) {
            drafts = next;
            render();
          },
          settings,
          showPageError,
          render,
        }),
      ),
    );
  };

  const onAddProvider = (): void => {
    const provider = createProvider("openai_compatible");
    provider.name = `服务商 ${drafts.length + 1}`;
    provider.models.push(createProviderModel());
    drafts = [...drafts, provider];
    showPageError();
    render();
  };
  const onSelect = (): void => {
    try {
      settings.selectActiveModel(activeSelect.value);
      showPageError();
    } catch (error) {
      showPageError(error);
      render();
    }
  };
  addProvider.addEventListener("click", onAddProvider);
  activeSelect.addEventListener("change", onSelect);
  const unsubscribe = settings.subscribe(() => {
    configuration = settings.getConfiguration();
    drafts = cloneProviders(configuration.providers);
    showPageError();
    render();
  });
  render();

  return {
    destroy() {
      if (!active) return;
      active = false;
      addProvider.removeEventListener("click", onAddProvider);
      activeSelect.removeEventListener("change", onSelect);
      unsubscribe();
      settings.cancelConnectionTests();
      cards.replaceChildren();
    },
  };
}

type ProviderCardContext = {
  getConfiguration(): ModelProviderConfiguration;
  getDrafts(): ModelProvider[];
  setDrafts(providers: ModelProvider[]): void;
  settings: ModelPreferencesController;
  showPageError(error?: unknown): void;
  render(): void;
};

function createProviderCard(
  root: Element,
  provider: ModelProvider,
  context: ProviderCardContext,
): HTMLElement {
  const card = createHtml(root, "section");
  card.className = "reference-for-zotero-provider-card";
  card.dataset.providerCard = provider.id;

  const header = createHtml(root, "div");
  header.className = "reference-for-zotero-provider-header";
  const name = textInput(root, "服务商名称", provider.name);
  name.input.dataset.providerName = "";
  name.input.addEventListener("input", () => {
    provider.name = name.input.value;
  });
  const removeProvider = actionButton(root, "删除服务商");
  removeProvider.dataset.removeProvider = "";
  removeProvider.addEventListener("click", () => {
    if (
      provider.models.some(
        (model) => model.id === context.getConfiguration().activeModelId,
      )
    ) {
      context.showPageError("不能删除包含活动模型的服务商");
      return;
    }
    context.setDrafts(
      context.getDrafts().filter((entry) => entry.id !== provider.id),
    );
  });
  header.append(name.wrapper, removeProvider);
  card.append(header);

  const modeField = createHtml(root, "label");
  modeField.textContent = "认证方式";
  const mode = createHtml(root, "select") as HTMLSelectElement;
  mode.dataset.providerAuthMode = "";
  for (const [value, label] of [
    ["codex_auth", "Legacy auth.json"],
    ["openai_compatible", "OpenAI Compatible"],
  ] as const) {
    const option = createHtml(root, "option") as HTMLOptionElement;
    option.value = value;
    option.textContent = label;
    option.selected = provider.authMode === value;
    mode.append(option);
  }
  mode.addEventListener("change", () => {
    provider.authMode = mode.value as ModelAuthMode;
    provider.apiBase = "";
    provider.apiKey = "";
    for (const model of provider.models) {
      model.effort = provider.authMode === "codex_auth" ? "medium" : "";
    }
    context.render();
  });
  modeField.append(mode);
  card.append(modeField);

  if (provider.authMode === "openai_compatible") {
    const apiBase = textInput(root, "HTTPS API Base", provider.apiBase);
    apiBase.input.dataset.providerApiBase = "";
    apiBase.input.addEventListener("input", () => {
      provider.apiBase = apiBase.input.value;
    });
    const apiKey = textInput(root, "API Key", provider.apiKey, "password");
    apiKey.input.dataset.providerApiKey = "";
    apiKey.input.autocomplete = "off";
    apiKey.input.addEventListener("input", () => {
      provider.apiKey = apiKey.input.value;
    });
    card.append(apiBase.wrapper, apiKey.wrapper);
  }

  const modelList = createHtml(root, "div");
  modelList.className = "reference-for-zotero-model-list";
  for (const model of provider.models) {
    modelList.append(createModelRow(root, provider, model, context, card));
  }
  card.append(modelList);

  const footer = createHtml(root, "div");
  footer.className = "reference-for-zotero-provider-actions";
  const addModel = actionButton(root, "添加模型");
  addModel.dataset.addProviderModel = "";
  addModel.addEventListener("click", () => {
    provider.models.push(createProviderModel());
    context.render();
  });
  const save = actionButton(root, "保存");
  save.dataset.saveProvider = "";
  save.addEventListener("click", () => {
    try {
      context.settings.saveConfiguration({
        schemaVersion: 1,
        providers: context.getDrafts(),
        activeModelId: context.getConfiguration().activeModelId,
      });
      showCardStatus(card, "已保存", false);
      context.showPageError();
    } catch (error) {
      context.showPageError(error);
    }
  });
  const status = createHtml(root, "span");
  status.dataset.providerStatus = "";
  footer.append(addModel, save, status);
  card.append(footer);
  return card;
}

function createModelRow(
  root: Element,
  provider: ModelProvider,
  model: ProviderModel,
  context: ProviderCardContext,
  card: HTMLElement,
): HTMLElement {
  const row = createHtml(root, "div");
  row.className = "reference-for-zotero-model-row";
  row.dataset.modelRow = model.id;
  const modelInput = textInput(root, "模型 ID", model.model);
  modelInput.input.dataset.modelId = "";
  modelInput.input.addEventListener("input", () => {
    model.model = modelInput.input.value;
  });
  row.append(modelInput.wrapper);

  if (provider.authMode === "codex_auth") {
    const effortField = createHtml(root, "label");
    effortField.textContent = "Effort";
    const effort = createHtml(root, "select") as HTMLSelectElement;
    effort.dataset.modelEffort = "";
    for (const value of ["low", "medium", "high", "xhigh"]) {
      const option = createHtml(root, "option") as HTMLOptionElement;
      option.value = value;
      option.textContent = value;
      option.selected = model.effort === value;
      effort.append(option);
    }
    effort.addEventListener("change", () => {
      model.effort = effort.value;
    });
    effortField.append(effort);
    row.append(effortField);
  }

  const use = actionButton(
    root,
    model.id === context.getConfiguration().activeModelId ? "当前" : "使用",
  );
  use.dataset.useModel = model.id;
  use.disabled = model.id === context.getConfiguration().activeModelId;
  use.addEventListener("click", () => {
    try {
      context.settings.saveConfiguration({
        schemaVersion: 1,
        providers: context.getDrafts(),
        activeModelId: context.getConfiguration().activeModelId,
      });
      context.settings.selectActiveModel(model.id);
      context.showPageError();
    } catch (error) {
      context.showPageError(error);
    }
  });
  const test = actionButton(root, "测试连接");
  test.dataset.testModel = model.id;
  test.addEventListener("click", () => {
    showCardStatus(card, "测试中…", false);
    void context.settings
      .testDraftModel(provider, model)
      .then((reply) => showCardStatus(card, `连接成功：${reply}`, false))
      .catch((error: unknown) =>
        showCardStatus(card, `连接失败：${errorMessage(error)}`, true),
      );
  });
  const remove = actionButton(root, "删除模型");
  remove.dataset.removeModel = model.id;
  remove.addEventListener("click", () => {
    if (model.id === context.getConfiguration().activeModelId) {
      context.showPageError("不能删除活动模型");
      return;
    }
    provider.models = provider.models.filter((entry) => entry.id !== model.id);
    context.render();
  });
  row.append(use, test, remove);
  return row;
}

function textInput(
  root: Element,
  label: string,
  value: string,
  type = "text",
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = createHtml(root, "label") as HTMLLabelElement;
  wrapper.textContent = label;
  const input = createHtml(root, "input") as HTMLInputElement;
  input.type = type;
  input.value = value;
  wrapper.append(input);
  return { wrapper, input };
}

function actionButton(root: Element, label: string): HTMLButtonElement {
  const button = createHtml(root, "button") as HTMLButtonElement;
  button.type = "button";
  button.textContent = label;
  return button;
}

function showCardStatus(
  card: HTMLElement,
  message: string,
  failed: boolean,
): void {
  const status = card.querySelector<HTMLElement>("[data-provider-status]");
  if (!status) return;
  status.textContent = message;
  status.toggleAttribute("data-failed", failed);
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
