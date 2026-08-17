import assert from "node:assert/strict";
import test from "node:test";
import {
  RelatedPapersController,
  type LoadedPaper,
  type RelatedPapersPorts,
} from "../../src/application/related-papers-controller";
import {
  RecommendationCacheRepository,
  type RecommendationCacheStorage,
} from "../../src/cache/recommendation-cache-repository";
import { RelatedPaperRecommendationService } from "../../src/recommendation/related-paper-recommendation";

const loadedPaper: LoadedPaper = {
  identity: {
    libraryID: 1,
    attachmentID: 42,
    attachmentKey: "ATTACH01",
    parentItemKey: "PARENT01",
  },
  sourceFingerprint: "fingerprint",
  fullMarkdown: "# Current paper\n\nComplete MinerU Markdown.",
  fullMdSha256: "full-md-sha256",
  mineruDirectory: "E:\\ZoteroData\\llm-for-zotero-mineru\\42",
  entries: [
    {
      ordinal: 0,
      sourceLabel: "1",
      lookupText: "doi:10.1000/one",
    },
  ],
};

test("opening a Current paper restores its recommendation cache without calling the model", async () => {
  let cacheReads = 0;
  let modelCalls = 0;
  const cachedItem = {
    candidateKey: "doi:10.1000/reference",
    paperID: "reference:0",
    title: "Reference",
    sources: ["reference" as const],
    reason: "直接扩展当前论文的方法。",
  };
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      resolvedPaper("Reference", "10.1000/reference"),
    ],
    loadCitingPapers: async () => [],
    async readCachedRecommendation(request) {
      cacheReads += 1;
      assert.equal(request.currentPaper.attachmentKey, "ATTACH01");
      return {
        status: "completed",
        priority: [cachedItem],
        optional: [],
      };
    },
    async recommendPapers() {
      modelCalls += 1;
      throw new Error("model must not be called");
    },
    openURL() {},
  });

  await controller.refreshAsync();

  assert.equal(cacheReads, 1);
  assert.equal(modelCalls, 0);
  assert.deepEqual(controller.getState().recommendation, {
    status: "completed",
    priority: [cachedItem],
    optional: [],
    restoredFromCache: true,
  });
});

test("clicking analyze checks the cache before deciding that no Abstract is available", async () => {
  const order: string[] = [];
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      resolvedPaper("Reference", "10.1000/reference"),
    ],
    loadCitingPapers: async () => [],
    async readCachedRecommendation() {
      order.push("cache");
      return undefined;
    },
    async recommendPapers() {
      order.push("model-boundary");
      return { status: "no-candidates" };
    },
    openURL() {},
  });
  await controller.refreshAsync();
  order.length = 0;

  await controller.generateRecommendations();

  assert.deepEqual(order, ["cache", "model-boundary"]);
  assert.deepEqual(controller.getState().recommendation, {
    status: "no-candidates",
  });
});

