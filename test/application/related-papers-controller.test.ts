import assert from "node:assert/strict";
import test from "node:test";
import {
  RelatedPapersController,
  type LoadedPaper,
  type RelatedPapersPorts,
} from "../../src/application/related-papers-controller";

const loadedPaper: LoadedPaper = {
  identity: {
    libraryID: 1,
    attachmentID: 42,
    attachmentKey: "ATTACH01",
    parentItemKey: "PARENT01",
  },
  sourceFingerprint: "fingerprint",
  entries: [
    {
      ordinal: 0,
      sourceLabel: "1",
      rawMarkdown: "[1] doi:10.1000/one",
      lookupText: "doi:10.1000/one",
      charStart: 0,
      charEnd: 20,
    },
  ],
};

test("Reference entries render before online resolution completes", async () => {
  const resolution =
    deferred<
      ReturnType<RelatedPapersPorts["resolveReferences"]> extends Promise<
        infer T
      >
        ? T
        : never
    >();
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: () => resolution.promise,
    loadCitingPapers: async () => [],
    openURL() {},
  });

  const refresh = controller.refreshAsync();
  await waitFor(() => controller.getState().references.length === 1);

  assert.equal(controller.getState().status, "ready");
  assert.equal(controller.getState().references[0]?.status, "matching");

  resolution.resolve([
    {
      id: "reference:0",
      ordinal: 0,
      title: "Resolved paper",
      status: "resolved",
      primaryResultURL: "https://doi.org/10.1000/one",
    },
  ]);
  await refresh;
  assert.equal(controller.getState().references[0]?.status, "resolved");
});

test("each resolved Reference entry publishes without waiting for the full bibliography", async () => {
  const finish = deferred<readonly []>();
  const paper = {
    ...loadedPaper,
    entries: [
      loadedPaper.entries[0],
      {
        ...loadedPaper.entries[0],
        ordinal: 1,
        sourceLabel: "2",
        lookupText: "Second paper",
      },
    ],
  };
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => paper,
    async resolveReferences(_entries, _context, onResolved) {
      onResolved({
        id: "reference:0",
        ordinal: 0,
        title: "First resolved paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/one",
      });
      await finish.promise;
      return [];
    },
    loadCitingPapers: async () => [],
    openURL() {},
  });

  const refresh = controller.refreshAsync();
  await waitFor(
    () => controller.getState().references[0]?.status === "resolved",
  );
  assert.equal(controller.getState().references[1]?.status, "matching");

  finish.resolve([]);
  await refresh;
});

test("missing MinerU Markdown blocks both relationship paths with actionable text", async () => {
  let resolveCalls = 0;
  let citationCalls = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => {
      throw Object.assign(new Error("missing"), { code: "md-not-generated" });
    },
    resolveReferences: async () => {
      resolveCalls += 1;
      return [];
    },
    loadCitingPapers: async () => {
      citationCalls += 1;
      return [];
    },
    openURL() {},
  });

  await controller.refreshAsync();
  controller.selectTab("citations");
  await tick();

  assert.equal(controller.getState().status, "no-md");
  assert.match(
    controller.getState().message ?? "",
    /llm-for-zotero.*MinerU API/i,
  );
  assert.equal(resolveCalls, 0);
  assert.equal(citationCalls, 0);
});

test("only a resolved Primary result can open the browser", async () => {
  const opened: string[] = [];
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Resolved paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/one",
      },
      {
        id: "reference:1",
        ordinal: 1,
        title: "Ambiguous paper",
        status: "ambiguous",
      },
    ],
    loadCitingPapers: async () => [],
    openURL: (url) => opened.push(url),
  });
  await controller.refreshAsync();

  controller.openPrimaryResult("reference:1");
  controller.openPrimaryResult("reference:0");

  assert.deepEqual(opened, ["https://doi.org/10.1000/one"]);
});

test("unchanged MinerU identity reuses persisted results while manual refresh bypasses them", async () => {
  let resolveCalls = 0;
  let cacheReads = 0;
  const cached = {
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Cached paper",
        status: "resolved" as const,
        primaryResultURL: "https://doi.org/10.1000/cached",
      },
    ],
    citingPapers: [],
    citingPapersLoaded: 0,
  };
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    readCachedResults: async () => {
      cacheReads += 1;
      return cached;
    },
    writeCachedResults: async () => {},
    resolveReferences: async () => {
      resolveCalls += 1;
      return [
        {
          ...cached.references[0],
          title: "Fresh paper",
        },
      ];
    },
    loadCitingPapers: async () => [],
    openURL() {},
  });

  await controller.refreshAsync();
  assert.equal(controller.getState().references[0]?.title, "Cached paper");
  assert.equal(resolveCalls, 0);

  controller.refresh();
  await waitFor(
    () => controller.getState().references[0]?.title === "Fresh paper",
  );
  assert.equal(cacheReads, 1);
  assert.equal(resolveCalls, 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error("condition not reached");
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
