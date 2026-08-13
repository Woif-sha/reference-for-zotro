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
  mineruDirectory: "E:\\ZoteroData\\llm-for-zotero-mineru\\42",
  entries: [
    {
      ordinal: 0,
      sourceLabel: "1",
      lookupText: "doi:10.1000/one",
    },
  ],
};

test("Reference entries show parsed titles before matching and after a failure", async () => {
  const paper: LoadedPaper = {
    ...loadedPaper,
    entries: [
      {
        ...loadedPaper.entries[0],
        sourceLabel: "5",
        lookupText:
          "OpenAI. GPT-4 Technical Report. Preprint at https://arxiv.org/abs/2303.08774 (2023).",
      },
    ],
  };
  const finish = deferred<readonly ReaderPaper[]>();
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => paper,
    resolveReferences: () => finish.promise,
    loadCitingPapers: async () => [],
    openURL() {},
  });

  const refresh = controller.refreshAsync();
  await waitFor(() => controller.getState().references.length === 1);
  assert.equal(
    controller.getState().references[0]?.title,
    "GPT-4 Technical Report",
  );
  assert.equal(controller.getState().references[0]?.year, "2023");
  assert.equal(controller.getState().references[0]?.sourceLabel, "5");
  assert.equal(controller.getState().references[0]?.venue, "Preprint at");
  assert.equal(
    controller.getState().mineruDirectory,
    "E:\\ZoteroData\\llm-for-zotero-mineru\\42",
  );

  finish.reject(new Error("provider failed"));
  await refresh;
  assert.equal(
    controller.getState().references[0]?.title,
    "GPT-4 Technical Report",
  );
});

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

test("resolved papers open their Primary result and unresolved papers search Google Scholar by title", async () => {
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
      {
        id: "reference:2",
        ordinal: 2,
        title: "Still matching",
        status: "matching",
      },
    ],
    loadCitingPapers: async () => [],
    openURL: (url) => opened.push(url),
  });
  await controller.refreshAsync();

  controller.openPaper("reference:1");
  controller.openPaper("reference:2");
  controller.openPaper("reference:0");

  assert.deepEqual(opened, [
    "https://scholar.google.com/scholar?q=%22Ambiguous%20paper%22",
    "https://doi.org/10.1000/one",
  ]);
});

test("paper actions copy available metadata and open an explicit Google search", async () => {
  const copied: string[] = [];
  const opened: string[] = [];
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Resolved paper",
        year: "2024",
        doi: "10.1000/one",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/one",
      },
    ],
    loadCitingPapers: async () => [],
    copyText: (text) => copied.push(text),
    openURL: (url) => opened.push(url),
  });
  await controller.refreshAsync();

  controller.performPaperAction("reference:0", "copy-title");
  controller.performPaperAction("reference:0", "copy-doi");
  controller.performPaperAction("reference:0", "google-search");
  controller.openReferenceURL("https://example.test/reference");

  assert.deepEqual(copied, ["Resolved paper", "10.1000/one"]);
  assert.deepEqual(opened, [
    "https://www.google.com/search?q=%22Resolved%20paper%22%202024",
    "https://example.test/reference",
  ]);
});

test("selecting a resolved DOI paper lazily loads and publishes its Abstract", async () => {
  const abstract = deferred<{ text: string; source: string }>();
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Resolved paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/one",
        doi: "10.1000/one",
      },
    ],
    loadCitingPapers: async () => [],
    loadAbstract: () => abstract.promise,
    openURL() {},
  });
  await controller.refreshAsync();

  controller.selectPaper("reference:0");
  await waitFor(
    () => controller.getState().references[0]?.abstractLoading === true,
  );
  abstract.resolve({
    text: "An abstract loaded only after the paper was selected.",
    source: "semantic-scholar",
  });
  await waitFor(
    () =>
      controller.getState().references[0]?.abstract ===
      "An abstract loaded only after the paper was selected.",
  );

  assert.equal(
    controller.getState().references[0]?.abstractSource,
    "semantic-scholar",
  );
  assert.equal(controller.getState().references[0]?.abstractLoading, false);
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

test("Citations publish loading and completed-empty states around the provider request", async () => {
  const citations = deferred<readonly []>();
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [],
    loadCitingPapers: () => citations.promise,
    openURL() {},
  });

  await controller.refreshAsync();
  controller.selectTab("citations");
  assert.deepEqual(controller.getState().citingPapersStatus, {
    status: "loading",
  });

  citations.resolve([]);
  await waitFor(
    () => controller.getState().citingPapersStatus.status === "ready",
  );
  assert.equal(controller.getState().citingPapersLoaded, 10);
  assert.deepEqual(controller.getState().citingPapers, []);
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

