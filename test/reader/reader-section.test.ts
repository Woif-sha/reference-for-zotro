import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { zoteroReaderInteractionDocuments } from "../../src/composition-root";
import {
  mountReaderSection,
  type ReaderPaper,
  type ReaderSectionController,
  type ReaderSectionState,
} from "../../src/reader/mountReaderSection";

function readyState(): ReaderSectionState {
  return {
    activeTab: "references",
    status: "ready",
    mineruDirectory: "E:\\ZoteroData\\llm-for-zotero-mineru\\214",
    references: [
      {
        id: "ref-1",
        ordinal: 0,
        sourceLabel: "1",
        title: "First reference",
        authors: "Alpha",
        venue: "Journal of First Results",
        year: "2024",
        doi: "10.1000/first",
        status: "resolved",
        primaryResultURL: "https://example.test/first",
        matchedBy: "doi",
      },
      {
        id: "ref-2",
        ordinal: 1,
        sourceLabel: "5",
        title: "Second reference",
        referenceText:
          "B. Author. Second reference. Available: https://example.test/second",
        authors: "Beta",
        venue: "Proceedings of Second Tests",
        year: "2023",
        status: "unresolved",
      },
    ],
    citingPapers: [],
    citingPaperLimit: 10,
    citingPapersLoaded: 10,
    citingPapersStatus: { status: "ready" },
    recommendation: { status: "not-analyzed" },
    downloadSelection: [],
    paperDownloads: [],
    downloadInProgress: false,
    downloadAvailable: true,
  };
}

test("AI recommendation is the third tab and renders every analysis state without scores", async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let state: ReaderSectionState = readyState();
  let listener: ((next: ReaderSectionState) => void) | undefined;
  mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab(tab) {
        state = { ...state, activeTab: tab };
        listener?.(state);
      },
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  assert.deepEqual(
    [...dom.window.document.querySelectorAll("[data-tab]")].map(
      (tab) => (tab as HTMLElement).dataset.tab,
    ),
    ["references", "citations", "ai-recommendation"],
  );
  (
    dom.window.document.querySelector(
      '[data-tab="ai-recommendation"]',
    ) as HTMLElement | null
  )?.click();
  assert.match(
    dom.window.document.body.textContent ?? "",
    /正在检查缓存和分析条件/u,
  );
  assert.equal(
    dom.window.document.querySelector("[data-generate-recommendations]"),
    null,
  );

  state = {
    ...state,
    recommendation: {
      status: "analyzing",
      totalCandidates: 2,
      priority: [
        {
          candidateKey: "doi:10.1000/streaming",
          paperID: "reference:0",
          title: "Streaming paper",
          sources: ["reference"],
          reason: "正在生成的推荐理由。",
        },
      ],
      optional: [],
    },
  };
  listener?.(state);
  assert.match(dom.window.document.body.textContent ?? "", /正在分析/u);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /已生成\s*1\s*\/\s*2\s*篇/u,
  );
  assert.match(dom.window.document.body.textContent ?? "", /Streaming paper/u);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /正在生成的推荐理由/u,
  );
  assert.equal(
    dom.window.document.querySelector("[data-generate-recommendations]"),
    null,
  );

  state = {
    ...state,
    recommendation: {
      status: "completed",
      restoredFromCache: false,
      priority: [
        {
          candidateKey: "doi:10.1000/priority",
          paperID: "citation:0",
          title: "Priority paper",
          sources: ["reference", "citation"],
          reason: "直接扩展当前论文的方法并在新数据上验证。",
        },
      ],
      optional: [
        {
          candidateKey: "doi:10.1000/optional",
          paperID: "reference:0",
          title: "Optional paper",
          sources: ["reference"],
          reason: "提供当前论文采用的理论基础。",
        },
      ],
    },
  };
  listener?.(state);
  const completedText = dom.window.document.body.textContent ?? "";
  assert.match(completedText, /当前论文的 AI 阅读建议/u);
  assert.match(completedText, /优先看/u);
  assert.match(completedText, /可选看/u);
  assert.match(completedText, /Reference/u);
  assert.match(completedText, /Citation/u);
  assert.match(completedText, /直接扩展当前论文的方法/u);
  assert.doesNotMatch(completedText, /score|相关度\s*[:：]?\s*\d/iu);
  assert.doesNotMatch(completedText, /缓存恢复/u);
  assert.equal(
    dom.window.document.querySelector("[data-generate-recommendations]"),
    null,
  );

  if (state.recommendation.status !== "completed") {
    throw new Error("expected completed recommendation state");
  }
  state = {
    ...state,
    recommendation: { ...state.recommendation, restoredFromCache: true },
  };
  listener?.(state);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /缓存恢复.*未调用 AI/u,
  );

  state = {
    ...state,
    recommendation: { status: "failed", message: "模型输出无效" },
  };
  listener?.(state);
  assert.match(dom.window.document.body.textContent ?? "", /分析失败/u);
  assert.match(dom.window.document.body.textContent ?? "", /模型输出无效/u);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /再次点击 AI 推荐标签可重试/u,
  );
  assert.equal(
    dom.window.document.querySelector("[data-generate-recommendations]"),
    null,
  );

  state = { ...state, recommendation: { status: "no-candidates" } };
  listener?.(state);
  assert.match(dom.window.document.body.textContent ?? "", /暂无可分析论文/u);
  assert.match(
    dom.window.document.body.textContent ?? "",
    /加载 Abstract 后再次点击 AI 推荐标签/u,
  );
});

test("Citations distinguish an active lookup from a completed empty result", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let state: ReaderSectionState = {
    ...readyState(),
    activeTab: "citations",
    citingPapers: [],
    citingPapersLoaded: 0,
    citingPapersStatus: { status: "loading" },
  };
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  assert.equal(
    dom.window.document.querySelector('[data-tab="citations"] span')
      ?.textContent,
    "…",
  );
  assert.match(
    dom.window.document.querySelector(".rfz-content")?.textContent ?? "",
    /正在查找引用论文/u,
  );

  state = {
    ...state,
    citingPapersLoaded: 10,
    citingPapersStatus: { status: "ready" },
  };
  listener?.(state);

  assert.equal(
    dom.window.document.querySelector('[data-tab="citations"] span')
      ?.textContent,
    "0",
  );
  assert.match(
    dom.window.document.querySelector(".rfz-content")?.textContent ?? "",
    /未找到引用文献/u,
  );
  assert.match(
    dom.window.document.querySelector(".rfz-content")?.textContent ?? "",
    /OpenCitations 暂未返回/u,
  );
  mounted.destroy();
});

function downloadControllerStubs(): Pick<
  ReaderSectionController,
  | "setPaperDownloadSelected"
  | "setTabDownloadSelected"
  | "downloadSelected"
  | "openDownloadedFolder"
  | "openReferenceURL"
> {
  return {
    setPaperDownloadSelected() {},
    setTabDownloadSelected() {},
    async downloadSelected() {},
    openDownloadedFolder() {},
    openReferenceURL() {},
  };
}