test("a complete recommendation survives a Controller restart without a second model call", async () => {
  const values = new Map<string, string>();
  const storage: RecommendationCacheStorage = {
    async read(directory) {
      return values.get(`${directory}/recommendation.json`);
    },
    async write(directory, value) {
      values.set(`${directory}/recommendation.json`, value);
    },
  };
  let modelCalls = 0;
  const modelIdentity = {
    authMode: "codex_auth" as const,
    providerId: "provider-codex",
    modelId: "model-codex",
    model: "gpt-5.4",
    apiBase: "https://chatgpt.com/backend-api/codex/responses",
    effort: "medium",
  };
  const service = new RelatedPaperRecommendationService(
    {
      identity() {
        return modelIdentity;
      },
      async generate() {
        modelCalls += 1;
        return {
          identity: modelIdentity,
          text: JSON.stringify({
            schemaVersion: 1,
            priority: [{ id: "paper-1", reason: "直接扩展当前论文的方法。" }],
            optional: [],
          }),
        };
      },
    },
    { cache: new RecommendationCacheRepository(storage) },
  );
  const createController = (abstract?: string) =>
    new RelatedPapersController(42, {
      loadPaper: async () => loadedPaper,
      resolveReferences: async () => [
        {
          ...resolvedPaper("Reference", "10.1000/reference"),
          doi: "10.1000/reference",
          ...(abstract ? { abstract } : {}),
        },
      ],
      loadCitingPapers: async () => [],
      readCachedRecommendation: (request) => service.readCached(request),
      recommendPapers: (request) => service.recommend(request),
      openURL() {},
    });

  const first = createController("Reference abstract");
  await first.refreshAsync();
  await first.generateRecommendations();
  assert.equal(
    first.getState().recommendation.status,
    "completed",
    JSON.stringify(first.getState().recommendation),
  );
  assert.equal(values.size, 1);
  first.dispose();
  const second = createController();
  await second.refreshAsync();

  assert.equal(modelCalls, 1);
  const restored = second.getState().recommendation;
  assert.equal(restored.status, "completed");
  assert.equal(
    restored.status === "completed" && restored.restoredFromCache,
    true,
  );
});

test("a newly loaded Abstract invalidates a restored recommendation without auto-calling the model", async () => {
  let cacheReads = 0;
  let modelCalls = 0;
  const cached = {
    status: "completed" as const,
    priority: [
      {
        candidateKey: "doi:10.1000/reference",
        paperID: "reference:0",
        title: "Reference",
        sources: ["reference" as const],
        reason: "直接扩展当前论文的方法。",
      },
    ],
    optional: [],
  };
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      {
        ...resolvedPaper("Reference", "10.1000/reference"),
        doi: "10.1000/reference",
      },
    ],
    loadCitingPapers: async () => [],
    async loadAbstract() {
      return { text: "New Abstract", source: "crossref" };
    },
    async readCachedRecommendation(request) {
      cacheReads += 1;
      return request.references[0]?.abstract ? undefined : cached;
    },
    async recommendPapers() {
      modelCalls += 1;
      throw new Error("must not auto-call model");
    },
    openURL() {},
  });
  await controller.refreshAsync();
  assert.equal(controller.getState().recommendation.status, "completed");

  controller.selectPaper("reference:0");
  await waitFor(() => cacheReads === 2);

  assert.deepEqual(controller.getState().recommendation, {
    status: "not-analyzed",
  });
  assert.equal(modelCalls, 0);
});

test("a changed visible candidate set invalidates a restored recommendation", async () => {
  let cacheReads = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      resolvedPaper("Reference", "10.1000/reference"),
    ],
    loadCitingPapers: async () => [
      {
        id: "citation:0",
        ordinal: 0,
        title: "New citing paper",
        doi: "10.1000/citing",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/citing",
      },
    ],
    async readCachedRecommendation(request) {
      cacheReads += 1;
      return request.citingPapers.length
        ? undefined
        : {
            status: "completed",
            priority: [],
            optional: [],
          };
    },
    async recommendPapers() {
      throw new Error("must not auto-call model");
    },
    openURL() {},
  });
  await controller.refreshAsync();
  assert.equal(controller.getState().recommendation.status, "completed");

  controller.selectTab("citations");
  await waitFor(() => cacheReads === 2);

  assert.deepEqual(controller.getState().recommendation, {
    status: "not-analyzed",
  });
});

