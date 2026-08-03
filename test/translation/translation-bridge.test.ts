import assert from "node:assert/strict";
import test from "node:test";
import { PaperTranslateBridge } from "../../src/translation/paper-translate-bridge";
import { createPaperTranslateBridge } from "../../src/platform/zotero-runtime";

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
  const bridge = new PaperTranslateBridge(() => ({
    api: {
      getVersion: () => 140,
      translate: async () => ({ result: "ignored" }),
    },
  }));

  assert.deepEqual(bridge.capability(), {
    available: false,
    reason: "incompatible-version",
  });
});

test("a prerelease of the minimum version is not treated as the stable minimum", () => {
  const prerelease = new PaperTranslateBridge(() => ({
    api: {
      getVersion: () => "1.4.0-beta.1",
      translate: async () => ({ result: "ignored" }),
    },
  }));
  const buildMetadata = new PaperTranslateBridge(() => ({
    api: {
      getVersion: () => "1.4.0+build.7",
      translate: async () => ({ result: "available" }),
    },
  }));

  assert.deepEqual(prerelease.capability(), {
    available: false,
    reason: "incompatible-version",
  });
  assert.deepEqual(buildMetadata.capability(), { available: true });
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

test("the Zotero adapter uses the public PDFTranslate global and exact caller context", async () => {
  const calls: unknown[][] = [];
  const originalZotero = Object.getOwnPropertyDescriptor(globalThis, "Zotero");
  Object.defineProperty(globalThis, "Zotero", {
    configurable: true,
    value: {
      PDFTranslate: {
        api: {
          getVersion: () => "2.4.6",
          translate: async (...args: unknown[]) => {
            calls.push(args);
            return { result: "译文" };
          },
        },
      },
      PaperTranslate: {
        api: {
          getVersion: () => "99.0.0",
          translate: async () => {
            throw new Error("wrong global");
          },
        },
      },
    },
  });

  try {
    const bridge = createPaperTranslateBridge();
    assert.equal(
      await bridge.translate("academic text", {
        pluginID: "referenceforzotero@woif-sha.github.io",
        itemID: 42,
      }),
      "译文",
    );
    assert.deepEqual(calls, [
      [
        "academic text",
        {
          pluginID: "referenceforzotero@woif-sha.github.io",
          itemID: 42,
        },
      ],
    ]);
  } finally {
    if (originalZotero) {
      Object.defineProperty(globalThis, "Zotero", originalZotero);
    } else {
      Reflect.deleteProperty(globalThis, "Zotero");
    }
  }
});

test("a single translate failure does not change the compatible capability", async () => {
  let calls = 0;
  const bridge = new PaperTranslateBridge(() => ({
    api: {
      getVersion: () => "1.4.0",
      translate: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary model failure");
        return { result: "recovered" };
      },
    },
  }));

  await assert.rejects(
    bridge.translate("first", { pluginID: "test", itemID: 1 }),
    /temporary model failure/u,
  );
  assert.deepEqual(bridge.capability(), { available: true });
  assert.equal(
    await bridge.translate("second", { pluginID: "test", itemID: 1 }),
    "recovered",
  );
});