test("Reader section renders supported text for LaTeX-formatted Abstracts", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const state: ReaderSectionState = {
    ...readyState(),
    selectedPaperID: "ref-1",
    references: readyState().references.map((paper) =>
      paper.id === "ref-1"
        ? {
            ...paper,
            abstract:
              "speedups of$2.08\\times\\sim 8.57\\times~({\\rm on~the~geometric~mean})$, compared with KLU.",
          }
        : paper,
    ),
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  const abstract = dom.window.document.querySelector(".rfz-abstract p");
  assert.equal(
    abstract?.textContent,
    "speedups of 2.08× ∼ 8.57× (on the geometric mean), compared with KLU.",
  );
  mounted.destroy();
});

test("resolved paper titles become italic and underlined when an Abstract is available", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let state: ReaderSectionState = {
    ...readyState(),
    references: readyState().references.map((paper) =>
      paper.id === "ref-1" ? { ...paper, abstractLoading: true } : paper,
    ),
  };
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  assert.equal(
    dom.window.document.querySelector(
      '[data-paper-id="ref-1"] .rfz-paper-title--has-abstract',
    ),
    null,
  );
  state = {
    ...state,
    references: state.references.map((paper) =>
      paper.id === "ref-1"
        ? {
            ...paper,
            abstract: "Available Abstract",
            abstractLoading: false,
          }
        : paper,
    ),
  };
  listener?.(state);

  assert.equal(
    dom.window.document.querySelector(
      '[data-paper-id="ref-1"] .rfz-paper-title--has-abstract',
    )?.textContent,
    "First reference",
  );
  const abstractTitleRule =
    /\.rfz-paper--resolved \.rfz-paper-title--has-abstract\s*\{([^}]*)\}/u.exec(
      dom.window.document.querySelector("style")?.textContent ?? "",
    )?.[1] ?? "";
  assert.match(abstractTitleRule, /font-style:\s*italic/u);
  assert.match(abstractTitleRule, /text-decoration-line:\s*underline/u);
  assert.match(
    abstractTitleRule,
    /text-decoration-color:\s*var\(--rfz-accent\)/u,
  );
  mounted.destroy();
});

test("Reader section mounts XHTML content inside Zotero's XUL document", () => {
  const dom = new JSDOM(
    '<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"><html:div xmlns:html="http://www.w3.org/1999/xhtml"/></window>',
    { contentType: "application/xml" },
  );
  const body = dom.window.document.getElementsByTagNameNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  )[0] as HTMLElement;
  const actions: string[] = [];
  const mounted = mountReaderSection({
    body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      openMineruDirectory: () => actions.push("open-mineru"),
    },
  });

  const root = body.firstElementChild;
  assert.ok(root);
  assert.equal(root.namespaceURI, "http://www.w3.org/1999/xhtml");
  assert.doesNotMatch(root.textContent ?? "", /Related Papers/);
  assert.match(root.textContent ?? "", /MinerU MD/);
  assert.match(
    root.querySelector("[data-mineru-path]")?.textContent ?? "",
    /E:\\ZoteroData\\llm-for-zotero-mineru\\214/u,
  );
  assert.equal(root.querySelector(".rfz-selection-toolbar"), null);
  const titles = [...root.querySelectorAll("[data-paper-title]")];
  assert.deepEqual(
    titles.map(({ tagName, textContent }) => [tagName, textContent]),
    [
      ["div", "First reference"],
      ["div", "Second reference"],
    ],
  );
  assert.doesNotMatch(
    root.querySelector('[data-paper-id="ref-1"]')?.textContent ?? "",
    /Alpha/u,
  );
  assert.equal(
    root.querySelector('[data-paper-id="ref-1"] [data-paper-metadata]')
      ?.textContent,
    "2024 · Journal of First Results",
  );
  assert.equal(
    root.querySelector('[data-paper-id="ref-2"] [data-paper-metadata]')
      ?.textContent,
    "2023 · Proceedings of Second Tests",
  );
  assert.ok(
    [...root.querySelectorAll("input")].every(
      (input) => input.namespaceURI === "http://www.w3.org/1999/xhtml",
    ),
  );
  assert.match(
    dom.window.document.querySelector("style")?.textContent ?? "",
    /\.rfz-paper-title\s*\{[^}]*font-size:\s*13px/u,
  );
  const openMineru = root.querySelector(
    "[data-open-mineru-folder]",
  ) as HTMLElement;
  assert.equal(openMineru.tagName, "span");
  assert.equal(openMineru.textContent, "📂 打开文件夹");
  assert.equal(root.querySelector("[data-refresh]")?.textContent, "↻ 刷新");
  assert.match(
    dom.window.document.querySelector("style")?.textContent ?? "",
    /\.rfz-mineru-actions\s*\{[^}]*margin-left:\s*auto/u,
  );
  assert.equal(
    root.querySelector(".rfz-header > .rfz-mineru-actions")?.parentElement,
    root.querySelector(".rfz-header"),
  );
  openMineru.click();
  assert.deepEqual(actions, ["open-mineru"]);
  mounted.destroy();
});

test("download checkboxes preserve focus and stay isolated from paper actions", () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let state: ReaderSectionState = {
    ...readyState(),
    references: [
      ...readyState().references,
      {
        id: "ref-3",
        ordinal: 2,
        title: "Third confirmed reference",
        status: "resolved",
        primaryResultURL: "https://example.test/third",
      },
    ],
  };
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const actions: string[] = [];
  const controller: ReaderSectionController = {
    getState: () => state,
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    selectTab() {},
    setCitationLimit() {},
    selectPaper: (paperID) => actions.push(`detail:${paperID}`),
    refresh() {},
    openPaper: (paperID) => actions.push(`open:${paperID}`),
    openReferenceURL() {},
    performPaperAction() {},
    setPaperDownloadSelected(tab, paperID, selected) {
      actions.push(`select:${tab}:${paperID}:${selected}`);
      const entry = { originTab: tab, paperID };
      state = {
        ...state,
        downloadSelection: selected
          ? [...state.downloadSelection, entry]
          : state.downloadSelection.filter(
              (candidate) =>
                candidate.originTab !== tab || candidate.paperID !== paperID,
            ),
      };
      listener?.(state);
    },
    setTabDownloadSelected(tab, selected) {
      actions.push(`select-all:${tab}:${selected}`);
    },
    async downloadSelected() {
      actions.push("download");
    },
    openDownloadedFolder() {},
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller,
  });

  const resolvedCheckbox = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-select-paper]',
  ) as HTMLButtonElement | null;
  const unresolvedCheckbox = dom.window.document.querySelector(
    '[data-paper-id="ref-2"] [data-select-paper]',
  ) as HTMLButtonElement | null;
  assert.ok(resolvedCheckbox);
  assert.ok(unresolvedCheckbox);
  assert.match(
    resolvedCheckbox.getAttribute("aria-label") ?? "",
    /First reference/,
  );
  assert.equal(unresolvedCheckbox.disabled, true);
  assert.match(
    unresolvedCheckbox.getAttribute("aria-label") ?? "",
    /cannot be selected.*Unresolved/i,
  );
  assert.match(
    unresolvedCheckbox.closest("[data-paper-id]")?.textContent ?? "",
    /Download unavailable.*Unresolved/i,
  );

  resolvedCheckbox.focus();
  resolvedCheckbox.click();
  const replacement = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-select-paper]',
  ) as HTMLButtonElement | null;
  assert.equal(replacement?.getAttribute("aria-checked"), "true");
  assert.equal(dom.window.document.activeElement, replacement);
  assert.equal(dom.window.document.querySelector("[data-select-tab]"), null);
  assert.deepEqual(actions, ["select:references:ref-1:true"]);

  replacement.dispatchEvent(
    new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.ok(
    !dom.window.document
      .querySelector("[data-paper-context-menu]")
      ?.classList.contains("is-open"),
  );
  const downloadButton = dom.window.document.querySelector(
    "[data-download-selected]",
  ) as HTMLButtonElement | null;
  assert.ok(downloadButton);
  assert.equal(downloadButton.disabled, false);
  assert.match(downloadButton.textContent ?? "", /\(1\)/u);
  downloadButton.click();
  assert.deepEqual(actions, ["select:references:ref-1:true", "download"]);
  mounted.destroy();
});

