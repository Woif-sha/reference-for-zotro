import assert from "node:assert/strict";
import test from "node:test";

import { createProviderPorts } from "../../src/platform/zotero-runtime";

test("paper cancellation aborts a provider response body after headers arrive", async (t) => {
  const session = new AbortController();
  const network = pendingResponse();
  t.mock.method(globalThis, "fetch", network.fetch);
  const response = await createProviderPorts().fetch(
    "https://publisher.example/paper",
    { signal: session.signal },
  );
  const reading = response.text();
  try {
    session.abort();
    assert.equal(network.signal()?.aborted, true);
    await assert.rejects(reading, { name: "AbortError" });
  } finally {
    network.finish();
    await reading.catch(() => undefined);
  }
});

test("the provider deadline covers a stalled body after successful headers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const network = pendingResponse();
  t.mock.method(globalThis, "fetch", network.fetch);
  const response = await createProviderPorts().fetch(
    "https://publisher.example/paper",
  );
  const reading = response.text();
  try {
    t.mock.timers.tick(10_001);
    assert.equal(network.signal()?.aborted, true);
    await assert.rejects(reading, { name: "AbortError" });
  } finally {
    network.finish();
    await reading.catch(() => undefined);
  }
});

test("provider body completion retains the final landing URL and headers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      const response = new Response("paper metadata", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
      Object.defineProperties(response, {
        url: { value: "https://publisher.example/final" },
        redirected: { value: true },
      });
      return response;
    },
  );
  const response = await createProviderPorts().fetch(
    "https://publisher.example/paper",
  );
  assert.equal(await response.text(), "paper metadata");
  assert.equal(response.url, "https://publisher.example/final");
  assert.equal(response.redirected, true);
  assert.equal(response.headers.get("Content-Type"), "text/html");
  t.mock.timers.tick(10_001);
  assert.equal(signal?.aborted, false);
});

function pendingResponse() {
  let signal: AbortSignal | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let finished = false;
  return {
    signal: () => signal,
    fetch: (async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            signal?.addEventListener(
              "abort",
              () => {
                finished = true;
                controller.error(signal?.reason);
              },
              { once: true },
            );
          },
        }),
      );
    }) as typeof fetch,
    finish() {
      if (!finished) streamController.close();
      finished = true;
    },
  };
}
