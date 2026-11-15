import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchProviderModels,
  resolveModelCatalog,
} from "../../src/model/model-catalog";
import {
  LEGACY_CODEX_RESPONSES_ENDPOINT,
  type ModelProvider,
} from "../../src/model/model-configuration";

function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "p",
    name: "Provider",
    authMode: "openai_compatible",
    apiBase: "https://example.test/prefix/v1/chat/completions?api-version=2026",
    apiKey: "fake-key",
    models: [],
    ...overrides,
  };
}

function codexProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return provider({
    authMode: "codex_auth",
    apiBase: LEGACY_CODEX_RESPONSES_ENDPOINT,
    apiKey: "",
    ...overrides,
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value));
}

test("custom catalogs preserve gateway prefixes, query parameters and endpoint normalization", () => {
  assert.equal(
    resolveModelCatalog(provider()),
    "https://example.test/prefix/v1/models?api-version=2026",
  );
  assert.equal(
    resolveModelCatalog(provider({ apiBase: "https://proxy.test/api/v1/" })),
    "https://proxy.test/api/v1/models",
  );
});

test("listing uses only GET, rejects redirects, preserves actual IDs and sorts dated models before natural versions", async () => {
  const models = await fetchProviderModels(provider(), {
    fetch: async (url, init) => {
      assert.equal(
        String(url),
        "https://example.test/prefix/v1/models?api-version=2026",
      );
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      assert.deepEqual(init?.headers, {
        Authorization: "Bearer fake-key",
        Accept: "application/json",
      });
      return json({
        data: [
          { id: "model-2", name: "Model Two" },
          { id: "model-10" },
          { id: "model-2", name: "Duplicate" },
          { id: "z-old", created_at: "2024-01-01T00:00:00Z" },
          { id: "a-new", created: 1767225600 },
        ],
      });
    },
    fetchCodexModels: async () =>
      assert.fail("API keys must not use Codex auth"),
  });
  assert.deepEqual(models, [
    { id: "a-new", name: "", createdAt: Date.parse("2026-01-01T00:00:00Z") },
    { id: "z-old", name: "", createdAt: Date.parse("2024-01-01T00:00:00Z") },
    { id: "model-10", name: "" },
    { id: "model-2", name: "Model Two" },
  ]);
});

test("preserves valid declared output modalities while ignoring malformed optional metadata", async () => {
  const models = await fetchProviderModels(provider(), {
    fetch: async () =>
      json({
        data: [
          { id: "image-model", output_modalities: [" IMAGE ", "Audio"] },
          { id: "chat-model", output_modalities: ["text", "audio"] },
          { id: "unknown", output_modalities: [42] },
        ],
      }),
  });
  assert.deepEqual([...models].reverse(), [
    { id: "chat-model", name: "", outputModalities: ["text", "audio"] },
    { id: "image-model", name: "", outputModalities: ["image", "audio"] },
    { id: "unknown", name: "" },
  ]);
});

test("invalid endpoints and missing API keys never send a discovery request", async () => {
  for (const entry of [
    provider({ apiKey: "" }),
    provider({ apiBase: "http://example.test/v1" }),
    provider({ apiBase: "invalid-url" }),
    codexProvider({ apiBase: "https://proxy.test/responses" }),
  ]) {
    await assert.rejects(
      fetchProviderModels(entry, {
        fetch: async () => assert.fail("invalid configuration must not fetch"),
        fetchCodexModels: async () =>
          assert.fail("invalid Codex address must not read auth"),
      }),
    );
  }
});

test("Codex discovers listed slugs in descending natural version order without server priority or invented models", async () => {
  const models = await fetchProviderModels(codexProvider(), {
    fetch: async () => assert.fail("Codex must use the authenticated catalog"),
    fetchCodexModels: async (signal) => {
      assert.equal(signal.aborted, false);
      return json({
        models: [
          {
            slug: " gpt-5.6 ",
            display_name: " GPT-5.6 ",
            visibility: "list",
            priority: 100,
          },
          {
            slug: "gpt-6.1-sol",
            display_name: "GPT-6.1-Sol",
            visibility: "list",
            priority: 1,
          },
          { slug: "gpt-6-astra", visibility: "list", priority: 2 },
          { slug: "GPT-6.1-SOL", visibility: "list", priority: 999 },
          { slug: "hidden", visibility: "hide" },
          { id: "public-api-shape", visibility: "list" },
        ],
      });
    },
  });
  assert.deepEqual(models, [
    { id: "gpt-6.1-sol", name: "GPT-6.1-Sol" },
    { id: "gpt-6-astra", name: "gpt-6-astra" },
    { id: "gpt-5.6", name: "GPT-5.6" },
  ]);
});

