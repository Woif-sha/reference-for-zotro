import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL_CONFIGURATION,
  ModelSettingsStore,
  flattenRuntimeModels,
  validateProviderConfiguration,
  type ModelProviderConfiguration,
  type ModelSettingsPreferences,
} from "../../src/model/model-configuration";

test("fresh settings use one active Legacy Codex gpt-5.4 medium model", () => {
  const preferences = memoryPreferences();
  const settings = new ModelSettingsStore(preferences);

  assert.deepEqual(settings.getConfiguration(), DEFAULT_MODEL_CONFIGURATION);
  assert.deepEqual(
    flattenRuntimeModels(settings.getConfiguration()).map((model) => ({
      authMode: model.authMode,
      model: model.model,
      effort: model.effort,
      active: model.active,
    })),
    [
      {
        authMode: "codex_auth",
        model: "gpt-5.4",
        effort: "medium",
        active: true,
      },
    ],
  );
  assert.match(preferences.value ?? "", /"activeModelId":"model-codex"/u);
});

test("model settings read only this plugin preference and never Paper Translate preferences", () => {
  const reads: string[] = [];
  const settings = new ModelSettingsStore({
    get(key) {
      reads.push(key);
      return undefined;
    },
    set() {},
  });

  settings.getConfiguration();

  assert.deepEqual(reads, [
    "extensions.referenceforzotero.recommendationModelConfiguration",
  ]);
});

test("configuration accepts only Legacy auth.json and HTTPS OpenAI Compatible providers", () => {
  const configuration = apiConfiguration("https://api.example.com/v1/");
  const validated = validateProviderConfiguration(configuration);

  assert.equal(
    validated.providers[1].apiBase,
    "https://api.example.com/v1/chat/completions",
  );

  assert.throws(
    () =>
      validateProviderConfiguration({
        ...configuration,
        providers: [
          {
            ...configuration.providers[1],
            authMode: "anthropic" as "openai_compatible",
          },
        ],
      }),
    /认证方式/u,
  );
  assert.throws(
    () =>
      validateProviderConfiguration({
        ...configuration,
        providers: [
          {
            ...configuration.providers[1],
            apiBase: "http://api.example.com/v1",
          },
        ],
        activeModelId: "model-api",
      }),
    /HTTPS/u,
  );
});

test("configuration requires exactly one saved active model", () => {
  const configuration = apiConfiguration("https://api.example.com/v1");

  assert.throws(
    () =>
      validateProviderConfiguration({
        ...configuration,
        activeModelId: "missing-model",
      }),
    /活动模型/u,
  );
  assert.equal(
    flattenRuntimeModels(validateProviderConfiguration(configuration)).filter(
      (model) => model.active,
    ).length,
    1,
  );
});

export function apiConfiguration(apiBase: string): ModelProviderConfiguration {
  return {
    schemaVersion: 1,
    activeModelId: "model-api",
    providers: [
      ...DEFAULT_MODEL_CONFIGURATION.providers,
      {
        id: "provider-api",
        name: "Example API",
        authMode: "openai_compatible",
        apiBase,
        apiKey: "private-key",
        models: [{ id: "model-api", model: "example-model", effort: "" }],
      },
    ],
  };
}

function memoryPreferences(): ModelSettingsPreferences & { value?: string } {
  return {
    value: undefined,
    get() {
      return this.value;
    },
    set(_key, value) {
      this.value = value;
    },
  };
}
