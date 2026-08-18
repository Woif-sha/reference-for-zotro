import assert from "node:assert/strict";
import test from "node:test";

import {
  CodexLoginRequiredError,
  LegacyCodexTransport,
  buildLegacyCodexPayload,
  resolveCodexAuthPath,
  type LegacyCodexResponseSchema,
  type LegacyCodexRuntime,
} from "../../src/model/legacy-codex-transport";

const encoder = new TextEncoder();

test("Legacy Codex uses plain text for connection tests and strict JSON schema for recommendations", () => {
  assert.deepEqual(
    buildLegacyCodexPayload({
      model: "gpt-5.4",
      effort: "medium",
      instructions: "Reply with exactly OK.",
      prompt: "Reply with exactly OK",
      responseFormat: "text",
    }),
    {
      model: "gpt-5.4",
      instructions: "Reply with exactly OK.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Reply with exactly OK" }],
        },
      ],
      store: false,
      stream: true,
      reasoning: { effort: "medium" },
    },
  );
  assert.deepEqual(
    buildLegacyCodexPayload({
      model: "gpt-5.4",
      effort: "medium",
      instructions: "Return the requested schema.",
      prompt: "{}",
      responseFormat: "json_schema",
      responseSchema: recommendationResponseSchema(),
    }),
    {
      model: "gpt-5.4",
      instructions: "Return the requested schema.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "{}" }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          ...recommendationResponseSchema(),
        },
      },
      store: false,
      stream: true,
      reasoning: { effort: "medium" },
    },
  );
});

function recommendationResponseSchema(): LegacyCodexResponseSchema {
  const item = {
    type: "object",
    additionalProperties: false,
    required: ["id", "reason"],
    properties: {
      id: { type: "string" },
      reason: { type: "string" },
    },
  };
  return {
    name: "related_paper_recommendation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "priority", "optional"],
      properties: {
        schemaVersion: { type: "integer", enum: [1] },
        priority: { type: "array", items: item },
        optional: { type: "array", items: item },
      },
    },
  };
}

test("Legacy auth path prefers CODEX_HOME, then home environment, then Zotero homes", () => {
  assert.equal(
    resolveCodexAuthPath(runtime({ CODEX_HOME: "D:\\Codex" })),
    "D:\\Codex\\auth.json",
  );
  assert.equal(
    resolveCodexAuthPath(runtime({ HOME: "C:\\Users\\paper" })),
    "C:\\Users\\paper\\.codex\\auth.json",
  );
  assert.equal(
    resolveCodexAuthPath({ ...runtime({}), pathUtilsHome: "C:\\PathUtils" }),
    "C:\\PathUtils\\.codex\\auth.json",
  );
  assert.equal(
    resolveCodexAuthPath({ ...runtime({}), zoteroHome: "C:\\ZoteroHome" }),
    "C:\\ZoteroHome\\.codex\\auth.json",
  );
});

test("Legacy request refreshes once after 401 and never falls back or retries a second 401", async () => {
  const harness = transportHarness();
  harness.fetchResponses.push(
    new Response("unauthorized", { status: 401 }),
    jsonResponse({ access_token: "access-new", refresh_token: "refresh-new" }),
    new Response("still unauthorized", { status: 401 }),
  );

  await assert.rejects(
    harness.transport.run(request()),
    CodexLoginRequiredError,
  );

  assert.deepEqual(
    harness.fetchCalls.map((call) => call.url),
    [
      "https://chatgpt.com/backend-api/codex/responses",
      "https://auth.openai.com/oauth/token",
      "https://chatgpt.com/backend-api/codex/responses",
    ],
  );
});

test("concurrent 401s share one refresh and atomically preserve unknown auth fields", async () => {
  const harness = transportHarness();
  harness.document = {
    auth_mode: "chatgpt",
    custom: { keep: true },
    tokens: {
      access_token: "access-old",
      refresh_token: "refresh-old",
      account_id: "account",
    },
  };
  const refresh = deferred<Response>();
  let apiCalls = 0;
  harness.fetch = async (input) => {
    const url = String(input);
    harness.fetchCalls.push({ url });
    if (url === "https://auth.openai.com/oauth/token") return refresh.promise;
    apiCalls += 1;
    if (apiCalls <= 2) return new Response("unauthorized", { status: 401 });
    return completedResponse("OK");
  };

  const first = harness.transport.run(request());
  const second = harness.transport.run(request());
  await until(
    () =>
      harness.fetchCalls.filter((call) => call.url.includes("oauth/token"))
        .length === 1,
  );
  refresh.resolve(
    jsonResponse({ access_token: "access-new", refresh_token: "refresh-new" }),
  );

  assert.deepEqual(await Promise.all([first, second]), [
    { text: "OK" },
    { text: "OK" },
  ]);
  assert.equal(
    harness.fetchCalls.filter((call) => call.url.includes("oauth/token"))
      .length,
    1,
  );
  assert.equal(harness.writes.length, 1);
  assert.equal(
    harness.writes[0].tmpPath,
    "C:\\Codex\\auth.json.reference-for-zotero.tmp",
  );
  assert.deepEqual(harness.document.custom, { keep: true });
  assert.equal(harness.document.tokens?.account_id, "account");
});

