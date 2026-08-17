import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfiguredRecommendationModel,
  type RecommendationModelTransports,
} from "../../src/model/configured-recommendation-model";
import type { ModelProviderConfiguration } from "../../src/model/model-configuration";

test("recommendation model routes once to the selected provider and returns a secret-free identity", async () => {
  const calls: string[] = [];
  const model = new ConfiguredRecommendationModel(
    () => configuration("model-api"),
    transports(calls),
  );

  const result = await model.generate({
    instructions: "Return the schema.",
    prompt: "{}",
  });

  assert.equal(result.text, "api-result");
  assert.deepEqual(calls, ["api:json_object"]);
  assert.deepEqual(result.identity, {
    authMode: "openai_compatible",
    providerId: "provider-api",
    modelId: "model-api",
    model: "example-model",
    apiBase: "https://api.example.com/v1/chat/completions",
    effort: "",
  });
  assert.doesNotMatch(
    JSON.stringify(result.identity),
    /private-key|access_token|refresh_token|auth\.json|Example API/u,
  );
});

test("provider failure never falls back to another provider or model", async () => {
  const calls: string[] = [];
  const model = new ConfiguredRecommendationModel(
    () => configuration("model-api"),
    {
      ...transports(calls),
      async openAICompatible() {
        calls.push("api");
        throw new Error("provider failed");
      },
    },
  );

  await assert.rejects(
    model.generate({ instructions: "Return JSON.", prompt: "{}" }),
    /provider failed/u,
  );
  assert.deepEqual(calls, ["api"]);
});

test("cancelling model tasks aborts every in-flight request and shutdown rejects new work", async () => {
  let signal: AbortSignal | undefined;
  const model = new ConfiguredRecommendationModel(
    () => configuration("model-codex"),
    {
      async legacy(request) {
        signal = request.signal;
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener(
            "abort",
            () => reject(request.signal?.reason),
            { once: true },
          );
        });
      },
      async openAICompatible() {
        throw new Error("not used");
      },
    },
  );

  const pending = model.generate({
    instructions: "Return JSON.",
    prompt: "{}",
  });
  model.cancelActiveRequests();
  await assert.rejects(pending, /configuration changed/u);
  assert.equal(signal?.aborted, true);

  model.shutdown();
  await assert.rejects(
    model.generate({ instructions: "Return JSON.", prompt: "{}" }),
    /shut down/u,
  );
});

test("a transport result arriving after active-model cancellation is rejected", async () => {
  const late = deferred<{ text: string }>();
  let signal: AbortSignal | undefined;
  const model = new ConfiguredRecommendationModel(
    () => configuration("model-api"),
    {
      async legacy() {
        throw new Error("not used");
      },
      openAICompatible(request) {
        signal = request.signal;
        return late.promise;
      },
    },
  );

  const pending = model.generate({
    instructions: "Return JSON.",
    prompt: "{}",
  });
  model.cancelActiveRequests();
  late.resolve({ text: '{"schemaVersion":1,"priority":[],"optional":[]}' });

  await assert.rejects(pending, /configuration changed/u);
  assert.equal(signal?.aborted, true);
});

function transports(calls: string[]): RecommendationModelTransports {
  return {
    async legacy(request) {
      calls.push(`legacy:${request.responseFormat}`);
      return { text: "legacy-result" };
    },
    async openAICompatible(request) {
      calls.push(`api:${request.responseFormat}`);
      return { text: "api-result" };
    },
  };
}

function configuration(activeModelId: string): ModelProviderConfiguration {
  return {
    schemaVersion: 1,
    activeModelId,
    providers: [
      {
        id: "provider-codex",
        name: "Legacy Codex",
        authMode: "codex_auth",
        apiBase: "https://chatgpt.com/backend-api/codex/responses",
        apiKey: "",
        models: [{ id: "model-codex", model: "gpt-5.4", effort: "medium" }],
      },
      {
        id: "provider-api",
        name: "Example API",
        authMode: "openai_compatible",
        apiBase: "https://api.example.com/v1/chat/completions",
        apiKey: "private-key",
        models: [{ id: "model-api", model: "example-model", effort: "" }],
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