test("download selection accepts only confirmed papers, deduplicates identity, and preserves user order", async () => {
  const sharedReference = {
    id: "reference:shared",
    ordinal: 0,
    title: "Shared paper in References",
    status: "resolved" as const,
    primaryResultURL: "https://doi.org/10.1000/shared",
    doi: "10.1000/shared",
    arxivID: "2401.00001",
  };
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      sharedReference,
      {
        id: "unresolved",
        ordinal: 1,
        title: "Unresolved reference",
        status: "unresolved",
      },
    ],
    loadCitingPapers: async () => [
      {
        ...sharedReference,
        id: "citation:shared",
        title: "Shared paper in Citations",
      },
      {
        ...sharedReference,
        id: "citation:conflicting-arxiv",
        title: "Conflicting arXiv identity",
        arxivID: "2401.99999",
      },
      {
        id: "citation:second",
        ordinal: 1,
        title: "Second citing paper",
        status: "resolved",
        primaryResultURL: "https://example.test/second",
      },
    ],
    openURL() {},
  });
  await controller.refreshAsync();

  controller.setPaperDownloadSelected("references", "unresolved", true);
  controller.setPaperDownloadSelected("references", "reference:shared", true);
  controller.selectTab("citations");
  await waitFor(() => controller.getState().citingPapers.length === 3);
  controller.setTabDownloadSelected("citations", true);

  assert.deepEqual(controller.getState().downloadSelection, [
    { originTab: "references", paperID: "reference:shared" },
    { originTab: "citations", paperID: "citation:conflicting-arxiv" },
    { originTab: "citations", paperID: "citation:second" },
  ]);

  controller.setPaperDownloadSelected("citations", "citation:shared", false);
  controller.setPaperDownloadSelected("references", "reference:shared", true);
  assert.deepEqual(controller.getState().downloadSelection.at(-1), {
    originTab: "references",
    paperID: "reference:shared",
  });
});

test("citation selection follows the visible 10/30/50 window without discarding hidden choices", async () => {
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [],
    loadCitingPapers: async () => papers(50),
    openURL() {},
  });
  await controller.refreshAsync();
  controller.selectTab("citations");
  await waitFor(() => controller.getState().citingPapers.length === 50);

  controller.setTabDownloadSelected("citations", true);
  assert.equal(controller.getState().downloadSelection.length, 10);
  controller.setCitationLimit(30);
  controller.setTabDownloadSelected("citations", true);
  assert.deepEqual(
    controller.getState().downloadSelection.map(({ paperID }) => paperID),
    papers(30).map(({ id }) => id),
  );

  controller.setCitationLimit(10);
  controller.setTabDownloadSelected("citations", false);
  assert.deepEqual(
    controller.getState().downloadSelection.map(({ paperID }) => paperID),
    papers(30)
      .slice(10)
      .map(({ id }) => id),
  );
});

test("download command snapshots selection and consumes one batch progress stream", async () => {
  const finish = deferred<void>();
  const started: string[] = [];
  const revealed: string[] = [];
  const papersToResolve = [
    {
      id: "reference:first",
      ordinal: 0,
      title: "First selected paper",
      status: "resolved" as const,
      primaryResultURL: "https://example.test/first",
      doi: "10.1000/first",
    },
    {
      id: "reference:second",
      ordinal: 1,
      title: "Second selected paper",
      status: "resolved" as const,
      primaryResultURL: "https://example.test/second",
    },
  ];
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => papersToResolve,
    loadCitingPapers: async () => [
      {
        ...papersToResolve[0]!,
        id: "citation:first",
      },
    ],
    async downloadPapers({ papers, onProgress }) {
      started.push(...papers.map(({ id }) => id));
      onProgress({
        paperID: papers[0]!.id,
        result: { status: "downloaded", savedPath: "E:\\paper\\First.pdf" },
      });
      await finish.promise;
      const second = {
        paperID: papers[1]!.id,
        result: {
          status: "failed" as const,
          error: "publisher rejected https://publisher.test/file",
        },
      };
      onProgress(second);
      return [
        {
          paperID: papers[0]!.id,
          result: {
            status: "downloaded" as const,
            savedPath: "E:\\paper\\First.pdf",
          },
        },
        second,
      ];
    },
    revealDownloadedFile: (path) => revealed.push(path),
    openURL() {},
  });
  await controller.refreshAsync();
  controller.setPaperDownloadSelected("references", "reference:first", true);
  controller.setPaperDownloadSelected("references", "reference:second", true);

  const run = controller.downloadSelected();
  assert.deepEqual(started, ["reference:first", "reference:second"]);
  assert.equal(controller.getState().downloadInProgress, true);
  assert.deepEqual(
    controller.getState().paperDownloads.map(({ status }) => status),
    ["downloaded", "downloading"],
  );

  controller.setPaperDownloadSelected("references", "reference:second", false);
  finish.resolve();
  await run;

  assert.equal(controller.getState().downloadInProgress, false);
  assert.deepEqual(controller.getState().paperDownloads, [
    {
      originTab: "references",
      paperID: "reference:first",
      status: "downloaded",
      savedPath: "E:\\paper\\First.pdf",
    },
    {
      originTab: "references",
      paperID: "reference:second",
      status: "failed",
      error: "publisher rejected https://publisher.test/file",
    },
  ]);

  controller.openDownloadedFolder("reference:first");
  controller.openDownloadedFolder("reference:second");
  controller.selectTab("citations");
  await waitFor(() => controller.getState().citingPapers.length === 1);
  controller.openDownloadedFolder("citation:first");
  assert.deepEqual(revealed, ["E:\\paper\\First.pdf", "E:\\paper\\First.pdf"]);
});

