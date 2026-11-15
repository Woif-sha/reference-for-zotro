import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { setImmediate } from "node:timers/promises";
import { config } from "../../package.json";
import {
  LOCAL_PAPER_NAME_SYNC_ENABLED_PREFERENCE,
  LOCAL_PAPER_ROOT_PREFERENCE,
} from "../../src/application/local-paper-name-settings";
import { REFERENCE_FOR_ZOTERO_PREFERENCES_ID } from "../../src/preferences/download-preferences";

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
  assert.deepEqual(harness.panes, [
    { id: REFERENCE_FOR_ZOTERO_PREFERENCES_ID, registration: 1 },
  ]);
  assert.deepEqual([...harness.observers], ["local-names"]);
  assert.deepEqual([...harness.sections], ["reader"]);

  hooks.onShutdown();
  hooks.onShutdown();

  assert.deepEqual([...harness.panes], []);
  assert.deepEqual([...harness.observers], []);
  assert.deepEqual([...harness.sections], []);
  assert.deepEqual(harness.errors, []);
});

test("reenabling the plugin preserves the new Preferences pane after the old registration finishes", async (t) => {
  const registered = deferred();
  const registrationStarted = deferred();
  const harness = installRuntime(t, {
    register: async (registration) => {
      if (registration !== 1) return;
      registrationStarted.resolve();
      await registered.promise;
    },
  });
  const oldHooks = await harness.load("reenable-old");
  await registrationStarted.promise;
  oldHooks.onShutdown();
  const newHooks = await harness.load("reenable-new");
  await setImmediate();

  try {
    registered.resolve();
    await setImmediate();

    assert.deepEqual(harness.panes, [
      { id: REFERENCE_FOR_ZOTERO_PREFERENCES_ID, registration: 2 },
    ]);
    assert.deepEqual([...harness.observers], ["local-names"]);
    assert.deepEqual([...harness.sections], ["reader"]);
    assert.deepEqual(harness.errors, []);
  } finally {
    newHooks.onShutdown();
  }
  assert.deepEqual(harness.panes, []);
  assert.deepEqual([...harness.observers], []);
  assert.deepEqual([...harness.sections], []);
});

test("disabling a runtime waiting for the previous registration lets the next enable start once", async (t) => {
  const registered = deferred();
  const registrationStarted = deferred();
  const harness = installRuntime(t, {
    register: async (registration) => {
      if (registration !== 1) return;
      registrationStarted.resolve();
      await registered.promise;
    },
  });
  const firstHooks = await harness.load("waiting-first");
  await registrationStarted.promise;
  firstHooks.onShutdown();
  const secondHooks = await harness.load("waiting-second");
  await setImmediate();
  secondHooks.onShutdown();
  const thirdHooks = await harness.load("waiting-third");
  await setImmediate();

  try {
    registered.resolve();
    await setImmediate();

    assert.deepEqual(harness.registrations, [
      "local-names",
      "preferences",
      "local-names",
      "preferences",
      "reader",
    ]);
    assert.deepEqual(harness.panes, [
      { id: REFERENCE_FOR_ZOTERO_PREFERENCES_ID, registration: 2 },
    ]);
    assert.deepEqual([...harness.observers], ["local-names"]);
    assert.deepEqual([...harness.sections], ["reader"]);
    assert.deepEqual(harness.errors, []);
  } finally {
    thirdHooks.onShutdown();
  }
  assert.deepEqual(harness.panes, []);
  assert.deepEqual([...harness.observers], []);
  assert.deepEqual([...harness.sections], []);
});

test("a failed old Preferences registration reports its error and releases the next enable", async (t) => {
  const registered = deferred();
  const registrationStarted = deferred();
  const failure = new Error("Preferences registration failed");
  const harness = installRuntime(t, {
    register: async (registration) => {
      if (registration !== 1) return;
      registrationStarted.resolve();
      await registered.promise;
      throw failure;
    },
  });
  const oldHooks = await harness.load("failed-old");
  await registrationStarted.promise;
  oldHooks.onShutdown();
  const newHooks = await harness.load("failed-new");
  await setImmediate();

  try {
    registered.resolve();
    await setImmediate();

    assert.deepEqual(harness.panes, [
      { id: REFERENCE_FOR_ZOTERO_PREFERENCES_ID, registration: 2 },
    ]);
    assert.deepEqual([...harness.observers], ["local-names"]);
    assert.deepEqual([...harness.sections], ["reader"]);
    assert.deepEqual(harness.errors, [failure]);
  } finally {
    newHooks.onShutdown();
  }
  assert.deepEqual(harness.panes, []);
  assert.deepEqual([...harness.observers], []);
  assert.deepEqual([...harness.sections], []);
});

function installRuntime(
  t: TestContext,
  options: {
    uiReady?: Promise<void>;
    register?(registration: number): Promise<void>;
  } = {},
) {
  const panes: { id: string; registration: number }[] = [];
  let preferenceRegistrations = 0;
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
      async register({ id }: { id: string }) {
        if (panes.some((pane) => pane.id === id)) {
          throw new Error(`Preferences pane already registered: ${id}`);
        }
        const registration = ++preferenceRegistrations;
        registrations.push("preferences");
        await options.register?.(registration);
        panes.push({ id, registration });
        return id;
      },
      unregister(id: string) {
        panes.splice(
          0,
          panes.length,
          ...panes.filter((pane) => pane.id !== id),
        );
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
