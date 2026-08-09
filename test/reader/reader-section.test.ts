import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

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
    references: [
      {
        id: "ref-1",
        ordinal: 0,
        title: "First reference",
        authors: "Alpha",
        year: "2024",
        doi: "10.1000/first",
        status: "resolved",
        primaryResultURL: "https://example.test/first",
        matchedBy: "doi",
      },
      {
        id: "ref-2",
        ordinal: 1,
        title: "Second reference",
        authors: "Beta",
        year: "2023",
        status: "unresolved",
      },
    ],
    citingPapers: [],
    citingPaperLimit: 10,
    citingPapersLoaded: 10,
    downloadSelection: [],
    paperDownloads: [],
    downloadInProgress: false,
    downloadAvailable: true,
  };
}

function downloadControllerStubs(): Pick<
  ReaderSectionController,
  | "setPaperDownloadSelected"
  | "setTabDownloadSelected"
  | "downloadSelected"
  | "openDownloadedFolder"
> {
  return {
    setPaperDownloadSelected() {},
    setTabDownloadSelected() {},
    async downloadSelected() {},
    openDownloadedFolder() {},
  };
}

test("Reader section mounts XHTML content inside Zotero's XUL document", () => {
  const dom = new JSDOM(
    '<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"><html:div xmlns:html="http://www.w3.org/1999/xhtml"/></window>',
    { contentType: "application/xml" },
  );
  const body = dom.window.document.getElementsByTagNameNS(
    "http://www.w3.org/1999/xhtml",
    "div",
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

  const root = body.firstElementChild;
  assert.ok(root);
  assert.equal(root.namespaceURI, "http://www.w3.org/1999/xhtml");
  assert.match(root.textContent ?? "", /Related Papers/);
  const titles = [...root.querySelectorAll("[data-paper-title]")];
  assert.deepEqual(
    titles.map(({ tagName, textContent }) => [tagName, textContent]),
    [
      ["div", "First reference"],
      ["div", "Second reference"],
    ],
  );
  assert.ok(
    [...root.querySelectorAll("input")].every(
      (input) => input.namespaceURI === "http://www.w3.org/1999/xhtml",
    ),
  );
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
  ) as HTMLInputElement | null;
  const unresolvedCheckbox = dom.window.document.querySelector(
    '[data-paper-id="ref-2"] [data-select-paper]',
  ) as HTMLInputElement | null;
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
  ) as HTMLInputElement | null;
  assert.ok(replacement?.checked);
  assert.equal(dom.window.document.activeElement, replacement);
  assert.equal(
    (dom.window.document.querySelector("[data-select-tab]") as HTMLInputElement)
      .indeterminate,
    true,
  );
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
  const firstRow = dom.window.document.querySelector('[data-paper-id="ref-1"]');
  assert.ok(firstRow);

  const openMenu = (): HTMLElement => {
    firstRow.dispatchEvent(
      new dom.window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 80,
      }),
    );
    const menu = dom.window.document.querySelector(
      "[data-paper-context-menu]",
    ) as HTMLElement | null;
    assert.ok(menu);
    assert.ok(menu.classList.contains("is-open"));
    return menu;
  };

  assert.deepEqual(
    [...openMenu().querySelectorAll("[data-paper-action]")].map(
      ({ tagName, textContent }) => [tagName, textContent],
    ),
    [
      ["div", "Copy paper title"],
      ["div", "Copy DOI"],
      ["div", "Search with Google"],
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

  const secondRow = dom.window.document.querySelector(
    '[data-paper-id="ref-2"]',
  );
  assert.ok(secondRow);
  secondRow.dispatchEvent(
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

test("Reader section closes an open detail card when clicking elsewhere", () => {
  const dom = new JSDOM(
    '<window xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"><html:section xmlns:html="http://www.w3.org/1999/xhtml"/></window>',
    { contentType: "application/xml" },
  );
  const body = dom.window.document.getElementsByTagNameNS(
    "http://www.w3.org/1999/xhtml",
    "section",
  )[0] as HTMLElement;
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
  const styles = body.querySelector("style")?.textContent ?? "";
  assert.match(
    styles,
    /\.rfz-overlay\.is-open\s*\{[^}]*pointer-events:\s*auto/u,
  );

  detailCard.click();
  assert.ok(dom.window.document.querySelector("[data-detail-card]"));

  overlay.click();
  assert.equal(dom.window.document.querySelector("[data-detail-card]"), null);
  assert.ok(!overlay.classList.contains("is-open"));
  assert.deepEqual(selections, ["ref-1", "ref-1"]);

  mounted.destroy();
});

test("only Resolved references and Citing papers open a detail card", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let state: ReaderSectionState = readyState();
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
        state = { ...state, selectedPaperID: paperID };
        listener?.(state);
      },
      refresh() {},
      openPaper() {},
      performPaperAction() {},
    },
  });

  (
    dom.window.document.querySelector(
      '[data-paper-id="ref-2"] [data-paper-title]',
    ) as HTMLButtonElement
  ).click();

  assert.equal(dom.window.document.querySelector("[data-detail-card]"), null);
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
    selectPaper() {},
    refresh() {},
    openPaper() {},
    performPaperAction() {},
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
  selectNodeContents(dom, abstract);

  abstract.dispatchEvent(
    new dom.window.MouseEvent("mouseup", { bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const translation = dom.window.document.querySelector("[data-translation]");
  assert.ok(translation);
  assert.equal(translation.parentElement, overlay);
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

test("a translation failure ends only that request and the next selection can retry", async () => {
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

test("Reader download area exposes destination, confirmed runtime installation, and a disabled institution policy", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const body = dom.window.document.body;
  const state: ReaderSectionState = {
    ...readyState(),
    downloadSetup: {
      downloadDestination: "E:\\paper",
      usingDefaultDestination: true,
      runtime: {
        status: "needs-install",
        candidates: [],
        plan: {
          baseExecutable: "C:\\Python312\\python.exe",
          privateEnvironment: "C:\\profile\\rfz\\venv",
          packageIndex: "https://pypi.tuna.tsinghua.edu.cn/simple",
          requirementsLock: "C:\\addon\\requirements.lock",
          dependencies: [],
          packages: [
            {
              name: "requests",
              version: "2.34.2",
              sha256: ["a".repeat(64)],
            },
          ],
          actions: ["Create private venv", "Install complete hash lock"],
          cancelResult: "No environment is created or changed",
        },
      },
      institutionLogin: {
        status: "disabled",
        policy: {
          routeID: "institution-browser",
          status: "disabled-pending-acceptance",
          vendor: "CloakBrowser",
          source: "Unresolved accepted vendor artifact URL",
          approximateDownloadBytes: 209_715_200,
          binaryLicense: "Unresolved binary license",
          target: "<private-runtime>/cloakbrowser/chromium",
          signatureVerification: "Unresolved signature verification",
        },
      },
    },
  };
  let changeDestination = 0;
  let install = 0;
  let cancel = 0;
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
      async changeDownloadDestination() {
        changeDestination += 1;
      },
      async installDownloadRuntime() {
        install += 1;
      },
      cancelDownloadRuntimeInstallation() {
        cancel += 1;
      },
    },
  });

  assert.equal(
    body.querySelector("[data-download-destination]")?.textContent,
    "E:\\paper",
  );
  assert.match(body.textContent ?? "", /requests==2\.34\.2/u);
  assert.match(
    body.textContent ?? "",
    /https:\/\/pypi\.tuna\.tsinghua\.edu\.cn\/simple/u,
  );
  assert.match(body.textContent ?? "", /About 200 MiB/u);
  const institutionButton = body.querySelector(
    '[aria-label="Institution login unavailable"]',
  ) as HTMLButtonElement | null;
  assert.equal(institutionButton?.disabled, true);

  (body.querySelector("[data-change-destination]") as HTMLElement)?.click();
  (body.querySelector("[data-install-runtime]") as HTMLElement)?.click();
  (body.querySelector("[data-cancel-runtime]") as HTMLElement)?.click();
  assert.equal(changeDestination, 1);
  assert.equal(install, 1);
  assert.equal(cancel, 1);
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

function selectNodeContents(dom: JSDOM, node: Node): void {
  const range = dom.window.document.createRange();
  range.selectNodeContents(node);
  const selection = dom.window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
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
