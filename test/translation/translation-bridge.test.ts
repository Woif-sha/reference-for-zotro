import assert from "node:assert/strict";
import test from "node:test";
import { PaperTranslateBridge } from "../../src/translation/paper-translate-bridge";

test("missing Paper Translate is explicitly unavailable", () => {
  const bridge = new PaperTranslateBridge(() => undefined);

  assert.deepEqual(bridge.capability(), {
    available: false,
    reason: "not-installed",
  });
});

test("an incompatible public API is explicitly unavailable", () => {
  const bridge = new PaperTranslateBridge(() => ({
    api: {
      getVersion: () => "1.3.9",
      translate: async () => ({ result: "ignored" }),
    },
  }));

  assert.deepEqual(bridge.capability(), {
    available: false,
    reason: "incompatible-version",
  });
});

test("compatible translation stays behind the bridge", async () => {
  const bridge = new PaperTranslateBridge(() => ({
    api: {
      getVersion: () => "1.4.0",
      translate: async (text, context) => ({
        result: `${context.pluginID}:${context.itemID}:${text}`,
      }),
    },
  }));

  assert.equal(
    await bridge.translate("attention", {
      pluginID: "referenceforzotero@woif-sha.github.io",
      itemID: 42,
    }),
    "referenceforzotero@woif-sha.github.io:42:attention",
  );
});