test("a Reference candidate change aborts analysis and rejects its late result", async () => {
  const resolution = deferred<readonly ReaderPaperResult[]>();
  const recommendation = deferred<{
    status: "completed";
    priority: readonly [];
    optional: readonly [];
  }>();
  let publishResolved: ((paper: ReaderPaperResult) => void) | undefined;
  let recommendationSignal: AbortSignal | undefined;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences(_entries, _context, onResolved) {
      publishResolved = onResolved;
      return resolution.promise;
    },
    loadCitingPapers: async () => [],
    recommendPapers(request) {
      recommendationSignal = request.signal;
      return recommendation.promise;
    },
    openURL() {},
  });
  const refresh = controller.refreshAsync();
  await waitFor(() => controller.getState().references.length === 1);
  const run = controller.generateRecommendations();
  const resolved = resolvedPaper("Resolved", "10.1000/resolved");

  publishResolved?.(resolved);
  resolution.resolve([resolved]);
  await refresh;

  assert.equal(recommendationSignal?.aborted, true);
  recommendation.resolve({ status: "completed", priority: [], optional: [] });
  await run;
  assert.deepEqual(controller.getState().recommendation, {
    status: "not-analyzed",
  });
});

test("a model identity change clears a restored result and performs a fresh lookup", async () => {
  let notifyIdentityChange: (() => void) | undefined;
  let cacheReads = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [],
    loadCitingPapers: async () => [],
    subscribeRecommendationIdentityChange(listener) {
      notifyIdentityChange = listener;
      return () => undefined;
    },
    async readCachedRecommendation() {
      cacheReads += 1;
      return cacheReads === 1
        ? { status: "completed", priority: [], optional: [] }
        : undefined;
    },
    async recommendPapers() {
      throw new Error("must not auto-call model");
    },
    openURL() {},
  });
  await controller.refreshAsync();
  assert.equal(controller.getState().recommendation.status, "completed");

  notifyIdentityChange?.();
  await waitFor(() => cacheReads === 2);

  assert.deepEqual(controller.getState().recommendation, {
    status: "not-analyzed",
  });
});

test("a cache read error is explicit and never falls through to the model", async () => {
  let cacheReads = 0;
  let modelCalls = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [],
    loadCitingPapers: async () => [],
    async readCachedRecommendation() {
      cacheReads += 1;
      throw new Error("Recommendation cache schema is invalid");
    },
    async recommendPapers() {
      modelCalls += 1;
      return { status: "no-candidates" };
    },
    openURL() {},
  });

  await controller.refreshAsync();
  assert.deepEqual(controller.getState().recommendation, {
    status: "failed",
    message: "Recommendation cache schema is invalid",
  });
  await controller.generateRecommendations();

  assert.equal(cacheReads, 2);
  assert.equal(modelCalls, 0);
  assert.equal(controller.getState().recommendation.status, "failed");
});

test("recommendation snapshots the retained Current paper and every Controller candidate once", async () => {
  const recommendation = deferred<{
    status: "completed";
    priority: readonly [];
    optional: readonly [];
  }>();
  const requests: unknown[] = [];
  let paperLoads = 0;
  let citingLoads = 0;
  let abstractLoads = 0;
  const references = [
    {
      ...resolvedPaper("Reference", "10.1000/reference"),
      abstract: "Reference abstract",
    },
  ];
  const citingPapers = papers(12).map((entry) => ({
    ...entry,
    abstract: `${entry.title} abstract`,
  }));
  const controller = new RelatedPapersController(42, {
    async loadPaper() {
      paperLoads += 1;
      return loadedPaper;
    },
    async resolveReferences() {
      throw new Error("cached results should be used");
    },
    async loadCitingPapers() {
      citingLoads += 1;
      return [];
    },
    async loadAbstract() {
      abstractLoads += 1;
      return { text: "unexpected", source: "unexpected" };
    },
    async readCachedResults() {
      return { references, citingPapers, citingPapersLoaded: 10 };
    },
    recommendPapers(request) {
      requests.push(request);
      return recommendation.promise;
    },
    openURL() {},
  });
  await controller.refreshAsync();

  const run = controller.generateRecommendations();
  assert.equal(controller.getState().recommendation.status, "analyzing");
  controller.selectTab("citations");
  controller.selectTab("ai-recommendation");
  void controller.generateRecommendations();
  assert.equal(requests.length, 1);
  const request = requests[0] as {
    currentPaper: unknown;
    references: readonly unknown[];
    citingPapers: readonly unknown[];
    signal: AbortSignal;
  };
  assert.deepEqual(request.currentPaper, {
    ...loadedPaper.identity,
    fullMarkdown: loadedPaper.fullMarkdown,
    fullMdSha256: loadedPaper.fullMdSha256,
    sourceFingerprint: loadedPaper.sourceFingerprint,
  });
  assert.equal(request.references.length, 1);
  assert.equal(request.citingPapers.length, 12);
  assert.equal(request.signal.aborted, false);
  assert.equal(paperLoads, 1);
  assert.equal(citingLoads, 0);
  assert.equal(abstractLoads, 0);

  recommendation.resolve({ status: "completed", priority: [], optional: [] });
  await run;
  assert.deepEqual(controller.getState().recommendation, {
    status: "completed",
    priority: [],
    optional: [],
    restoredFromCache: false,
  });
});

