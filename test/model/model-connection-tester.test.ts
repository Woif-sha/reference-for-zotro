import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelConnectionTester,
  type ConnectionTestTransports,
} from "../../src/model/model-connection-tester";
import type { RuntimeModel } from "../../src/model/model-configuration";

test("a new draft connection test cancels the previous test and uses only the selected transport", async () => {
  const signals: AbortSignal[] = [];
  const transports: ConnectionTestTransports = {
    legacy: async (_model, signal) => pendingUntilAbort(signal, signals),
    openAICompatible: async (_model, signal) => {
      signals.push(signal);
      return "OK";
    },
  };
  const tester = new ModelConnectionTester(transports);

  const oldTest = tester.test(codexModel());
  const newTest = tester.test(apiModel());

  await assert.rejects(oldTest, /cancelled/u);
  assert.equal(await newTest, "OK");
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test("connection tests time out after 30 seconds and Preferences disposal cancels all tests", async () => {
  const scheduled: Array<{ milliseconds: number; callback: () => void }> = [];
  const signals: AbortSignal[] = [];
  const tester = new ModelConnectionTester(
    {
      legacy: async (_model, signal) => pendingUntilAbort(signal, signals),
      openAICompatible: async (_model, signal) =>
        pendingUntilAbort(signal, signals),
    },
    {
      schedule(callback, milliseconds) {
        scheduled.push({ callback, milliseconds });
        return callback;
      },
      cancel() {},
    },
  );

  const timedOut = tester.test(codexModel());
  assert.equal(scheduled[0].milliseconds, 30_000);
  scheduled[0].callback();
  await assert.rejects(timedOut, /timed out/u);

  const disposed = tester.test(apiModel());
  tester.dispose();
  await assert.rejects(disposed, /cancelled/u);
  assert.equal(
    signals.every((signal) => signal.aborted),
    true,
  );
});

function pendingUntilAbort(
  signal: AbortSignal,
  signals: AbortSignal[],
): Promise<string> {
  signals.push(signal);
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function codexModel(): RuntimeModel {
  return {
    id: "model-codex",
    model: "gpt-5.4",
    effort: "medium",
    providerId: "provider-codex",
    providerName: "Legacy Codex",
    authMode: "codex_auth",
    apiBase: "https://chatgpt.com/backend-api/codex/responses",
    apiKey: "",
    active: true,
  };
}

function apiModel(): RuntimeModel {
  return {
    id: "model-api",
    model: "example-model",
    effort: "",
    providerId: "provider-api",
    providerName: "Example API",
    authMode: "openai_compatible",
    apiBase: "https://api.example.com/v1/chat/completions",
    apiKey: "secret",
    active: false,
  };
}
