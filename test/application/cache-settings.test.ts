import assert from "node:assert/strict";
import test from "node:test";

import {
  CACHE_ROOT_PREFERENCE,
  CacheSettingsCoordinator,
} from "../../src/application/cache-settings";

test("Cache settings derive the default root without persisting it", () => {
  const writes: Array<readonly [string, string]> = [];
  const settings = new CacheSettingsCoordinator({
    defaultCacheRoot: () => "C:\\ZoteroData\\reference-for-zotero-cache",
    getPreference: () => undefined,
    setPreference(key, value) {
      writes.push([key, value]);
    },
    clearPreference() {},
    async chooseCacheRoot() {
      return undefined;
    },
  });

  assert.deepEqual(settings.getState(), {
    cacheRoot: "C:\\ZoteroData\\reference-for-zotero-cache",
    usingDefaultRoot: true,
  });
  assert.deepEqual(writes, []);
});

test("Cache settings persist a selected root and clear only the preference on reset", async () => {
  const writes: Array<readonly [string, string]> = [];
  const clears: string[] = [];
  const owner = {} as Window;
  const settings = new CacheSettingsCoordinator({
    defaultCacheRoot: () => "C:\\ZoteroData\\reference-for-zotero-cache",
    getPreference: () => undefined,
    setPreference(key, value) {
      writes.push([key, value]);
    },
    clearPreference(key) {
      clears.push(key);
    },
    async chooseCacheRoot(current, pickerOwner) {
      assert.equal(current, "C:\\ZoteroData\\reference-for-zotero-cache");
      assert.equal(pickerOwner, owner);
      return "D:/ReferenceCache/";
    },
  });

  await settings.changeCacheRoot(owner);

  assert.deepEqual(writes, [[CACHE_ROOT_PREFERENCE, "D:\\ReferenceCache"]]);
  assert.deepEqual(settings.getState(), {
    cacheRoot: "D:\\ReferenceCache",
    usingDefaultRoot: false,
  });

  settings.resetCacheRoot();

  assert.deepEqual(clears, [CACHE_ROOT_PREFERENCE]);
  assert.deepEqual(settings.getState(), {
    cacheRoot: "C:\\ZoteroData\\reference-for-zotero-cache",
    usingDefaultRoot: true,
  });
});