test("recommendation exposes empty and isolated failure states and permits manual retry", async () => {
  let calls = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper: async () => loadedPaper,
    resolveReferences: async () => [
      resolvedPaper("Reference", "10.1000/reference"),
    ],
    loadCitingPapers: async () => [],
    async recommendPapers() {
      calls += 1;
      if (calls === 1) return { status: "no-candidates" };
      throw new Error("recommendation provider failed");
    },
    openURL() {},
  });
  await controller.refreshAsync();
  const references = controller.getState().references;

  await controller.generateRecommendations();
  assert.deepEqual(controller.getState().recommendation, {
    status: "no-candidates",
  });
  await controller.generateRecommendations();
  assert.deepEqual(controller.getState().recommendation, {
    status: "failed",
    message: "recommendation provider failed",
  });
  assert.equal(calls, 2);
  assert.equal(controller.getState().references, references);
  assert.equal(controller.getState().status, "ready");
});

test("refresh and dispose abort recommendation work and reject late commits", async () => {
  const firstRecommendation = deferred<{
    status: "completed";
    priority: readonly [];
    optional: readonly [];
  }>();
  const secondRecommendation = deferred<{
    status: "completed";
    priority: readonly [];
    optional: readonly [];
  }>();
  const replacementLoad = deferred<LoadedPaper>();
  const signals: AbortSignal[] = [];
  let paperLoads = 0;
  let recommendationCalls = 0;
  const controller = new RelatedPapersController(42, {
    loadPaper() {
      paperLoads += 1;
      return paperLoads === 1
        ? Promise.resolve(loadedPaper)
        : replacementLoad.promise;
    },
    resolveReferences: async () => [],
    loadCitingPapers: async () => [],
    recommendPapers(request) {
      signals.push(request.signal!);
      recommendationCalls += 1;
      return recommendationCalls === 1
        ? firstRecommendation.promise
        : secondRecommendation.promise;
    },
    openURL() {},
  });
  await controller.refreshAsync();

  const firstRun = controller.generateRecommendations();
  controller.refresh();
  assert.equal(signals[0]?.aborted, true);
  firstRecommendation.resolve({
    status: "completed",
    priority: [],
    optional: [],
  });
  await firstRun;
  assert.deepEqual(controller.getState().recommendation, {
    status: "not-analyzed",
  });

  replacementLoad.resolve({ ...loadedPaper, sourceFingerprint: "replacement" });
  await waitFor(() => controller.getState().status === "ready");
  const secondRun = controller.generateRecommendations();
  controller.dispose();
  assert.equal(signals[1]?.aborted, true);
  secondRecommendation.resolve({
    status: "completed",
    priority: [],
    optional: [],
  });
  await secondRun;
  assert.equal(recommendationCalls, 2);
});

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
    controller.getState().references[0]?.referenceText,
    paper.entries[0]?.lookupText,
  );
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
