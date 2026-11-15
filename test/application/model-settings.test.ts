import assert from "node:assert/strict";
import test from "node:test";

import { RecommendationModelSettingsCoordinator } from "../../src/application/model-settings";
import {
  createProvider,
  createProviderModel,
  ModelSettingsStore,
} from "../../src/model/model-configuration";
import { ModelConnectionTester } from "../../src/model/model-connection-tester";

test("invalid draft connection settings reject through the asynchronous controller contract", async (t) => {
  const settings = new RecommendationModelSettingsCoordinator(
    new ModelSettingsStore({
      get: () => undefined,
      set() {
        assert.fail("Testing a draft must not save model settings");
      },
    }),
    new ModelConnectionTester({
      async legacy() {
        assert.fail("Invalid drafts must not start a request");
      },
      async openAICompatible() {
        assert.fail("Invalid drafts must not start a request");
      },
    }),
    () => undefined,
    async () => [],
  );
  t.after(() => settings.dispose());
  await assert.rejects(
    settings.testDraftModel(
      { ...createProvider("codex_auth"), name: "Draft" },
      createProviderModel(),
    ),
    /模型 ID/u,
  );
  await assert.rejects(
    settings.testDraftModel(
      {
        ...createProvider("openai_compatible"),
        name: "Draft",
        apiBase: "https://gateway.example/v1",
      },
      createProviderModel("model-1"),
    ),
    /API Key/u,
  );
});