test("Reader removes the empty bottom selection dock", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  assert.equal(dom.window.document.querySelector(".rfz-download-dock"), null);
  assert.doesNotMatch(
    dom.window.document.body.textContent ?? "",
    /0 selected/u,
  );
  mounted.destroy();
});

test("Reader paints selection controls without native checkbox inputs", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  assert.equal(
    dom.window.document.querySelectorAll('input[type="checkbox"]').length,
    0,
  );
  const controls = [
    ...dom.window.document.querySelectorAll('[role="checkbox"]'),
  ] as HTMLElement[];
  assert.equal(controls.length, readyState().references.length);
  assert.ok(controls.every((control) => control.tagName === "BUTTON"));
  assert.ok(
    controls.every(
      (control) => dom.window.getComputedStyle(control).display !== "none",
    ),
  );
  mounted.destroy();
});

test("download selection projects across tabs by complete stable identity", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const selected: boolean[] = [];
  const reference = {
    ...readyState().references[0],
    id: "reference:shared",
    doi: "10.1000/shared",
    arxivID: "2401.00001",
  } as ReaderPaper;
  const citation = {
    ...reference,
    id: "citation:shared",
  };
  const state: ReaderSectionState = {
    ...readyState(),
    activeTab: "citations",
    references: [reference],
    citingPapers: [citation],
    downloadSelection: [
      { originTab: "references", paperID: "reference:shared" },
    ],
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      setPaperDownloadSelected(_tab, _paperID, value) {
        selected.push(value);
      },
    },
  });

  const checkbox = dom.window.document.querySelector(
    '[data-paper-id="citation:shared"] [data-select-paper]',
  ) as HTMLButtonElement | null;
  assert.equal(checkbox?.getAttribute("aria-checked"), "true");
  checkbox?.click();
  assert.deepEqual(selected, [false]);
  mounted.destroy();
});

test("Reader download projection exposes only four per-paper states and the actual saved path", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const references = (
    [
      ["queued", "Queued paper"],
      ["downloading", "Downloading paper"],
      ["downloaded", "Downloaded paper"],
      ["failed", "Failed paper"],
    ] as const
  ).map(([id, title], ordinal) => ({
    id,
    ordinal,
    title,
    status: "resolved" as const,
    primaryResultURL: `https://example.test/${id}`,
  }));
  const savedPath = "E:\\paper\\Downloaded paper.pdf";
  const boundaryError = "publisher refused https://publisher.test/file";
  const state: ReaderSectionState = {
    ...readyState(),
    references,
    downloadSelection: references.map((paper) => ({
      originTab: "references" as const,
      paperID: paper.id,
    })),
    paperDownloads: [
      { originTab: "references", paperID: "queued", status: "queued" },
      {
        originTab: "references",
        paperID: "downloading",
        status: "downloading",
      },
      {
        originTab: "references",
        paperID: "downloaded",
        status: "downloaded",
        savedPath,
      },
      {
        originTab: "references",
        paperID: "failed",
        status: "failed",
        error: boundaryError,
      },
    ],
    downloadInProgress: true,
  };
  const opened: string[] = [];
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      openDownloadedFolder(paperID) {
        opened.push(paperID);
      },
    },
  });

  assert.deepEqual(
    [...dom.window.document.querySelectorAll("[data-download-state]")].map(
      (element) => element.getAttribute("data-download-state"),
    ),
    ["queued", "downloading", "downloaded", "failed"],
  );
  assert.equal(
    dom.window.document.querySelector("[data-saved-path]")?.textContent,
    savedPath,
  );
  assert.match(
    dom.window.document.body.textContent ?? "",
    new RegExp(boundaryError.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(
    dom.window.document.querySelectorAll("[data-open-folder]").length,
    1,
  );
  assert.equal(
    (
      dom.window.document.querySelector(
        "[data-download-selected]",
      ) as HTMLButtonElement
    ).disabled,
    true,
  );
  assert.doesNotMatch(
    dom.window.document.body.textContent ?? "",
    /validating|saving|already-downloaded|partial|retry|recovery|importing/i,
  );
  (
    dom.window.document.querySelector("[data-open-folder]") as HTMLButtonElement
  ).click();
  assert.deepEqual(opened, ["downloaded"]);
  mounted.destroy();
});

test("Reader section renders Reference entries in source order and selects Citations through its controller", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const actions: string[] = [];
  let listener: ((state: ReaderSectionState) => void) | undefined;
  const controller: ReaderSectionController = {
    ...downloadControllerStubs(),
    getState: readyState,
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    selectTab(tab) {
      actions.push(`tab:${tab}`);
    },
    setCitationLimit() {},
    selectPaper() {},
    refresh() {},
    openPaper() {},
    performPaperAction() {},
  };

  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller,
  });

  assert.deepEqual(
    [...dom.window.document.querySelectorAll("[data-paper-id]")].map(
      (element) => element.querySelector("[data-paper-title]")?.textContent,
    ),
    ["First reference", "Second reference"],
  );
  assert.deepEqual(
    [...dom.window.document.querySelectorAll(".rfz-ordinal")].map(
      (element) => element.textContent,
    ),
    ["1.", "5."],
  );

  const citationsTab = dom.window.document.querySelector(
    '[data-tab="citations"]',
  ) as HTMLElement | null;
  assert.ok(citationsTab);
  assert.equal(citationsTab.tagName, "DIV");
  assert.equal(citationsTab.getAttribute("role"), "tab");
  citationsTab.click();
  assert.deepEqual(actions, ["tab:citations"]);
  citationsTab.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
  );
  assert.deepEqual(actions, ["tab:citations", "tab:citations"]);

  mounted.destroy();
  assert.equal(listener, undefined);
});