test("Codex creation metadata takes precedence over server priority and model versions", async () => {
  const models = await fetchProviderModels(codexProvider(), {
    fetch,
    fetchCodexModels: async () =>
      json({
        data: [
          {
            slug: "version-99",
            visibility: "list",
            priority: 100,
            created: 1727740800,
          },
          {
            slug: "version-1",
            visibility: "list",
            priority: 1,
            created_at: "2026-09-21T00:00:00Z",
          },
          { slug: "unknown-100", visibility: "list", priority: 200 },
        ],
      }),
  });
  assert.deepEqual(
    models.map((entry) => entry.id),
    ["version-1", "version-99", "unknown-100"],
  );
});

test("HTTP failures expose status and manual-entry guidance without echoing keys or server bodies", async () => {
  for (const authMode of ["openai_compatible", "codex_auth"] as const) {
    const configuration =
      authMode === "codex_auth" ? codexProvider() : provider();
    const fail = async () =>
      new Response("fake-key secret server body", { status: 403 });
    await assert.rejects(
      fetchProviderModels(configuration, {
        fetch: fail,
        fetchCodexModels: fail,
      }),
      (error: Error) => {
        assert.match(error.message, /HTTP 403/u);
        assert.match(error.message, /manual entry/u);
        assert.doesNotMatch(error.message, /fake-key|secret server body/u);
        return true;
      },
    );
  }
});

test("transport errors redact API keys recursively", async () => {
  await assert.rejects(
    fetchProviderModels(provider(), {
      fetch: async () => {
        throw new AggregateError(
          [new Error("fake-key inner", { cause: new Error("fake-key cause") })],
          "fake-key outer",
        );
      },
    }),
    (error: AggregateError) => {
      assert.doesNotMatch(error.message, /fake-key/u);
      assert.doesNotMatch(error.errors[0].message, /fake-key/u);
      assert.doesNotMatch(error.errors[0].cause.message, /fake-key/u);
      return true;
    },
  );
});

test("empty, malformed, invalid or partial lists fail rather than inventing models", async () => {
  for (const payload of [
    null,
    {},
    { data: [] },
    { data: [{ id: "bad\nmodel" }] },
    { data: [{ id: "ok" }], has_more: true },
    { data: [{ id: "ok" }], has_more: "yes" },
  ]) {
    await assert.rejects(
      fetchProviderModels(provider(), { fetch: async () => json(payload) }),
    );
  }
  for (const payload of [
    null,
    {},
    { models: [] },
    { models: [{ slug: "hidden", visibility: "hide" }] },
    { data: [{ id: "public-model" }] },
    { models: [{ slug: "bad\nmodel", visibility: "list" }] },
  ]) {
    await assert.rejects(
      fetchProviderModels(codexProvider(), {
        fetch,
        fetchCodexModels: async () => json(payload),
      }),
    );
  }
  for (const configuration of [provider(), codexProvider()]) {
    const malformed = async () => new Response("secret invalid JSON");
    await assert.rejects(
      fetchProviderModels(configuration, {
        fetch: malformed,
        fetchCodexModels: malformed,
      }),
      (error: Error) => {
        assert.match(error.message, /Invalid model JSON/u);
        assert.doesNotMatch(error.message, /secret/u);
        return true;
      },
    );
  }
});

test("both catalogs retain the upstream model count and response size bounds", async () => {
  for (const configuration of [provider(), codexProvider()]) {
    for (const response of [
      json(
        configuration.authMode === "codex_auth"
          ? {
              models: Array.from({ length: 5001 }, (_, i) => ({
                slug: `m${i}`,
                visibility: "list",
              })),
            }
          : { data: Array.from({ length: 5001 }, (_, i) => ({ id: `m${i}` })) },
      ),
      new Response("x".repeat(2 * 1024 * 1024 + 1)),
    ]) {
      const tooLarge = async () => response;
      await assert.rejects(
        fetchProviderModels(configuration, {
          fetch: tooLarge,
          fetchCodexModels: tooLarge,
        }),
        /too large/u,
      );
    }
  }
});

test("pre-cancelled discovery sends no request and a stuck transport has a finite deadline", async () => {
  for (const configuration of [provider(), codexProvider()]) {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const unexpected = async () =>
      assert.fail("pre-cancelled discovery must not request");
    await assert.rejects(
      fetchProviderModels(configuration, {
        fetch: unexpected,
        fetchCodexModels: unexpected,
        signal: controller.signal,
      }),
      /cancelled/u,
    );
    let requestSignal: AbortSignal | undefined;
    await assert.rejects(
      fetchProviderModels(configuration, {
        fetch: async (_url, init) => {
          requestSignal = init?.signal as AbortSignal;
          return new Promise<Response>(() => undefined);
        },
        fetchCodexModels: async (signal) => {
          requestSignal = signal;
          return new Promise<Response>(() => undefined);
        },
        timeoutMs: 10,
      }),
      /timed out/u,
    );
    assert.equal(requestSignal?.aborted, true);
  }
});
