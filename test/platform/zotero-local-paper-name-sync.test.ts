import assert from "node:assert/strict";
import test from "node:test";
import type { LocalPaperNameSyncResult } from "../../src/application/local-paper-name-sync";
import { ZoteroLocalPaperNameSyncObserver } from "../../src/platform/zotero-local-paper-name-sync";

test("item add and modify notifications synchronize deduplicated storage paths", async () => {
  const resolutions: number[][] = [];
  const synchronized: string[] = [];
  const reports: Array<readonly [string, LocalPaperNameSyncResult | Error]> =
    [];
  const observer = new ZoteroLocalPaperNameSyncObserver(
    async (ids) => {
      resolutions.push([...ids]);
      return [
        "E:\\ZoteroData\\storage\\ABCD2345\\Paper.pdf",
        "E:\\ZoteroData\\storage\\ABCD2345\\Paper.pdf",
      ];
    },
    async (path) => {
      synchronized.push(path);
      return { status: "unchanged", path: "E:\\paper\\Paper.pdf" };
    },
    (path, result) => reports.push([path, result]),
  );

  await observer.notify("add", "item", [12, "13"]);
  await observer.notify("modify", "item", [12, "13"]);

  assert.deepEqual(resolutions, [
    [12, 13],
    [12, 13],
  ]);
  assert.deepEqual(synchronized, [
    "E:\\ZoteroData\\storage\\ABCD2345\\Paper.pdf",
    "E:\\ZoteroData\\storage\\ABCD2345\\Paper.pdf",
  ]);
  assert.equal(reports.length, 2);
});

test("attachment refresh after Zotero renaming triggers local synchronization", async () => {
  let synchronized = 0;
  const observer = new ZoteroLocalPaperNameSyncObserver(
    async () => ["E:\\ZoteroData\\storage\\ABCD2345\\Renamed.pdf"],
    async (path) => {
      synchronized += 1;
      return { status: "unchanged", path };
    },
    () => {},
  );

  await observer.notify("refresh", "item", [12]);

  assert.equal(synchronized, 1);
});

test("ignores unrelated notifications and stops accepting work after shutdown", async () => {
  let resolutions = 0;
  const observer = new ZoteroLocalPaperNameSyncObserver(
    async () => {
      resolutions += 1;
      return [];
    },
    async () => ({ status: "not-found", storagePath: "unused" }),
    () => {},
  );

  await observer.notify("delete", "item", [1]);
  await observer.notify("modify", "collection", [1]);
  observer.shutdown();
  await observer.notify("modify", "item", [1]);

  assert.equal(resolutions, 0);
});

test("reports one failed attachment without rejecting the notification", async () => {
  const failure = new Error("hash failed");
  const reports: Array<LocalPaperNameSyncResult | Error> = [];
  const observer = new ZoteroLocalPaperNameSyncObserver(
    async () => ["first.pdf", "second.pdf"],
    async (path) => {
      if (path === "first.pdf") throw failure;
      return { status: "unchanged", path };
    },
    (_path, result) => reports.push(result),
  );

  await observer.notify("modify", "item", [1]);

  assert.equal(reports[0], failure);
  assert.deepEqual(reports[1], { status: "unchanged", path: "second.pdf" });
});
