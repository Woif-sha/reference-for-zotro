import assert from "node:assert/strict";
import test from "node:test";

import {
  OpenAICompatibleStreamParser,
  buildOpenAICompatiblePayload,
  runOpenAICompatibleRequest,
  testOpenAICompatibleConnection,
} from "../../src/model/openai-compatible-transport";

test("OpenAI Compatible uses plain text for connection tests and JSON object mode for recommendations", () => {
  assert.deepEqual(
    buildOpenAICompatiblePayload({
      model: "example-model",
      instructions: "Reply with exactly OK.",
      prompt: "Reply with exactly OK",
      responseFormat: "text",
    }),
    {
      model: "example-model",
      messages: [
        { role: "system", content: "Reply with exactly OK." },
        { role: "user", content: "Reply with exactly OK" },
      ],
      stream: true,
    },
  );
  assert.deepEqual(
    buildOpenAICompatiblePayload({
      model: "example-model",
      instructions: "Return the requested schema.",
      prompt: "{}",
      responseFormat: "json_object",
    }),
    {
      model: "example-model",
      messages: [
        { role: "system", content: "Return the requested schema." },
        { role: "user", content: "{}" },
      ],
      response_format: { type: "json_object" },
      stream: true,
    },
  );
});

test("OpenAI Compatible requires SSE DONE and stops reading when it arrives", async () => {
  const parser = new OpenAICompatibleStreamParser();
  parser.feed(
    'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
  );
  assert.equal(parser.finish().text, "OK");

  const incomplete = new OpenAICompatibleStreamParser();
  incomplete.feed('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  assert.throws(() => incomplete.finish(), /without \[DONE\]/u);

  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
        ),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await runOpenAICompatibleRequest({
    endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: "secret",
    model: "example-model",
    instructions: "Return JSON.",
    prompt: "{}",
    responseFormat: "json_object",
    fetch: async () => new Response(stream, { status: 200 }),
  });
  assert.equal(result.text, "OK");
  assert.equal(cancelled, true);
});

test("OpenAI Compatible ignores every frame after DONE in the same chunk", () => {
  const parser = new OpenAICompatibleStreamParser();
  parser.feed(
    'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"late"}}]}\n\n',
  );

  assert.equal(parser.finish().text, "OK");
});

test("OpenAI Compatible rejects a length-truncated stream even when its text is valid JSON", () => {
  const parser = new OpenAICompatibleStreamParser();
  assert.throws(
    () =>
      parser.feed(
        'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      ),
    /finish_reason length/u,
  );
});

test("OpenAI Compatible bounds error bodies and recursively redacts API keys", async () => {
  const apiKey = "private-key-that-must-not-leak";
  await assert.rejects(
    runOpenAICompatibleRequest({
      endpoint: "https://api.example.com/v1/chat/completions",
      apiKey,
      model: "example-model",
      instructions: "Return JSON.",
      prompt: "{}",
      responseFormat: "json_object",
      fetch: async () =>
        new Response(`invalid credential ${apiKey}`, {
          status: 401,
          statusText: "Unauthorized",
        }),
    }),
    (error: unknown) => {
      assert.match(String(error), /\[API KEY REDACTED\]/u);
      assert.doesNotMatch(String(error), new RegExp(apiKey, "u"));
      return true;
    },
  );

  await assert.rejects(
    runOpenAICompatibleRequest({
      endpoint: "https://api.example.com/v1/chat/completions",
      apiKey,
      model: "example-model",
      instructions: "Return JSON.",
      prompt: "{}",
      responseFormat: "json_object",
      fetch: async () => new Response("x".repeat(65_537), { status: 500 }),
    }),
    /65536-byte limit/u,
  );
});

test("draft connection test sends the fixed minimal plain-text request", async () => {
  let body: unknown;
  const reply = await testOpenAICompatibleConnection({
    endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: "secret",
    model: "example-model",
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
        { status: 200 },
      );
    },
  });

  assert.equal(reply, "OK");
  assert.deepEqual(body, {
    model: "example-model",
    messages: [
      { role: "system", content: "Reply with exactly OK." },
      { role: "user", content: "Reply with exactly OK" },
    ],
    stream: true,
  });
});

test("OpenAI Compatible classifies JSON object mode rejection", async () => {
  await assert.rejects(
    runOpenAICompatibleRequest({
      endpoint: "https://api.example.com/v1/chat/completions",
      apiKey: "secret",
      model: "example-model",
      instructions: "Return JSON.",
      prompt: "{}",
      responseFormat: "json_object",
      fetch: async () =>
        new Response(
          '{"error":"response_format json_object is not supported"}',
          { status: 400, statusText: "Bad Request" },
        ),
    }),
    /analysis_structured_output_unsupported/u,
  );
});

test("OpenAI Compatible recommendation responses enforce visible output and stream byte budgets", async () => {
  await assert.rejects(
    runOpenAICompatibleRequest({
      endpoint: "https://api.example.com/v1/chat/completions",
      apiKey: "secret",
      model: "example-model",
      instructions: "Return JSON.",
      prompt: "{}",
      responseFormat: "json_object",
      maxOutputCharacters: 3,
      fetch: async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"LONG"}}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        ),
    }),
    /3-character limit/u,
  );
  await assert.rejects(
    runOpenAICompatibleRequest({
      endpoint: "https://api.example.com/v1/chat/completions",
      apiKey: "secret",
      model: "example-model",
      instructions: "Return JSON.",
      prompt: "{}",
      responseFormat: "json_object",
      maxResponseBytes: 10,
      fetch: async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        ),
    }),
    /10-byte limit/u,
  );
});