test("Reader section exposes cumulative citation limits, paper details, safe opening, and refresh", () => {
  const dom = new JSDOM(
    '<!doctype html><body><main style="overflow: hidden"><section id="reader-section"></section></main></body>',
  );
  Object.defineProperties(dom.window, {
    innerWidth: { configurable: true, value: 1600 },
    innerHeight: { configurable: true, value: 600 },
  });
  let selectedRowTop = 260;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches("[data-detail-card]")) {
      return domRect({ top: 0, left: 0, width: 760, height: 180 });
    }
    if (this.dataset.paperId === "citing-1") {
      return domRect({
        top: selectedRowTop,
        left: 1200,
        width: 400,
        height: 80,
      });
    }
    if (this.classList.contains("reference-for-zotero")) {
      return domRect({ top: 80, left: 1200, width: 400, height: 520 });
    }
    return domRect({ top: 0, left: 0, width: 0, height: 0 });
  };
  let state: ReaderSectionState = {
    ...readyState(),
    activeTab: "citations",
    citingPapers: Array.from({ length: 35 }, (_, index): ReaderPaper => {
      const paper = {
        id: `citing-${index + 1}`,
        ordinal: index,
        title: `Citing paper ${index + 1}`,
        authors: `Author ${index + 1}`,
        venue: "Journal",
        year: String(2026 - Math.floor(index / 5)),
        doi: index === 0 ? "10.1000/example" : undefined,
        abstract: index === 0 ? "A useful abstract." : undefined,
        citationCount: index === 0 ? 12 : undefined,
        referenceCount: index === 0 ? 34 : undefined,
        source: index === 0 ? "crossref" : undefined,
        sourceRecordID: index === 0 ? "10.1000/example" : undefined,
        retrievedAt: index === 0 ? "2026-07-30T00:00:00.000Z" : undefined,
        matchedFields: index === 0 ? ["doi"] : undefined,
        connectedPaperInfo:
          index === 0 ? "Connected via citing:doi:10.1000/example" : undefined,
      };
      return index === 1
        ? { ...paper, status: "unresolved" }
        : {
            ...paper,
            status: "resolved",
            primaryResultURL: `https://example.test/citing-${index + 1}`,
            matchedBy: "metadata",
          };
    }),
    citingPapersLoaded: 30,
  };
  const actions: string[] = [];
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const controller: ReaderSectionController = {
    ...downloadControllerStubs(),
    getState: () => state,
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    selectTab(tab) {
      actions.push(`tab:${tab}`);
    },
    setCitationLimit(limit) {
      actions.push(`limit:${limit}`);
      state = { ...state, citingPaperLimit: limit };
      listener?.(state);
    },
    selectPaper(paperID) {
      actions.push(`select:${paperID}`);
      state = {
        ...state,
        selectedPaperID:
          state.selectedPaperID === paperID ? undefined : paperID,
      };
      listener?.(state);
    },
    refresh() {
      actions.push("refresh");
    },
    openPaper(paperID) {
      actions.push(`open:${paperID}`);
    },
    performPaperAction() {},
  };

  const mounted = mountReaderSection({
    body: dom.window.document.querySelector("#reader-section") as HTMLElement,
    controller,
  });

  assert.equal(
    dom.window.document.querySelectorAll("[data-paper-id]").length,
    10,
  );
  assert.deepEqual(
    [...dom.window.document.querySelectorAll("[data-limit]")].map(
      ({ tagName, textContent }) => [tagName, textContent],
    ),
    [
      ["DIV", "10"],
      ["DIV", "30"],
      ["DIV", "50"],
    ],
  );
  const styles = dom.window.document.querySelector("style")?.textContent ?? "";
  assert.match(styles, /\.rfz-header\s*\{[^}]*position:\s*sticky/u);
  assert.match(styles, /\.rfz-tabs\s*\{[^}]*position:\s*sticky/u);
  (
    dom.window.document.querySelector(
      '[data-limit="30"]',
    ) as HTMLButtonElement | null
  )?.click();
  assert.equal(
    dom.window.document.querySelectorAll("[data-paper-id]").length,
    30,
  );
  dom.window.document
    .querySelector('[data-limit="50"]')
    ?.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
  assert.equal(
    dom.window.document.querySelectorAll("[data-paper-id]").length,
    35,
  );

  const firstTitle = dom.window.document.querySelector(
    '[data-paper-id="citing-1"] [data-paper-title]',
  ) as HTMLElement | null;
  assert.ok(firstTitle);
  firstTitle.click();
  const detailCard = dom.window.document.querySelector("[data-detail-card]");
  assert.ok(detailCard);
  assert.equal(
    detailCard.parentElement?.dataset.readerOverlay,
    "",
    "detail card must escape Zotero's clipped custom-section body",
  );
  assert.equal((detailCard as HTMLElement).style.top, "260px");
  selectedRowTop = 520;
  dom.window.document.dispatchEvent(new dom.window.Event("scroll"));
  assert.equal((detailCard as HTMLElement).style.top, "408px");
  selectedRowTop = -80;
  dom.window.document.dispatchEvent(new dom.window.Event("scroll"));
  assert.equal((detailCard as HTMLElement).style.top, "12px");
  assert.ok(detailCard.querySelector("[data-detail-close]"));
  assert.deepEqual(
    [...detailCard.querySelectorAll(".rfz-badges span")].map(
      (badge) => badge.textContent,
    ),
    [
      "12 citations",
      "34 references",
      "Connected via citing:doi:10.1000/example",
      "DOI: 10.1000/example",
    ],
  );
  assert.match(detailCard.textContent ?? "", /Author 1/);
  assert.match(detailCard.textContent ?? "", /Journal · 2026/);
  assert.match(detailCard.textContent ?? "", /A useful abstract\./);
  assert.equal(dom.window.document.querySelector(".rfz-provenance"), null);
  assert.doesNotMatch(
    dom.window.document.querySelector('[data-paper-id="citing-1"]')
      ?.textContent ?? "",
    /Source:|Matched by:/u,
  );
  assert.doesNotMatch(
    detailCard.textContent ?? "",
    /Background|Open|Matched by|Source:|Record:|Retrieved:|Provider failures:/,
  );
  const closeButton = detailCard.querySelector(
    "[data-detail-close]",
  ) as HTMLElement;
  assert.equal(
    closeButton.closest<HTMLElement>("[data-paper-id]")?.dataset.paperId,
    "citing-1",
  );
  closeButton.click();
  assert.equal(
    actions.filter((action) => action === "select:citing-1").length,
    2,
  );
  assert.equal(dom.window.document.querySelector("[data-detail-card]"), null);

  state = { ...state, selectedPaperID: "citing-3" };
  listener?.(state);
  const unavailableAbstract =
    dom.window.document.querySelector(".rfz-abstract");
  assert.ok(unavailableAbstract);
  assert.match(unavailableAbstract.textContent ?? "", /^Abstract/u);
  assert.match(
    unavailableAbstract.textContent ?? "",
    /current metadata source did not provide an abstract/iu,
  );
  state = { ...state, selectedPaperID: undefined };
  listener?.(state);

  dom.window.document
    .querySelector('[data-paper-id="citing-1"] [data-paper-title]')
    ?.dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
    );
  const unresolvedTitle = dom.window.document.querySelector(
    '[data-paper-id="citing-2"] [data-paper-title]',
  ) as HTMLElement | null;
  assert.ok(unresolvedTitle);
  unresolvedTitle.dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
  );
  (
    dom.window.document.querySelector(
      "[data-refresh]",
    ) as HTMLButtonElement | null
  )?.click();

  assert.deepEqual(actions, [
    "limit:30",
    "limit:50",
    "select:citing-1",
    "select:citing-1",
    "open:citing-1",
    "open:citing-2",
    "refresh",
  ]);

  mounted.destroy();
});

