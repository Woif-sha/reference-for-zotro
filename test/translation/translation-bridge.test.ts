import assert from "node:assert/strict";
import test from "node:test";
import {
  PaperTranslateBridge,
  type PaperTranslateGlobal,
} from "../../src/translation/paper-translate-bridge";

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

test("a compatible version without the public translate API is unavailable", () => {
  const bridge = new PaperTranslateBridge(() => ({
    api: {
      getVersion: () => "1.4.0",
    },
  }));

  assert.deepEqual(bridge.capability(), {
    available: false,
    reason: "incompatible-api",
  });
});

test("a failing version probe disables translation without escaping the bridge", () => {
  const bridge = new PaperTranslateBridge(() => ({
    api: {
      getVersion() {
        throw new Error("Paper Translate is still starting");
      },
      translate: async () => ({ result: "ignored" }),
    },
  }));

  assert.deepEqual(bridge.capability(), {
    available: false,
    reason: "incompatible-version",
  });
});

test("a non-string public version is an incompatible API shape", () => {
  const bridge = new PaperTranslateBridge(
    () =>
      ({
        api: {
          getVersion: () => 140,
          translate: async () => ({ result: "ignored" }),
        },
      }) as unknown as PaperTranslateGlobal,
  );

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