test("Legacy refresh adopts an external auth update before write and does not overwrite it", async () => {
  const harness = transportHarness();
  const refresh = deferred<Response>();
  harness.fetchResponses.push(
    new Response("unauthorized", { status: 401 }),
    refresh.promise,
    completedResponse("external"),
  );

  const pending = harness.transport.run(request());
  await until(() =>
    harness.fetchCalls.some((call) => call.url.includes("oauth/token")),
  );
  harness.document = authDocument("access-external", "refresh-external");
  refresh.resolve(
    jsonResponse({
      access_token: "access-oauth",
      refresh_token: "refresh-oauth",
    }),
  );

  assert.deepEqual(await pending, { text: "external" });
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.document.tokens?.access_token, "access-external");
});

test("Legacy refresh adopts an external auth update before sending OAuth", async () => {
  const harness = transportHarness();
  let apiCalls = 0;
  harness.fetch = async (input) => {
    const url = String(input);
    harness.fetchCalls.push({ url });
    if (url.includes("oauth/token")) {
      throw new Error(
        "OAuth must not use an externally replaced refresh token",
      );
    }
    apiCalls += 1;
    if (apiCalls === 1) {
      harness.document = authDocument("access-external", "refresh-external");
      return new Response("unauthorized", { status: 401 });
    }
    return completedResponse("external");
  };

  assert.deepEqual(await harness.transport.run(request()), {
    text: "external",
  });
  assert.equal(
    harness.fetchCalls.some((call) => call.url.includes("oauth/token")),
    false,
  );
  assert.equal(harness.writes.length, 0);
});

test("Legacy refresh rereads and adopts external credentials after invalid_grant", async () => {
  const harness = transportHarness();
  const rejected = deferred<Response>();
  harness.fetchResponses.push(
    new Response("unauthorized", { status: 401 }),
    rejected.promise,
    completedResponse("external"),
  );

  const pending = harness.transport.run(request());
  await until(() =>
    harness.fetchCalls.some((call) => call.url.includes("oauth/token")),
  );
  harness.document = authDocument("access-external", "refresh-external");
  rejected.resolve(
    new Response('{"error":"invalid_grant"}', {
      status: 400,
      statusText: "Bad Request",
    }),
  );

  assert.deepEqual(await pending, { text: "external" });
  assert.equal(harness.writes.length, 0);
});

test("Legacy shutdown cancels active refreshes without writing credentials", async () => {
  const harness = transportHarness();
  harness.fetch = async (input, init) => {
    const url = String(input);
    harness.fetchCalls.push({ url });
    if (url.includes("oauth/token")) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    }
    return new Response("unauthorized", { status: 401 });
  };

  const pending = harness.transport.run(request());
  await until(() =>
    harness.fetchCalls.some((call) => call.url.includes("oauth/token")),
  );
  harness.transport.shutdown();

  await assert.rejects(pending, /cancelled/u);
  assert.equal(harness.writes.length, 0);
});

test("Legacy transport recursively removes access and refresh tokens from errors", async () => {
  const harness = transportHarness();
  const accessToken = String(harness.document.tokens?.access_token);
  const refreshToken = String(harness.document.tokens?.refresh_token);
  harness.fetchResponses.push(
    new Response(
      `data: ${JSON.stringify({
        error: { message: `${accessToken} / ${refreshToken}` },
      })}\n\n`,
      { status: 200 },
    ),
  );

  await assert.rejects(harness.transport.run(request()), (error: unknown) => {
    assert.match(String(error), /\[TOKEN REDACTED\]/u);
    assert.doesNotMatch(String(error), new RegExp(accessToken, "u"));
    assert.doesNotMatch(String(error), new RegExp(refreshToken, "u"));
    return true;
  });
});

test("Legacy transport redacts refresh-only authentication failures", async () => {
  const harness = transportHarness();
  harness.document = authDocument("", "refresh-only-secret");
  harness.fetch = async () => {
    throw new Error("network request contained refresh-only-secret");
  };

  await assert.rejects(harness.transport.run(request()), (error: unknown) => {
    assert.match(String(error), /\[TOKEN REDACTED\]/u);
    assert.doesNotMatch(String(error), /refresh-only-secret/u);
    return true;
  });
});