test("Reader section delegates Ctrl+left-click for resolved and unresolved titles", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const actions: string[] = [];
  const state: ReaderSectionState = {
    ...readyState(),
    references: [
      {
        id: "reachable",
        ordinal: 0,
        title: "Reachable paper",
        status: "resolved",
        primaryResultURL: "https://publisher.example/reachable",
        matchedBy: "doi",
      },
      {
        id: "unverified",
        ordinal: 1,
        title: "Unverified paper",
        status: "unreachable",
        primaryResultURL: "https://publisher.example/unverified",
        matchedBy: "doi",
      } as unknown as ReaderPaper,
    ],
  };
  const controller: ReaderSectionController = {
    ...downloadControllerStubs(),
    getState: () => state,
    subscribe: () => () => {},
    selectTab() {},
    setCitationLimit() {},
    selectPaper: (paperID) => actions.push(`select:${paperID}`),
    refresh() {},
    openPaper: (paperID) => actions.push(`open:${paperID}`),
    performPaperAction() {},
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller,
  });
  const reachable = dom.window.document.querySelector(
    '[data-paper-id="reachable"] [data-paper-title]',
  );
  const unverified = dom.window.document.querySelector(
    '[data-paper-id="unverified"] [data-paper-title]',
  );
  assert.ok(reachable);
  assert.ok(unverified);
  assert.equal(
    unverified.closest("[data-paper-id]")?.querySelector(".rfz-paper-status"),
    null,
  );

  reachable.dispatchEvent(
    new dom.window.MouseEvent("click", {
      bubbles: true,
      ctrlKey: true,
      button: 0,
    }),
  );
  reachable.dispatchEvent(
    new dom.window.MouseEvent("click", {
      bubbles: true,
      metaKey: true,
      button: 0,
    }),
  );
  reachable.dispatchEvent(
    new dom.window.MouseEvent("click", {
      bubbles: true,
      ctrlKey: true,
      button: 1,
    }),
  );
  unverified.dispatchEvent(
    new dom.window.MouseEvent("click", {
      bubbles: true,
      ctrlKey: true,
      button: 0,
    }),
  );

  assert.deepEqual(actions, ["open:reachable", "open:unverified"]);
  mounted.destroy();
});

test("a normal left click replaces a stale text selection with the paper action", () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const selected: string[] = [];
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper: (paperID) => selected.push(paperID),
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });
  const firstTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  const secondTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-2"] [data-paper-title]',
  );
  assert.ok(firstTitle);
  assert.ok(secondTitle);
  selectNodeContents(dom, firstTitle);

  secondTitle.dispatchEvent(
    new dom.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  secondTitle.dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, button: 0 }),
  );

  assert.deepEqual(selected, ["ref-2"]);

  firstTitle.dispatchEvent(
    new dom.window.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  selectNodeContents(dom, firstTitle);
  firstTitle.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true, button: 0 }),
  );
  firstTitle.dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, button: 0 }),
  );

  assert.deepEqual(selected, ["ref-2"]);
  mounted.destroy();
});

test("Reader paper rows expose XUL-compatible context actions", () => {
  const dom = new JSDOM(
    '<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"><html:section xmlns:html="http://www.w3.org/1999/xhtml"/></window>',
    { contentType: "application/xml" },
  );
  const body = dom.window.document.getElementsByTagNameNS(
    "http://www.w3.org/1999/xhtml",
    "section",
  )[0] as HTMLElement;
  const actions: string[] = [];
  const mounted = mountReaderSection({
    body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction(paperID, action) {
        actions.push(`${paperID}:${action}`);
      },
    },
  });
  const firstTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  assert.ok(firstTitle);

  const openMenu = (): HTMLElement => {
    firstTitle.dispatchEvent(
      new dom.window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 120,
        clientY: 80,
      }),
    );
    const menu = dom.window.document.querySelector(
      "[data-paper-context-menu]",
    ) as HTMLElement | null;
    assert.ok(menu);
    assert.ok(menu.classList.contains("is-open"));
    assert.ok(menu.parentElement?.querySelector("style"));
    return menu;
  };

  assert.deepEqual(
    [...openMenu().querySelectorAll("[data-paper-action]")].map(
      ({ tagName, textContent }) => [tagName, textContent],
    ),
    [
      ["div", "复制论文标题"],
      ["div", "复制 DOI"],
      ["div", "使用 Google 搜索"],
    ],
  );
  (
    openMenu().querySelector('[data-paper-action="copy-title"]') as HTMLElement
  ).click();
  (
    openMenu().querySelector('[data-paper-action="copy-doi"]') as HTMLElement
  ).click();
  (
    openMenu().querySelector(
      '[data-paper-action="google-search"]',
    ) as HTMLElement
  ).click();

  assert.deepEqual(actions, [
    "ref-1:copy-title",
    "ref-1:copy-doi",
    "ref-1:google-search",
  ]);

  const secondTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-2"] [data-paper-title]',
  );
  assert.ok(secondTitle);
  secondTitle.dispatchEvent(
    new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(
    dom.window.document
      .querySelector('[data-paper-action="copy-doi"]')
      ?.getAttribute("aria-disabled"),
    "true",
  );

  mounted.destroy();
  assert.equal(
    dom.window.document.querySelector("[data-paper-context-menu]"),
    null,
  );
});

test("a non-bubbling XUL context event opens actions from the blue paper title", () => {
  const dom = new JSDOM(
    '<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"><html:section xmlns:html="http://www.w3.org/1999/xhtml"/></window>',
    { contentType: "application/xml" },
  );
  const body = dom.window.document.getElementsByTagNameNS(
    "http://www.w3.org/1999/xhtml",
    "section",
  )[0] as HTMLElement;
  const mounted = mountReaderSection({
    body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });
  const title = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  ) as HTMLElement | null;
  assert.ok(title);

  const event = new dom.window.MouseEvent("contextmenu", {
    bubbles: false,
    cancelable: true,
    clientX: 120,
    clientY: 80,
  });
  title.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.ok(
    dom.window.document
      .querySelector("[data-paper-context-menu]")
      ?.classList.contains("is-open"),
  );
  mounted.destroy();
});

