import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfiguredRecommendationModel,
  type RecommendationModelTransports,
} from "../../src/model/configured-recommendation-model";
import {
  ModelSettingsStore,
  type ModelProviderConfiguration,
} from "../../src/model/model-configuration";
import { saveProviderConfiguration } from "../../src/model/model-selection";
import { RelatedPapersController } from "../../src/application/related-papers-controller";
import { RelatedPaperRecommendationService } from "../../src/recommendation/related-paper-recommendation";

test("identity subscriptions do not read or initialize model preferences", () => {
  let reads = 0;
  let writes = 0;
  const store = new ModelSettingsStore({
    get() {
      reads += 1;
      return undefined;
    },
    set() {
      writes += 1;
    },
  });
  const model = new ConfiguredRecommendationModel(
    () => store.getConfiguration(),
    transports([]),
    (listener) => store.subscribe(listener),
  );

  const unsubscribe = model.subscribeIdentityChange(() => {});
  assert.deepEqual({ reads, writes }, { reads: 0, writes: 0 });
  assert.equal(model.identity().model, "gpt-5.4");
  assert.deepEqual({ reads, writes }, { reads: 1, writes: 1 });
  unsubscribe();
});

test("invalid model settings stay inside recommendation failures and saved repairs reach every Reader", async () => {
  const store = new ModelSettingsStore({
    get: () => "{",
    set() {},
  });
  const calls: string[] = [];
  const model = new ConfiguredRecommendationModel(
    () => store.getConfiguration(),
    transports(calls),
    (listener) => store.subscribe(listener),
  );
  const recommendation = new RelatedPaperRecommendationService(model);
  const cacheReads = [0, 0];
  const controllers = cacheReads.map(
    (_, index) =>
      new RelatedPapersController(index + 1, {
        async loadPaper() {
          return {
            identity: {
              libraryID: 1,
              attachmentID: index + 1,
              attachmentKey: `PAPER00${index}`,
              parentItemKey: "PARENT00",
            },
            sourceFingerprint: "fingerprint",
            fullMarkdown: "Current paper",
            fullMdSha256: "body-hash",
            entries: [],
          };
        },
        async resolveReferences() {
          return [
            {
              id: "reference:0",
              ordinal: 0,
              title: "Existing reference",
              status: "resolved" as const,
              primaryResultURL: "https://example.com/paper",
            },
          ];
        },
        async loadCitingPapers() {
          return [];
        },
        async readCachedRecommendation() {
          cacheReads[index] += 1;
          model.identity();
          return undefined;
        },
        recommendPapers: (request) => recommendation.recommend(request),
        subscribeRecommendationIdentityChange: (listener) =>
          recommendation.subscribeIdentityChange(listener),
        async translateSelection(text) {
          return `Translated ${text}`;
        },
        openURL() {},
      }),
  );

  try {
    await Promise.all(
      controllers.map((controller) => controller.refreshAsync()),
    );
    for (const controller of controllers) {
      assert.equal(controller.getState().status, "ready");
      assert.equal(
        controller.getState().references[0].title,
        "Existing reference",
      );
      const failed = controller.getState().recommendation;
      assert.equal(failed.status, "failed");
      if (failed.status === "failed")
        assert.match(failed.message, /有效 JSON/u);
      assert.equal(
        await controller.translateSelection("text"),
        "Translated text",
      );
    }
    await assert.rejects(
      model.generate({ instructions: "Return JSON.", prompt: "{}" }),
      /有效 JSON/u,
    );
    assert.deepEqual(calls, []);
    assert.deepEqual(cacheReads, [1, 1]);

    store.saveConfiguration(configuration("model-api"));
    assert.deepEqual(cacheReads, [2, 2]);
    await Promise.all(
      controllers.map((controller) => controller.generateRecommendations()),
    );
    for (const controller of controllers) {
      assert.equal(
        controller.getState().recommendation.status,
        "no-candidates",
      );
      assert.equal(controller.getState().status, "ready");
    }
    assert.deepEqual(calls, []);
  } finally {
    for (const controller of controllers) controller.dispose();
  }
});

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
    /private-key|access_token|refresh_token|auth\.json/u,
  );
});

test("provider display name and credentials do not change the recommendation runtime identity", () => {
  let configured = configuration("model-api");
  const model = new ConfiguredRecommendationModel(
    () => configured,
    transports([]),
  );
  const identity = model.identity();

  configured = {
    ...configured,
    providers: configured.providers.map((provider) => ({
      ...provider,
      name: "Renamed provider",
      apiKey: "rotated-key",
    })),
  };

  assert.deepEqual(model.identity(), identity);
  assert.doesNotMatch(JSON.stringify(identity), /providerName|apiKey/u);
});

