import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { config } from "../../package.json";
import {
  LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE,
  LOCAL_PAPER_ROOT_PREFERENCE,
} from "../../src/application/local-paper-name-settings";

test("disabling the plugin while UI readiness is pending prevents late registrations", async (t) => {
  const ready = deferred();
  const harness = installRuntime(t, { uiReady: ready.promise });
  const hooks = await harness.load("ui-ready");

  hooks.onShutdown();
  ready.resolve();
  await setImmediate();

  assert.deepEqual(harness.registrations, []);
  assert.deepEqual(harness.errors, []);
  assert.equal(harness.zotero[config.addonInstance], undefined);
});

test("disabling the plugin while Preferences registration is pending removes the late pane", async (t) => {
  const registered = deferred();
  const registrationStarted = deferred();
  const harness = installRuntime(t, {
    register: async () => {
      registrationStarted.resolve();
      await registered.promise;
    },
  });
  const hooks = await harness.load("preferences");
  await registrationStarted.promise;

  hooks.onShutdown();
  registered.resolve();
  await setImmediate();

  assert.deepEqual([...harness.panes], []);
  assert.deepEqual([...harness.observers], []);
  assert.deepEqual([...harness.sections], []);
  assert.deepEqual(harness.errors, []);
});

test("the assembled plugin registers and removes its pane, Reader section, and local observer", async (t) => {
  const harness = installRuntime(t);
  const hooks = await harness.load("ready");
  await setImmediate();
  assert.deepEqual([...harness.panes], ["preferences"]);
  assert.deepEqual([...harness.observers], ["local-names"]);
  assert.deepEqual([...harness.sections], ["reader"]);

  hooks.onShutdown();
  hooks.onShutdown();

  assert.deepEqual([...harness.panes], []);
  assert.deepEqual([...harness.observers], []);
  assert.deepEqual([...harness.sections], []);
  assert.deepEqual(harness.errors, []);
});

function installRuntime(
  t: TestContext,
  options: { uiReady?: Promise<void>; register?(): Promise<void> } = {},
) {
  const panes = new Set<string>();
  const observers = new Set<string>();
  const sections = new Set<string>();
  const registrations: string[] = [];
  const errors: unknown[] = [];
  const zotero: Record<string, unknown> = {
    initializationPromise: Promise.resolve(),
    unlockPromise: Promise.resolve(),
    uiReadyPromise: options.uiReady ?? Promise.resolve(),
    getMainWindows: () => [],
    DataDirectory: { dir: "C:\\ZoteroData" },
    Prefs: {
      get(key: string) {
        if (key === LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE) return true;
        if (key === LOCAL_PAPER_ROOT_PREFERENCE) return "E:\\papers";
        return undefined;
      },
    },
    PreferencePanes: {
      async register() {
        registrations.push("preferences");
        await options.register?.();
        panes.add("preferences");
        return "preferences";
      },
      unregister(id: string) {
        assert.equal(panes.delete(id), true);
      },
    },
    ItemPaneManager: {
      registerSection() {
        registrations.push("reader");
        sections.add("reader");
        return "reader";
      },
      unregisterSection(id: string) {
        assert.equal(sections.delete(id), true);
      },
    },
    Notifier: {
      registerObserver() {
        registrations.push("local-names");
        observers.add("local-names");
        return "local-names";
      },
      unregisterObserver(id: string) {
        assert.equal(observers.delete(id), true);
      },
    },
    logError: (error: unknown) => errors.push(error),
  };
  const globals = {
    Zotero: zotero,
    _globalThis: { rootURI: "resource://reference-for-zotero/" },
    IOUtils: {
      async makeDirectory() {
        throw new Error("No Python assets are installed in the lifecycle test");
      },
    },
    PathUtils: { homeDir: "C:\\Users\\lifecycle-test" },
    Services: {
      appinfo: { XPCOMABI: "x86_64-gcc3" },
      env: { get: () => undefined },
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  return {
    panes,
    observers,
    sections,
    registrations,
    errors,
    zotero,
    async load(scenario: string) {
      await import(
        new URL(`../../src/index.ts?lifecycle=${scenario}`, import.meta.url)
          .href
      );
      return (
        zotero[config.addonInstance] as {
          hooks: { onShutdown(): void };
        }
      ).hooks;
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
