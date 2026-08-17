export const RECOMMENDATION_MODEL_PREFERENCE =
  "extensions.referenceforzotero.recommendationModelConfiguration";
export const LEGACY_CODEX_RESPONSES_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/responses";

export type ModelAuthMode = "codex_auth" | "openai_compatible";

export type ProviderModel = {
  id: string;
  model: string;
  effort: string;
};

export type ModelProvider = {
  id: string;
  name: string;
  authMode: ModelAuthMode;
  apiBase: string;
  apiKey: string;
  models: ProviderModel[];
};

export type ModelProviderConfiguration = {
  schemaVersion: 1;
  providers: ModelProvider[];
  activeModelId: string;
};

export type RuntimeModel = ProviderModel & {
  providerId: string;
  providerName: string;
  authMode: ModelAuthMode;
  apiBase: string;
  apiKey: string;
  active: boolean;
};

export interface ModelSettingsPreferences {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export const DEFAULT_MODEL_CONFIGURATION: ModelProviderConfiguration = {
  schemaVersion: 1,
  providers: [
    {
      id: "provider-codex",
      name: "Legacy Codex",
      authMode: "codex_auth",
      apiBase: LEGACY_CODEX_RESPONSES_ENDPOINT,
      apiKey: "",
      models: [
        {
          id: "model-codex",
          model: "gpt-5.4",
          effort: "medium",
        },
      ],
    },
  ],
  activeModelId: "model-codex",
};

export class ModelSettingsStore {
  private configuration?: ModelProviderConfiguration;
  private readonly listeners = new Set<
    (configuration: ModelProviderConfiguration) => void
  >();

  constructor(private readonly preferences: ModelSettingsPreferences) {}

  getConfiguration(): ModelProviderConfiguration {
    if (!this.configuration) {
      const stored = this.preferences.get(RECOMMENDATION_MODEL_PREFERENCE);
      this.configuration = stored
        ? parseStoredConfiguration(stored)
        : cloneConfiguration(DEFAULT_MODEL_CONFIGURATION);
      if (!stored) this.persist(this.configuration);
    }
    return cloneConfiguration(this.configuration);
  }

  saveConfiguration(
    configuration: ModelProviderConfiguration,
  ): ModelProviderConfiguration {
    const validated = validateProviderConfiguration(configuration);
    this.configuration = validated;
    this.persist(validated);
    for (const listener of [...this.listeners]) {
      listener(cloneConfiguration(validated));
    }
    return cloneConfiguration(validated);
  }

