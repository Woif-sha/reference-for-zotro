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
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPrimaryResult() {},
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
  mounted.destroy();
});

test("Reader section renders Reference entries in source order and selects Citations through its controller", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const actions: string[] = [];
  let listener: ((state: ReaderSectionState) => void) | undefined;
  const controller: ReaderSectionController = {
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
    openPrimaryResult() {},
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
  ) as HTMLButtonElement | null;
  assert.ok(citationsTab);
  citationsTab.click();
  assert.deepEqual(actions, ["tab:citations"]);

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
    openPrimaryResult(paperID) {
      actions.push(`open:${paperID}`);
    },
  };

  const mounted = mountReaderSection({
    body: dom.window.document.querySelector("#reader-section") as HTMLElement,
    controller,
  });

  assert.equal(
    dom.window.document.querySelectorAll("[data-paper-id]").length,
    10,
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
    "select:citing-1",
    "select:citing-1",
    "open:citing-1",
    "refresh",
  ]);

  mounted.destroy();
});

test("Reader section opens only a confirmed reachable title on Ctrl+left-click", () => {
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
    getState: () => state,
    subscribe: () => () => {},
    selectTab() {},
    setCitationLimit() {},
    selectPaper: (paperID) => actions.push(`select:${paperID}`),
    refresh() {},
    openPrimaryResult: (paperID) => actions.push(`open:${paperID}`),
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

  assert.deepEqual(actions, ["open:reachable"]);
  mounted.destroy();
});

test("only Resolved references and Citing papers open a detail card", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  let state: ReaderSectionState = readyState();
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
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
      openPrimaryResult() {},
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

test("Reader section distinguishes invalid identifiers from unreachable landing pages", () => {
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
      getState: () => state,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPrimaryResult() {},
    },
  });

  assert.deepEqual(
    [...dom.window.document.querySelectorAll(".rfz-paper-status")].map(
      (status) => status.textContent,
    ),
    ["Invalid identifier", "Landing page unreachable"],
  );
  mounted.destroy();
});

test("Reader section translates only text selected inside the extension UI", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  const translated: string[] = [];
  const controller: ReaderSectionController = {
    getState: readyState,
    subscribe: () => () => {},
    selectTab() {},
    setCitationLimit() {},
    selectPaper() {},
    refresh() {},
    openPrimaryResult() {},
    async translateSelection(text) {
      translated.push(text);
      return "第一篇参考文献";
    },
  };
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller,
  });
  const sectionHeading =
    dom.window.document.querySelector(".rfz-header strong");
  assert.ok(sectionHeading);
  selectNodeContents(dom, sectionHeading);
  sectionHeading.dispatchEvent(
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

test("a translation failure disables only UI translation for the mounted section", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    pretendToBeVisual: true,
  });
  let translationCalls = 0;
  const mounted = mountReaderSection({
    body: dom.window.document.body,
    controller: {
      getState: readyState,
      subscribe: () => () => {},
      selectTab() {},
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPrimaryResult() {},
      async translateSelection() {
        translationCalls += 1;
        throw new Error("Paper Translate service unavailable");
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

  assert.equal(translationCalls, 1);
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "UI translation disabled",
  );
  mounted.destroy();
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