test("a sidecar download failure leaves relationships, landing pages, details, and translation usable", async () => {
  const opened: string[] = [];
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      {
        id: "10.1000/one",
        ordinal: 0,
        title: "Confirmed paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/one",
      },
    ],
    loadCitingPapers: async () => [
      {
        id: "10.1000/citing",
        ordinal: 0,
        title: "Citing paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/citing",
        doi: "10.1000/citing",
      },
    ],
    async downloadPapers() {
      throw new Error("ScanSci sidecar probe failed");
    },
    translateSelection: async (text) => `translated:${text}`,
    openURL: (url) => opened.push(url),
  });
  await controller.refreshAsync();
  controller.selectTab("citations");
  await waitFor(() => controller.getState().citingPapers.length === 1);
  controller.setPaperDownloadSelected("references", "10.1000/one", true);

  await controller.downloadSelected();

  assert.equal(controller.getState().status, "ready");
  assert.equal(controller.getState().references[0]?.title, "Confirmed paper");
  assert.equal(controller.getState().citingPapers[0]?.title, "Citing paper");
  assert.deepEqual(controller.getState().paperDownloads, [
    {
      originTab: "references",
      paperID: "10.1000/one",
      status: "failed",
      error: "ScanSci sidecar probe failed",
    },
  ]);
  controller.openPaper("10.1000/one");
  controller.openPaper("10.1000/citing");
  controller.selectPaper("10.1000/one");
  assert.deepEqual(opened, [
    "https://doi.org/10.1000/one",
    "https://doi.org/10.1000/citing",
  ]);
  assert.equal(controller.getState().selectedPaperID, "10.1000/one");
  assert.equal(
    await controller.translateSelection("Academic text"),
    "translated:Academic text",
  );
});

test("paper refresh cancels the active sidecar batch", async () => {
  const replacementLoad = deferred<LoadedPaper>();
  const started: string[] = [];
  let downloadSignal: AbortSignal | undefined;
  let loadCount = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => {
      loadCount += 1;
      return loadCount === 1 ? loadedPaper : replacementLoad.promise;
    },
    resolveReferences: async () => [
      {
        id: "reference:first",
        ordinal: 0,
        title: "First selected paper",
        status: "resolved",
        primaryResultURL: "https://example.test/first",
      },
      {
        id: "reference:second",
        ordinal: 1,
        title: "Second selected paper",
        status: "resolved",
        primaryResultURL: "https://example.test/second",
      },
    ],
    loadCitingPapers: async () => [],
    downloadPapers({ papers, signal }) {
      started.push(...papers.map(({ id }) => id));
      downloadSignal = signal;
      return new Promise((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    },
    openURL() {},
  });
  await controller.refreshAsync();
  controller.setPaperDownloadSelected("references", "reference:first", true);
  controller.setPaperDownloadSelected("references", "reference:second", true);

  const run = controller.downloadSelected();
  controller.refresh();
  assert.equal(controller.getState().status, "loading");
  assert.equal(controller.getState().downloadInProgress, true);
  assert.deepEqual(controller.getState().downloadSelection, []);
  assert.deepEqual(controller.getState().paperDownloads, []);

  await run;
  assert.equal(downloadSignal?.aborted, true);
  assert.deepEqual(started, ["reference:first", "reference:second"]);
  assert.equal(controller.getState().downloadInProgress, false);
  assert.deepEqual(controller.getState().paperDownloads, []);

  replacementLoad.resolve({
    ...loadedPaper,
    sourceFingerprint: "replacement-fingerprint",
  });
  await waitFor(() => controller.getState().status === "ready");
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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
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