test("Reader context actions stay on the original list title after details open", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let state = readyState();
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const selections: string[] = [];
  const actions: string[] = [];
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab() {},
      setCitationLimit() {},
      selectPaper(paperID) {
        selections.push(paperID);
        state = { ...state, selectedPaperID: paperID };
        listener?.(state);
      },
      refresh() {},
      openPaper() {},
      performPaperAction(paperID, action) {
        actions.push(`${paperID}:${action}`);
      },
    },
  });

  const listTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  ) as HTMLElement | null;
  assert.ok(listTitle);
  listTitle.click();
  assert.deepEqual(selections, ["ref-1"]);

  const renderedListTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  ) as HTMLElement | null;
  assert.ok(renderedListTitle);
  const listContextEvent = new dom.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 120,
    clientY: 80,
  });
  renderedListTitle.dispatchEvent(listContextEvent);

  assert.equal(listContextEvent.defaultPrevented, true);
  assert.ok(
    dom.window.document
      .querySelector("[data-paper-context-menu]")
      ?.classList.contains("is-open"),
  );
  assert.ok(
    renderedListTitle
      .closest("[data-paper-id]")
      ?.classList.contains("is-context-target"),
  );
  (
    dom.window.document.querySelector(
      '[data-paper-action="copy-title"]',
    ) as HTMLElement
  ).click();
  assert.deepEqual(actions, ["ref-1:copy-title"]);
  assert.ok(
    !renderedListTitle
      .closest("[data-paper-id]")
      ?.classList.contains("is-context-target"),
  );

  const detailTitle = dom.window.document.querySelector(
    "[data-detail-card] .rfz-card-title",
  ) as HTMLElement | null;
  assert.ok(detailTitle);
  const detailContextEvent = new dom.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  detailTitle.dispatchEvent(detailContextEvent);
  assert.equal(detailContextEvent.defaultPrevented, true);
  assert.ok(
    !dom.window.document
      .querySelector("[data-paper-context-menu]")
      ?.classList.contains("is-open"),
  );

  const rowGap = renderedListTitle.closest("[data-paper-id]") as HTMLElement;
  rowGap.dispatchEvent(
    new dom.window.MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.ok(
    !dom.window.document
      .querySelector("[data-paper-context-menu]")
      ?.classList.contains("is-open"),
  );
  assert.equal(
    dom.window.getComputedStyle(
      dom.window.document.querySelector("[data-reader-overlay]")!,
    ).pointerEvents,
    "none",
  );
  mounted.destroy();
});

test("Reader section closes an open detail card when clicking the paper view", () => {
  const dom = new JSDOM(
    '<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"><html:section xmlns:html="http://www.w3.org/1999/xhtml"/></window>',
    { contentType: "application/xml" },
  );
  const body = dom.window.document.getElementsByTagNameNS(
    "http://www.w3.org/1999/xhtml",
    "section",
  )[0] as HTMLElement;
  const readerChromeDocument = new JSDOM("<!doctype html><body></body>").window
    .document;
  const paperDocument = new JSDOM(
    "<!doctype html><body><main data-reader-page></main></body>",
  ).window.document;
  const secondaryPaperDocument = new JSDOM(
    "<!doctype html><body><main data-reader-page></main></body>",
  ).window.document;
  const reader = {
    _iframeWindow: readerChromeDocument.defaultView!,
    _internalReader: {
      _primaryView: { _iframeWindow: paperDocument.defaultView! },
      _secondaryView: {
        _iframeWindow: secondaryPaperDocument.defaultView!,
      },
    },
  };
  let state = readyState();
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const selections: string[] = [];
  const mounted = mountReaderSection({
    body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab() {},
      setCitationLimit() {},
      selectPaper(paperID) {
        selections.push(paperID);
        state = {
          ...state,
          selectedPaperID:
            state.selectedPaperID === paperID ? undefined : paperID,
        };
        listener?.(state);
      },
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      externalInteractionDocuments: () =>
        zoteroReaderInteractionDocuments(reader),
    },
  });

  (
    dom.window.document.querySelector(
      '[data-paper-id="ref-1"] [data-paper-title]',
    ) as HTMLElement
  ).click();
  const detailCard = dom.window.document.querySelector(
    "[data-detail-card]",
  ) as HTMLElement | null;
  const overlay = dom.window.document.querySelector(
    "[data-reader-overlay]",
  ) as HTMLElement | null;
  assert.ok(detailCard);
  assert.ok(overlay);
  assert.ok(overlay.classList.contains("is-open"));
  const styles = dom.window.document.querySelector("style")?.textContent ?? "";
  assert.match(
    styles,
    /\.rfz-overlay\.is-open\s*\{[^}]*pointer-events:\s*none/u,
  );

  paperDocument.querySelector("[data-reader-page]")?.dispatchEvent(
    new paperDocument.defaultView!.MouseEvent("pointerdown", {
      bubbles: true,
    }),
  );
  assert.equal(dom.window.document.querySelector("[data-detail-card]"), null);
  assert.ok(!overlay.classList.contains("is-open"));
  assert.deepEqual(selections, ["ref-1", "ref-1"]);

  (
    dom.window.document.querySelector(
      '[data-paper-id="ref-1"] [data-paper-title]',
    ) as HTMLElement
  ).click();
  secondaryPaperDocument.querySelector("[data-reader-page]")?.dispatchEvent(
    new secondaryPaperDocument.defaultView!.MouseEvent("pointerdown", {
      bubbles: true,
    }),
  );
  assert.equal(dom.window.document.querySelector("[data-detail-card]"), null);
  assert.deepEqual(selections, ["ref-1", "ref-1", "ref-1", "ref-1"]);

  mounted.destroy();
});

test("selecting text inside an open detail card does not dismiss it", () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let state = readyState();
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab() {},
      setCitationLimit() {},
      selectPaper(paperID) {
        state = {
          ...state,
          selectedPaperID:
            state.selectedPaperID === paperID ? undefined : paperID,
        };
        listener?.(state);
      },
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      externalInteractionDocuments: () => [dom.window.document],
    },
  });

  (
    dom.window.document.querySelector(
      '[data-paper-id="ref-1"] [data-paper-title]',
    ) as HTMLElement
  ).click();
  const detailCard = dom.window.document.querySelector("[data-detail-card]");
  const overlay = dom.window.document.querySelector("[data-reader-overlay]");
  assert.ok(detailCard);
  assert.ok(overlay);
  assert.equal(
    overlay.parentElement?.parentElement,
    dom.window.document.documentElement,
  );
  assert.ok(Number(dom.window.getComputedStyle(overlay).zIndex) >= 2147483000);
  const abstract = dom.window.document.querySelector(".rfz-abstract p");
  assert.ok(abstract);
  selectNodeContents(dom, abstract);
  abstract.dispatchEvent(
    new dom.window.MouseEvent("pointerdown", { bubbles: true }),
  );
  assert.ok(dom.window.document.querySelector("[data-detail-card]"));
  abstract.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  assert.ok(dom.window.document.querySelector("[data-detail-card]"));
  abstract.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

  assert.ok(dom.window.document.querySelector("[data-detail-card]"));
  dom.window.document.body.dispatchEvent(
    new dom.window.MouseEvent("pointerdown", { bubbles: true }),
  );
  dom.window.document.body.dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true }),
  );
  assert.equal(dom.window.document.querySelector("[data-detail-card]"), null);
  mounted.destroy();
});

test("unresolved references open their canonical Reference text", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let state: ReaderSectionState = readyState();
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const opened: string[] = [];
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab() {},
      setCitationLimit() {},
      selectPaper(paperID) {
        state = { ...state, selectedPaperID: paperID };
        listener?.(state);
      },
      refresh() {},
      openPaper() {},
      openReferenceURL(url) {
        opened.push(url);
      },
      performPaperAction() {},
    },
  });

  (
    dom.window.document.querySelector(
      '[data-paper-id="ref-2"] [data-paper-title]',
    ) as HTMLButtonElement
  ).click();

  const detailCard = dom.window.document.querySelector("[data-detail-card]");
  assert.ok(detailCard);
  assert.match(
    detailCard.querySelector("[data-reference-text]")?.textContent ?? "",
    /B\. Author\. Second reference/u,
  );
  const link = detailCard.querySelector(
    '[data-reference-link="https://example.test/second"]',
  ) as HTMLAnchorElement | null;
  assert.ok(link);
  link.click();
  assert.deepEqual(opened, ["https://example.test/second"]);
  mounted.destroy();
});

