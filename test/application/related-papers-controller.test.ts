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

test("unsupported References structure blocks both relationship paths with actionable text", async () => {
  let resolveCalls = 0;
  let citationCalls = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => {
      throw Object.assign(new Error("unsupported bibliography structure"), {
        code: "references-entry-structure-unsupported",
      });
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
    /llm-for-zotero.*MinerU API.*generate Markdown/i,
  );
  assert.match(
    controller.getState().message ?? "",
    /unsupported bibliography structure/i,
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

test("late smaller citation responses cannot discard a larger cumulative prefix", async () => {
  const ten = deferred<readonly ReaderPaper[]>();
  const thirty = deferred<readonly ReaderPaper[]>();
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [],
    loadCitingPapers: (limit) => (limit === 10 ? ten.promise : thirty.promise),
    openURL() {},
  });
  await controller.refreshAsync();

  controller.selectTab("citations");
  controller.setCitationLimit(30);
  thirty.resolve(papers(30));
  await waitFor(() => controller.getState().citingPapers.length === 30);
  ten.resolve(papers(10));
  await tick();

  assert.equal(controller.getState().citingPapers.length, 30);
  assert.equal(controller.getState().citingPapersLoaded, 30);
  assert.equal(controller.getState().message, undefined);
});

test("a late Reference response from an obsolete generation updates neither UI nor cache", async () => {
  const firstResolution = deferred<readonly ReaderPaperResult[]>();
  const writes: string[] = [];
  let loadCount = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => ({
      ...loadedPaper,
      sourceFingerprint: `fingerprint-${++loadCount}`,
    }),
    resolveReferences: (_entries, context) =>
      context.paper.sourceFingerprint === "fingerprint-1"
        ? firstResolution.promise
        : Promise.resolve([resolvedPaper("Fresh generation", "10.1000/fresh")]),
    loadCitingPapers: async () => [],
    writeCachedResults: async (paper) => {
      writes.push(paper.sourceFingerprint);
    },
    openURL() {},
  });

  const firstRefresh = controller.refreshAsync();
  await waitFor(() => controller.getState().references.length === 1);
  const secondRefresh = controller.refreshAsync({ bypassCache: true });
  await secondRefresh;

  firstResolution.resolve([
    resolvedPaper("Late obsolete result", "10.1000/obsolete"),
  ]);
  await firstRefresh;

  assert.equal(controller.getState().references[0]?.title, "Fresh generation");
  assert.deepEqual(writes, ["fingerprint-2"]);
});

test("refresh invalidates active work before the replacement paper finishes loading", async () => {
  const firstResolution = deferred<readonly ReaderPaperResult[]>();
  const secondLoad = deferred<LoadedPaper>();
  const writes: string[] = [];
  let loadCount = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => {
      loadCount += 1;
      return loadCount === 1 ? loadedPaper : secondLoad.promise;
    },
    resolveReferences: (_entries, context) =>
      context.token.generation === 1
        ? firstResolution.promise
        : Promise.resolve([
            resolvedPaper("Replacement paper", "10.1000/replacement"),
          ]),
    loadCitingPapers: async () => [],
    writeCachedResults: async (paper) => {
      writes.push(paper.sourceFingerprint);
    },
    openURL() {},
  });

  const firstRefresh = controller.refreshAsync();
  await waitFor(() => controller.getState().references.length === 1);
  const secondRefresh = controller.refreshAsync({ bypassCache: true });
  firstResolution.resolve([
    resolvedPaper("Late obsolete result", "10.1000/obsolete"),
  ]);
  await firstRefresh;

  assert.equal(controller.getState().status, "loading");
  assert.deepEqual(controller.getState().references, []);
  assert.deepEqual(writes, []);

  secondLoad.resolve({
    ...loadedPaper,
    sourceFingerprint: "replacement-fingerprint",
  });
  await secondRefresh;
  assert.equal(controller.getState().references[0]?.title, "Replacement paper");
});

test("generation change while cache persistence is staging aborts the obsolete write", async () => {
  const firstWriteStarted = deferred<void>();
  const releaseFirstWrite = deferred<void>();
  const persisted: string[] = [];
  let loadCount = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => ({
      ...loadedPaper,
      sourceFingerprint: `fingerprint-${++loadCount}`,
    }),
    resolveReferences: async (_entries, context) => [
      resolvedPaper(
        `Generation ${context.token.generation}`,
        `10.1000/${context.token.generation}`,
      ),
    ],
    loadCitingPapers: async () => [],
    async writeCachedResults(paper, _results, context) {
      if (paper.sourceFingerprint === "fingerprint-1") {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      if (!context.signal.aborted) persisted.push(paper.sourceFingerprint);
    },
    openURL() {},
  });

  const firstRefresh = controller.refreshAsync();
  await firstWriteStarted.promise;
  const secondRefresh = controller.refreshAsync({ bypassCache: true });
  releaseFirstWrite.resolve();
  await Promise.all([firstRefresh, secondRefresh]);

  assert.deepEqual(persisted, ["fingerprint-2"]);
  assert.equal(controller.getState().status, "ready");
  assert.equal(controller.getState().references[0]?.title, "Generation 2");
});

test("a newer same-generation snapshot cancels an older staged cache write", async () => {
  const resolution = deferred<readonly ReaderPaperResult[]>();
  const firstWriteStarted = deferred<void>();
  const releaseFirstWrite = deferred<void>();
  const persistedReferenceTitles: string[] = [];
  let writeCount = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: () => resolution.promise,
    loadCitingPapers: async () => [
      {
        id: "citation:0",
        ordinal: 0,
        title: "Citing paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/citing",
      },
    ],
    async writeCachedResults(_paper, results, context) {
      writeCount += 1;
      if (writeCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      if (!context.signal.aborted) {
        persistedReferenceTitles.push(results.references[0]?.title ?? "");
      }
    },
    openURL() {},
  });

  const refresh = controller.refreshAsync();
  await waitFor(() => controller.getState().references.length === 1);
  controller.selectTab("citations");
  await firstWriteStarted.promise;
  resolution.resolve([resolvedPaper("Resolved paper", "10.1000/resolved")]);
  await refresh;
  releaseFirstWrite.resolve();
  await tick();

  assert.deepEqual(persistedReferenceTitles, ["Resolved paper"]);
  assert.equal(controller.getState().status, "ready");
});

test("current-generation persistent cache failures are visible", async () => {
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      resolvedPaper("Resolved paper", "10.1000/resolved"),
    ],
    loadCitingPapers: async () => [],
    writeCachedResults: async () => {
      throw new Error("disk full");
    },
    openURL() {},
  });

  await controller.refreshAsync();

  assert.equal(controller.getState().status, "error");
  assert.match(
    controller.getState().message ?? "",
    /cache write failed.*disk full/i,
  );
});

type ReaderPaperResult = Awaited<
  ReturnType<RelatedPapersPorts["resolveReferences"]>
>[number];

function resolvedPaper(title: string, doi: string): ReaderPaperResult {
  return {
    id: "reference:0",
    ordinal: 0,
    title,
    status: "resolved",
    primaryResultURL: `https://doi.org/${doi}`,
  };
}

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

type ReaderPaper = ReturnType<typeof papers>[number];

function papers(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `citation:${index}`,
    ordinal: index,
    title: `Citing paper ${index}`,
    status: "resolved" as const,
    primaryResultURL: `https://example.com/${index}`,
  }));
}
