import assert from "node:assert/strict";
import test from "node:test";

import {
  saveProviderConfiguration,
  selectActiveModel,
  type ModelSelectionDependencies,
} from "../../src/model/model-selection";
import {
  DEFAULT_MODEL_CONFIGURATION,
  validateProviderConfiguration,
  type ModelProviderConfiguration,
} from "../../src/model/model-configuration";

test("switching the active model cancels model tasks before persistence", () => {
  const harness = selectionHarness(
    apiConfiguration("https://api.example.com/v1"),
  );
  harness.configuration = {
    ...harness.configuration,
    activeModelId: "model-codex",
  };

  selectActiveModel("model-api", harness.dependencies);

  assert.deepEqual(harness.calls, ["cancel", "save:model-api"]);
});

test("invalid selection changes neither tasks nor persisted settings", () => {
  const harness = selectionHarness(DEFAULT_MODEL_CONFIGURATION);

  assert.throws(
    () => selectActiveModel("missing-model", harness.dependencies),
    /活动模型不存在/u,
  );
  assert.deepEqual(harness.calls, []);
});

test("saving changed active credentials cancels tasks before persistence", () => {
  const current = apiConfiguration("https://api.example.com/v1");
  const harness = selectionHarness(current);
  const changed = structuredClone(current);
  changed.providers[1].apiKey = "rotated-key";

  saveProviderConfiguration(changed, harness.dependencies);

  assert.deepEqual(harness.calls, ["cancel", "save:model-api"]);
});

test("editing an inactive provider does not cancel active model tasks", () => {
  const current = apiConfiguration("https://api.example.com/v1");
  const harness = selectionHarness(current);
  const changed = structuredClone(current);
  changed.providers[0].models[0].effort = "high";

  saveProviderConfiguration(changed, harness.dependencies);

  assert.deepEqual(harness.calls, ["save:model-api"]);
});

function selectionHarness(initial: ModelProviderConfiguration): {
  configuration: ModelProviderConfiguration;
  calls: string[];
  dependencies: ModelSelectionDependencies;
} {
  const harness = {
    configuration: validateProviderConfiguration(initial),
    calls: [] as string[],
    dependencies: undefined as unknown as ModelSelectionDependencies,
  };
  harness.dependencies = {
    getConfiguration: () => harness.configuration,
    saveConfiguration(configuration) {
      harness.calls.push(`save:${configuration.activeModelId}`);
      harness.configuration = configuration;
      return configuration;
    },
    cancelModelTasks() {
      harness.calls.push("cancel");
    },
  };
  return harness;
}

function apiConfiguration(apiBase: string): ModelProviderConfiguration {
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