test("Reader section keeps unresolved rows title-only while retaining actionable invalid identifier status", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const state: ReaderSectionState = {
    ...readyState(),
    references: [
      {
        id: "invalid",
        ordinal: 0,
        title: "doi: not-a-doi",
        status: "invalid-identifier",
      },
      {
        id: "unreachable",
        ordinal: 1,
        title: "Known paper",
        status: "unreachable",
      },
    ],
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  assert.deepEqual(
    [...dom.window.document.querySelectorAll(".rfz-paper-status")].map(
      (status) => status.textContent,
    ),
    ["Invalid identifier"],
  );
  assert.equal(
    dom.window.document.querySelector(
      '[data-paper-id="unreachable"] .rfz-paper-status',
    ),
    null,
  );
  mounted.destroy();
});

test("Reader section translates only text selected inside the extension UI", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const translated: string[] = [];
  const paperSelections: string[] = [];
  const downloadSelections: string[] = [];
  let downloads = 0;
  let state: ReaderSectionState = {
    ...readyState(),
    selectedPaperID: "ref-1",
    references: readyState().references.map((paper) =>
      paper.id === "ref-1" ? { ...paper, abstractLoading: true } : paper,
    ),
    paperDownloads: [
      {
        originTab: "references",
        paperID: "ref-1",
        status: "downloaded",
        savedPath: "E:\\paper\\First reference.pdf",
      },
    ],
  };
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const controller: ReaderSectionController = {
    ...downloadControllerStubs(),
    getState: () => state,
    subscribe(next) {
      listener = next;
      return () => {};
    },
    selectTab() {},
    setCitationLimit() {},
    selectPaper(paperID) {
      paperSelections.push(paperID);
    },
    refresh() {},
    openPaper() {},
    performPaperAction() {},
    setPaperDownloadSelected(_tab, paperID) {
      downloadSelections.push(paperID);
    },
    async downloadSelected() {
      downloads += 1;
    },
    async translateSelection(text) {
      translated.push(text);
      return "第一篇参考文献";
    },
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller,
  });
  const loadingAbstract = dom.window.document.querySelector(".rfz-abstract p");
  assert.ok(loadingAbstract);
  selectNodeContents(dom, loadingAbstract);
  loadingAbstract.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(translated, []);

  state = {
    ...state,
    references: state.references.map((paper) =>
      paper.id === "ref-1"
        ? {
            ...paper,
            abstractLoading: false,
            abstractError: "Provider request failed",
          }
        : paper,
    ),
  };
  listener?.(state);
  const failedAbstract = dom.window.document.querySelector(".rfz-abstract p");
  assert.ok(failedAbstract);
  selectNodeContents(dom, failedAbstract);
  failedAbstract.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(translated, []);

  const sectionHeading =
    dom.window.document.querySelector(".rfz-header strong");
  assert.ok(sectionHeading);
  selectNodeContents(dom, sectionHeading);
  sectionHeading.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(translated, []);

  const savedPath = dom.window.document.querySelector("[data-saved-path]");
  assert.ok(savedPath);
  selectNodeContents(dom, savedPath);
  savedPath.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(translated, []);

  const title = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  assert.ok(title?.firstChild);
  selectNodeContents(dom, title);

  title.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(translated, ["First reference"]);
  assert.deepEqual(paperSelections, []);
  assert.deepEqual(downloadSelections, []);
  assert.equal(downloads, 0);
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "第一篇参考文献",
  );
  mounted.destroy();
});

test("Reader section renders detail translations inside the detail overlay", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const ready = readyState();
  const state: ReaderSectionState = {
    ...ready,
    selectedPaperID: "ref-1",
    references: ready.references.map((paper) =>
      paper.id === "ref-1"
        ? { ...paper, abstract: "Selected abstract" }
        : paper,
    ),
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      async translateSelection() {
        return "译文";
      },
    },
  });
  const abstract = dom.window.document.querySelector(".rfz-abstract p");
  const overlay = dom.window.document.querySelector("[data-reader-overlay]");
  assert.ok(abstract);
  assert.ok(overlay);
  const selectionRange = selectNodeContents(dom, abstract);
  Object.defineProperty(selectionRange, "getBoundingClientRect", {
    configurable: true,
    value: () => domRect({ top: 700, left: 900, width: 100, height: 20 }),
  });
  const getElementRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.matches("[data-translation]")
      ? domRect({ top: 0, left: 0, width: 340, height: 100 })
      : getElementRect.call(this);
  };

  abstract.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const translation = dom.window.document.querySelector("[data-translation]");
  assert.ok(translation);
  assert.equal(translation.parentElement, overlay);
  assert.equal((translation as HTMLElement).style.left, "674px");
  assert.equal((translation as HTMLElement).style.top, "592px");
  assert.equal((translation as HTMLElement).style.right, "auto");
  assert.equal((translation as HTMLElement).style.bottom, "auto");
  assert.equal(
    translation.querySelector("[data-translation-result]")?.textContent,
    "译文",
  );

  const listTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  const root = dom.window.document.querySelector(".reference-for-zotero");
  assert.ok(listTitle);
  assert.ok(root);
  selectNodeContents(dom, listTitle);
  listTitle.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const translations =
    dom.window.document.querySelectorAll("[data-translation]");
  assert.equal(translations.length, 1);
  assert.equal(translations[0]?.parentElement, root);
  mounted.destroy();
});

test("translation stays open after the selection gesture and closes on the next outside press", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let resolveTranslation: ((value: string) => void) | undefined;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      translateSelection: () =>
        new Promise<string>((resolve) => {
          resolveTranslation = resolve;
        }),
    },
  });
  const title = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  assert.ok(title);
  selectNodeContents(dom, title);
  title.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const translation = dom.window.document.querySelector("[data-translation]");
  assert.ok(translation);
  assert.equal(
    translation.querySelector("[data-translation-result]")?.textContent,
    "Translating…",
  );
  translation.dispatchEvent(
    new dom.window.Event("pointerdown", { bubbles: true }),
  );
  assert.ok(dom.window.document.querySelector("[data-translation]"));

  dom.window.document.body.dispatchEvent(
    new dom.window.Event("pointerdown", { bubbles: true }),
  );
  assert.equal(dom.window.document.querySelector("[data-translation]"), null);
  resolveTranslation?.("late translation");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector("[data-translation]"), null);
  mounted.destroy();
});

test("controller rerenders do not discard a visible translation", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const state = readyState();
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {};
      },
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      async translateSelection() {
        return "stable translation";
      },
    },
  });
  const title = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  assert.ok(title);
  selectNodeContents(dom, title);
  title.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "stable translation",
  );

  listener?.(state);

  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "stable translation",
  );
  mounted.destroy();
});