  subscribe(
    listener: (configuration: ModelProviderConfiguration) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(configuration: ModelProviderConfiguration): void {
    this.preferences.set(
      RECOMMENDATION_MODEL_PREFERENCE,
      JSON.stringify(configuration),
    );
  }
}

export function createProvider(authMode: ModelAuthMode): ModelProvider {
  return {
    id: createId("provider"),
    name: "",
    authMode,
    apiBase: authMode === "codex_auth" ? LEGACY_CODEX_RESPONSES_ENDPOINT : "",
    apiKey: "",
    models: [],
  };
}

export function createProviderModel(model = ""): ProviderModel {
  return {
    id: createId("model"),
    model: model.trim(),
    effort: "medium",
  };
}

export function validateProviderConfiguration(
  configuration: ModelProviderConfiguration,
): ModelProviderConfiguration {
  if (configuration.schemaVersion !== 1) {
    throw new Error(
      `不支持的推荐模型配置版本：${String(configuration.schemaVersion)}`,
    );
  }
  if (
    !Array.isArray(configuration.providers) ||
    !configuration.providers.length
  ) {
    throw new Error("至少需要一个模型服务商");
  }
  const providers = configuration.providers.map(validateProvider);
  const providerIds = new Set<string>();
  const modelIds = new Set<string>();
  for (const provider of providers) {
    if (providerIds.has(provider.id)) {
      throw new Error(`存在重复服务商 ID：${provider.id}`);
    }
    providerIds.add(provider.id);
    for (const model of provider.models) {
      if (modelIds.has(model.id)) {
        throw new Error(`存在重复模型条目 ID：${model.id}`);
      }
      modelIds.add(model.id);
    }
  }
  const activeModelId = requiredString(
    configuration.activeModelId,
    "活动模型 ID",
  );
  if (!modelIds.has(activeModelId)) {
    throw new Error(`活动模型不存在：${activeModelId}`);
  }
  return {
    schemaVersion: 1,
    providers,
    activeModelId,
  };
}

export function flattenRuntimeModels(
  configuration: ModelProviderConfiguration,
): RuntimeModel[] {
  return configuration.providers.flatMap((provider) =>
    provider.models.map((model) => ({
      ...model,
      providerId: provider.id,
      providerName: provider.name,
      authMode: provider.authMode,
      apiBase: provider.apiBase,
      apiKey: provider.apiKey,
      active: model.id === configuration.activeModelId,
    })),
  );
}

export function resolveRuntimeModel(
  provider: ModelProvider,
  model: ProviderModel,
): RuntimeModel {
  const normalized = validateProvider({ ...provider, models: [model] });
  const normalizedModel = normalized.models[0];
  return {
    ...normalizedModel,
    providerId: normalized.id,
    providerName: normalized.name,
    authMode: normalized.authMode,
    apiBase: normalized.apiBase,
    apiKey: normalized.apiKey,
    active: false,
  };
}

export function normalizeChatCompletionsEndpoint(apiBase: string): string {
  const value = apiBase.trim().replace(/\/+$/u, "");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(
      `OpenAI Compatible API Base 不是有效 URL：${String(error)}`,
      {
        cause: error,
      },
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error("OpenAI Compatible API Base 必须使用 HTTPS");
  }
  return /\/chat\/completions$/iu.test(parsed.pathname)
    ? value
    : `${value}/chat/completions`;
}

function validateProvider(provider: ModelProvider): ModelProvider {
  if (
    provider.authMode !== "codex_auth" &&
    provider.authMode !== "openai_compatible"
  ) {
    throw new Error(`模型服务商认证方式无效：${String(provider.authMode)}`);
  }
  const id = requiredString(provider.id, "服务商 ID");
  const name = requiredString(provider.name, "服务商名称");
  if (!Array.isArray(provider.models) || !provider.models.length) {
    throw new Error("模型服务商至少需要一个模型 ID");
  }
  const models = provider.models.map((model) => ({
    id: requiredString(model.id, "模型条目 ID"),
    model: requiredString(model.model, "模型 ID"),
    effort:
      provider.authMode === "codex_auth" ? model.effort.trim() || "medium" : "",
  }));
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    throw new Error(`服务商 ${name} 包含重复模型条目 ID`);
  }
  if (provider.authMode === "codex_auth") {
    return {
      id,
      name,
      authMode: provider.authMode,
      apiBase: LEGACY_CODEX_RESPONSES_ENDPOINT,
      apiKey: "",
      models,
    };
  }
  return {
    id,
    name,
    authMode: provider.authMode,
    apiBase: normalizeChatCompletionsEndpoint(provider.apiBase),
    apiKey: requiredString(provider.apiKey, "API Key"),
    models,
  };
}

function parseStoredConfiguration(value: string): ModelProviderConfiguration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`推荐模型配置不是有效 JSON：${String(error)}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("推荐模型配置必须是对象");
  }
  const raw = parsed as Partial<ModelProviderConfiguration>;
  return validateProviderConfiguration({
    schemaVersion: raw.schemaVersion as 1,
    activeModelId: String(raw.activeModelId ?? ""),
    providers: Array.isArray(raw.providers)
      ? raw.providers.map(parseProvider)
      : [],
  });
}

function parseProvider(value: unknown): ModelProvider {
  if (!value || typeof value !== "object") {
    throw new Error("模型服务商必须是对象");
  }
  const raw = value as Partial<ModelProvider>;
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    authMode: raw.authMode as ModelAuthMode,
    apiBase: String(raw.apiBase ?? ""),
    apiKey: String(raw.apiKey ?? ""),
    models: Array.isArray(raw.models)
      ? raw.models.map((model) => ({
          id: String(model?.id ?? ""),
          model: String(model?.model ?? ""),
          effort: String(model?.effort ?? ""),
        }))
      : [],
  };
}

function cloneConfiguration(
  configuration: ModelProviderConfiguration,
): ModelProviderConfiguration {
  return {
    ...configuration,
    providers: configuration.providers.map((provider) => ({
      ...provider,
      models: provider.models.map((model) => ({ ...model })),
    })),
  };
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} 不能为空`);
  return normalized;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