test("Legacy transport classifies JSON schema rejection", async () => {
  const harness = transportHarness();
  harness.fetchResponses.push(
    new Response('{"error":"text.format json_schema is not supported"}', {
      status: 400,
      statusText: "Bad Request",
    }),
  );

  await assert.rejects(
    harness.transport.run({
      ...request(),
      responseFormat: "json_schema",
      responseSchema: recommendationResponseSchema(),
    }),
    /analysis_structured_output_unsupported/u,
  );
});

test("Legacy recommendation responses enforce visible output and stream byte budgets", async () => {
  const outputHarness = transportHarness();
  outputHarness.fetchResponses.push(completedResponse("LONG"));
  await assert.rejects(
    outputHarness.transport.run({ ...request(), maxOutputCharacters: 3 }),
    /3-character limit/u,
  );

  const streamHarness = transportHarness();
  streamHarness.fetchResponses.push(completedResponse("OK"));
  await assert.rejects(
    streamHarness.transport.run({ ...request(), maxResponseBytes: 10 }),
    /10-byte limit/u,
  );
});

test("Legacy recommendation responses tolerate large non-text events and stop after completion", async () => {
  const eventHarness = transportHarness();
  const response = completedResponseWithIgnoredEvent("OK", 131_000);
  const deltas: string[] = [];
  assert.ok(response.bytes > 128 * 1024);
  eventHarness.fetchResponses.push(response.value);
  assert.deepEqual(
    await eventHarness.transport.run({
      ...request(),
      onTextDelta: (delta) => deltas.push(delta),
    }),
    { text: "OK" },
  );
  assert.deepEqual(deltas, ["OK"]);

  const completionHarness = transportHarness();
  completionHarness.fetchResponses.push(completedThenTrailingResponse("OK"));
  assert.deepEqual(
    await completionHarness.transport.run({
      ...request(),
      maxResponseBytes: 200,
    }),
    { text: "OK" },
  );
});

function request() {
  return {
    model: "gpt-5.4",
    effort: "medium",
    instructions: "Return JSON.",
    prompt: "{}",
    responseFormat: "json_object" as const,
  };
}

function transportHarness() {
  const fetchCalls: Array<{ url: string }> = [];
  const fetchResponses: Array<Response | Promise<Response>> = [];
  const writes: Array<{ tmpPath?: string }> = [];
  const harness: {
    document: AuthDocumentFixture;
    fetchCalls: Array<{ url: string }>;
    fetchResponses: Array<Response | Promise<Response>>;
    writes: Array<{ tmpPath?: string }>;
    fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
    transport: LegacyCodexTransport;
  } = {
    document: authDocument("access-old", "refresh-old"),
    fetchCalls,
    fetchResponses,
    writes,
    fetch: async (input: string | URL | Request) => {
      fetchCalls.push({ url: String(input) });
      const response = fetchResponses.shift();
      if (!response) throw new Error("Unexpected fetch");
      return response;
    },
    transport: undefined as unknown as LegacyCodexTransport,
  };
  harness.transport = new LegacyCodexTransport({
    ...runtime({ CODEX_HOME: "C:\\Codex" }),
    io: {
      async read() {
        return encoder.encode(JSON.stringify(harness.document));
      },
      async write(_path, data, options) {
        writes.push({ tmpPath: options?.tmpPath });
        harness.document = JSON.parse(new TextDecoder().decode(data));
      },
    },
    fetch: (input, init) => harness.fetch(input, init),
  });
  return harness;
}

function runtime(environment: Record<string, string>): LegacyCodexRuntime {
  return {
    environment(name) {
      return environment[name];
    },
    io: {
      async read() {
        throw new Error("not used");
      },
      async write() {
        throw new Error("not used");
      },
    },
    async fetch() {
      throw new Error("not used");
    },
  };
}

type AuthDocumentFixture = {
  tokens?: Record<string, unknown>;
  [key: string]: unknown;
};

function authDocument(
  accessToken: string,
  refreshToken: string,
): AuthDocumentFixture {
  return {
    tokens: {
      access_token: accessToken,
      refresh_token: refreshToken,
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function completedResponse(text: string): Response {
  return new Response(
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\ndata: ${JSON.stringify({ type: "response.completed" })}\n\n`,
    { status: 200 },
  );
}

function completedResponseWithIgnoredEvent(
  text: string,
  padding: number,
): Readonly<{ bytes: number; value: Response }> {
  const body = `data: ${JSON.stringify({ type: "response.created", metadata: "x".repeat(padding) })}\n\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\ndata: ${JSON.stringify({ type: "response.completed" })}\n\n`;
  return {
    bytes: encoder.encode(body).byteLength,
    value: new Response(body, { status: 200 }),
  };
}

function completedThenTrailingResponse(text: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\ndata: ${JSON.stringify({ type: "response.completed" })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "response.created", metadata: "x".repeat(1_000) })}\n\n`,
          ),
        );
        controller.close();
      },
    }),
    { status: 200 },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}
