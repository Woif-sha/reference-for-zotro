import assert from "node:assert/strict";
import test from "node:test";

import { createProvider } from "../../src/model/model-configuration";
import { createZoteroModelSubsystem } from "../../src/platform/zotero-model-runtime";

test("Preferences model discovery uses this plugin's provider credentials without saving a model", async (t) => {
  const writes: unknown[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  let authReads = 0;
  const globals: Record<string, unknown> = {
    Zotero: {
      Prefs: {
        get: () => undefined,
        set: (...args: unknown[]) => writes.push(args),
      },
    },
    IOUtils: {
      async read() {
        authReads += 1;
        return new TextEncoder().encode(
          JSON.stringify({
            tokens: {
              access_token: "local-access",
              account_id: "local-account",
            },
          }),
        );
      },
      async write() {
        throw new Error("Catalog discovery must not rewrite valid auth");
      },
    },
    PathUtils: { homeDir: "C:\\Users\\model-test" },
    Services: { env: { get: () => undefined } },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      return Response.json(
        url.startsWith("https://chatgpt.com/")
          ? { models: [{ slug: "gpt-codex", visibility: "list" }] }
          : { data: [{ id: "gateway-model" }] },
      );
    },
  );
  const subsystem = createZoteroModelSubsystem();
  t.after(() => subsystem.shutdown());
  const signal = new AbortController().signal;
  const apiProvider = {
    ...createProvider("openai_compatible"),
    apiBase: "https://gateway.example/prefix/v1/chat/completions?tenant=test",
    apiKey: "independent-api-key",
  };
  const apiModels = await subsystem.settings.loadModels(apiProvider, signal);
  assert.deepEqual(
    apiModels.map((model) => model.id),
    ["gateway-model"],
  );
  assert.equal(authReads, 0);
  assert.equal(
    requests[0].url,
    "https://gateway.example/prefix/v1/models?tenant=test",
  );
  assert.equal(
    new Headers(requests[0].init?.headers).get("Authorization"),
    "Bearer independent-api-key",
  );
  assert.equal(requests[0].init?.redirect, "error");

  const codexModels = await subsystem.settings.loadModels(
    createProvider("codex_auth"),
    signal,
  );
  assert.deepEqual(
    codexModels.map((model) => model.id),
    ["gpt-codex"],
  );
  assert.equal(authReads, 1);
  assert.match(
    requests[1].url,
    /^https:\/\/chatgpt\.com\/backend-api\/codex\/models\?/u,
  );
  assert.equal(
    new Headers(requests[1].init?.headers).get("Authorization"),
    "Bearer local-access",
  );
  assert.equal(
    new Headers(requests[1].init?.headers).get("ChatGPT-Account-ID"),
    "local-account",
  );
  assert.equal(requests[1].init?.redirect, "error");
  assert.deepEqual(writes, []);
});