test("saving unchanged, display, or inactive model settings does not notify recommendation identity subscribers", () => {
  const store = new ModelSettingsStore({
    get: () => JSON.stringify(configuration("model-api")),
    set() {},
  });
  const model = new ConfiguredRecommendationModel(
    () => store.getConfiguration(),
    transports([]),
    (listener) => store.subscribe(listener),
  );
  let changes = 0;
  const unsubscribe = model.subscribeIdentityChange(() => {
    changes += 1;
  });

  store.saveConfiguration(store.getConfiguration());
  assert.equal(changes, 0, "saving unchanged settings");

  const renamed = store.getConfiguration();
  renamed.providers[1].name = "Renamed provider";
  store.saveConfiguration(renamed);
  assert.equal(changes, 0, "renaming the active provider");

  const inactiveProvider = store.getConfiguration();
  inactiveProvider.providers[0].models[0].effort = "high";
  store.saveConfiguration(inactiveProvider);
  assert.equal(changes, 0, "editing an inactive provider");

  const inactiveModel = store.getConfiguration();
  inactiveModel.providers[1].models.push({
    id: "model-api-other",
    model: "another-model",
    effort: "",
  });
  store.saveConfiguration(inactiveModel);
  assert.equal(changes, 0, "adding an inactive model to the active provider");

  unsubscribe();
});

test("active model identity changes notify subscribers and cancel their in-flight recommendation", async () => {
  const store = new ModelSettingsStore({
    get: () => JSON.stringify(configuration("model-api")),
    set() {},
  });
  const late = deferred<{ text: string }>();
  let signal: AbortSignal | undefined;
  const model = new ConfiguredRecommendationModel(
    () => store.getConfiguration(),
    {
      ...transports([]),
      openAICompatible(request) {
        signal = request.signal;
        return late.promise;
      },
    },
    (listener) => store.subscribe(listener),
  );
  let changes = 0;
  const unsubscribe = model.subscribeIdentityChange(() => {
    changes += 1;
    model.cancelActiveRequests();
  });
  const pending = model.generate({
    instructions: "Return JSON.",
    prompt: "{}",
  });

  const activeModel = store.getConfiguration();
  activeModel.providers[1].models[0].model = "updated-model";
  store.saveConfiguration(activeModel);
  late.resolve({ text: "late-result" });

  await assert.rejects(pending, /configuration changed/u);
  assert.equal(signal?.aborted, true);
  assert.equal(changes, 1);

  const selected = store.getConfiguration();
  selected.activeModelId = "model-codex";
  store.saveConfiguration(selected);
  assert.equal(changes, 2);

  const effort = store.getConfiguration();
  effort.providers[0].models[0].effort = "high";
  store.saveConfiguration(effort);
  assert.equal(changes, 3);

  unsubscribe();
  store.saveConfiguration(activeModel);
  assert.equal(changes, 3);
});

test("credential rotation cancels in-flight model requests without changing recommendation identity", async () => {
  const store = new ModelSettingsStore({
    get: () => JSON.stringify(configuration("model-api")),
    set() {},
  });
  const late = deferred<{ text: string }>();
  let signal: AbortSignal | undefined;
  const model = new ConfiguredRecommendationModel(
    () => store.getConfiguration(),
    {
      ...transports([]),
      openAICompatible(request) {
        signal = request.signal;
        return late.promise;
      },
    },
    (listener) => store.subscribe(listener),
  );
  const identity = model.identity();
  let changes = 0;
  const unsubscribe = model.subscribeIdentityChange(() => {
    changes += 1;
  });
  const pending = model.generate({
    instructions: "Return JSON.",
    prompt: "{}",
  });

  const rotated = store.getConfiguration();
  rotated.providers[1].apiKey = "rotated-key";
  saveProviderConfiguration(rotated, {
    getConfiguration: () => store.getConfiguration(),
    saveConfiguration: (saved) => store.saveConfiguration(saved),
    cancelModelTasks: () => model.cancelActiveRequests(),
  });
  late.resolve({ text: "late-result" });

  await assert.rejects(pending, /configuration changed/u);
  assert.equal(signal?.aborted, true);
  assert.equal(changes, 0);
  assert.deepEqual(model.identity(), identity);
  assert.doesNotMatch(JSON.stringify(model.identity()), /apiKey|rotated-key/u);
  unsubscribe();
});

test("Legacy recommendations use a strict JSON schema instead of rejected JSON object mode", async () => {
  let legacyRequest:
    Parameters<RecommendationModelTransports["legacy"]>[0] | undefined;
  const model = new ConfiguredRecommendationModel(
    () => configuration("model-codex"),
    {
      async legacy(request) {
        legacyRequest = request;
        return { text: "legacy-result" };
      },
      async openAICompatible() {
        throw new Error("not used");
      },
    },
  );

  const deltas: string[] = [];
  await model.generate({
    instructions: "Return JSON.",
    prompt: "{}",
    onTextDelta: (delta) => deltas.push(delta),
  });
  legacyRequest?.onTextDelta?.("partial");

  assert.equal(legacyRequest?.responseFormat, "json_schema");
  assert.equal(
    legacyRequest?.responseSchema?.name,
    "related_paper_recommendation",
  );
  assert.equal(legacyRequest?.responseSchema?.strict, true);
  assert.deepEqual(deltas, ["partial"]);
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