test("a translation failure ends only that request and the next selection can retry", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let translationCalls = 0;
  const opened: string[] = [];
  let downloads = 0;
  const state: ReaderSectionState = {
    ...readyState(),
    downloadSelection: [{ originTab: "references", paperID: "ref-1" }],
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper(paperID) {
        opened.push(paperID);
      },
      performPaperAction() {},
      async downloadSelected() {
        downloads += 1;
      },
      async translateSelection() {
        translationCalls += 1;
        if (translationCalls === 1) {
          throw new Error("Paper Translate service unavailable");
        }
        return "第二篇参考文献";
      },
    },
  });
  const firstTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  const secondTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-2"] [data-paper-title]',
  );
  assert.ok(firstTitle);
  assert.ok(secondTitle);

  selectNodeContents(dom, firstTitle);
  firstTitle.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(translationCalls, 1);
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "Paper Translate service unavailable",
  );
  assert.deepEqual(
    [...dom.window.document.querySelectorAll("[data-paper-id]")].map(
      (element) => element.querySelector("[data-paper-title]")?.textContent,
    ),
    ["First reference", "Second reference"],
  );
  firstTitle.dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true, ctrlKey: true }),
  );
  (
    dom.window.document.querySelector(
      "[data-download-selected]",
    ) as HTMLButtonElement
  ).click();
  assert.deepEqual(opened, ["ref-1"]);
  assert.equal(downloads, 1);

  selectNodeContents(dom, secondTitle);
  secondTitle.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(translationCalls, 2);
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "第二篇参考文献",
  );
  mounted.destroy();
});

test("Reader keeps every self-painted checkbox visible when Zotero hides native inputs", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const body = dom.window.document.body;
  const state: ReaderSectionState = {
    ...readyState(),
    downloadSelection: [{ originTab: "references", paperID: "ref-1" }],
  };
  let downloadAttempts = 0;
  const mounted = mountReaderSection({
    body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      async downloadSelected() {
        downloadAttempts += 1;
      },
    },
  });

  assert.equal(body.querySelector("[data-download-setup]"), null);
  assert.doesNotMatch(body.textContent ?? "", /requests==2\.34\.2 is missing/u);
  const rows = [...body.querySelectorAll(".rfz-paper")] as HTMLElement[];
  const checkboxes = [
    ...body.querySelectorAll(".rfz-paper-checkbox"),
  ] as HTMLButtonElement[];
  const row = rows[0];
  const checkbox = checkboxes[0];
  const ordinal = body.querySelector(".rfz-ordinal") as HTMLElement | null;
  const main = body.querySelector(".rfz-paper-main") as HTMLElement | null;
  const title = body.querySelector(".rfz-paper-title") as HTMLElement | null;
  assert.equal(rows.length, state.references.length);
  assert.equal(checkboxes.length, rows.length);
  assert.ok(row);
  assert.ok(checkbox);
  assert.ok(ordinal);
  assert.ok(main);
  assert.ok(title);
  const hostStyle = dom.window.document.createElement("style");
  hostStyle.textContent =
    'input[type="checkbox"] { display: none !important; }';
  body.append(hostStyle);
  assert.ok(
    checkboxes.every(
      (paperCheckbox) =>
        dom.window.getComputedStyle(paperCheckbox).display === "inline-flex",
    ),
  );
  assert.equal(dom.window.getComputedStyle(row).width, "100%");
  assert.equal(
    dom.window.getComputedStyle(row).gridTemplateColumns,
    "18px 22px minmax(0, 1fr)",
  );
  assert.equal(dom.window.getComputedStyle(checkbox).gridColumn, "1");
  assert.equal(dom.window.getComputedStyle(ordinal).gridColumn, "2");
  assert.equal(dom.window.getComputedStyle(main).gridColumn, "3");
  assert.equal(dom.window.getComputedStyle(title).overflowWrap, "break-word");
  assert.equal(dom.window.getComputedStyle(title).wordBreak, "normal");
  const downloadButton = body.querySelector(
    "[data-download-selected]",
  ) as HTMLButtonElement;
  assert.equal(downloadButton.disabled, false);
  downloadButton.click();
  assert.equal(downloadAttempts, 1);
  mounted.destroy();
});

test("Reader does not project the unavailable institution candidate as support", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const body = dom.window.document.body;
  const state: ReaderSectionState = {
    ...readyState(),
  };
  const mounted = mountReaderSection({
    body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  assert.doesNotMatch(
    body.textContent ?? "",
    /WebVPN|IEEE|institution|candidate|supported|available ✓/iu,
  );
  mounted.destroy();
});

test("an unavailable Paper Translate capability is explicit without calling translate", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let translationCalls = 0;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      translationCapability: () => ({
        available: false,
        reason: "incompatible-version",
      }),
      async translateSelection() {
        translationCalls += 1;
        return "unreachable";
      },
    },
  });
  const title = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  assert.ok(title);
  selectNodeContents(dom, title);
  title.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(translationCalls, 0);
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "UI translation unavailable: incompatible-version",
  );
  mounted.destroy();
});

test("status and error copy stay outside the academic translation scope", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let translationCalls = 0;
  const state: ReaderSectionState = {
    ...readyState(),
    references: [
      {
        id: "failed",
        ordinal: 0,
        title: "Visible paper title",
        status: "failed",
        statusText: "C:\\private\\diagnostics.log",
      },
    ],
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      async translateSelection() {
        translationCalls += 1;
        return "unreachable";
      },
    },
  });
  const status = dom.window.document.querySelector(".rfz-paper-status");
  assert.ok(status);
  selectNodeContents(dom, status);
  status.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(translationCalls, 0);
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]"),
    null,
  );
  mounted.destroy();
});

test("a newer academic selection invalidates an older translation result", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const pending: Array<(value: string) => void> = [];
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      translateSelection: () =>
        new Promise<string>((resolve) => pending.push(resolve)),
    },
  });
  const firstTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  const secondTitle = dom.window.document.querySelector(
    '[data-paper-id="ref-2"] [data-paper-title]',
  );
  assert.ok(firstTitle);
  assert.ok(secondTitle);
  selectNodeContents(dom, firstTitle);
  firstTitle.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  selectNodeContents(dom, secondTitle);
  secondTitle.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );

  pending[1]?.("new result");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "new result",
  );
  pending[0]?.("stale result");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "new result",
  );
  mounted.destroy();
});

test("destroying the section prevents a late translation UI commit", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let resolveTranslation: ((value: string) => void) | undefined;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      ...downloadControllerStubs(),
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      performPaperAction() {},
      translateSelection: () =>
        new Promise<string>((resolve) => {
          resolveTranslation = resolve;
        }),
    },
  });
  const title = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  assert.ok(title);
  selectNodeContents(dom, title);
  title.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  mounted.destroy();
  resolveTranslation?.("late result");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    dom.window.document.querySelector("[data-translation-result]"),
    null,
  );
});

function selectNodeContents(dom: JSDOM, node: Node): Range {
  const range = dom.window.document.createRange();
  range.selectNodeContents(node);
  const selection = dom.window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

function domRect(options: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    ...options,
    x: options.left,
    y: options.top,
    right: options.left + options.width,
    bottom: options.top + options.height,
    toJSON: () => ({}),
  };
}
