import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  mountReaderSection,
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
  const dom = new JSDOM("<!doctype html><body></body>");
  let state: ReaderSectionState = {
    ...readyState(),
    activeTab: "citations",
    citingPapers: Array.from({ length: 35 }, (_, index) => ({
      id: `citing-${index + 1}`,
      ordinal: index,
      title: `Citing paper ${index + 1}`,
      authors: `Author ${index + 1}`,
      venue: "Journal",
      year: String(2026 - Math.floor(index / 5)),
      status: index === 1 ? "unresolved" : "resolved",
      primaryResultURL:
        index === 1 ? undefined : `https://example.test/citing-${index + 1}`,
      doi: index === 0 ? "10.1000/example" : undefined,
      abstract: index === 0 ? "A useful abstract." : undefined,
      citationCount: index === 0 ? 12 : undefined,
      referenceCount: index === 0 ? 34 : undefined,
    })),
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
      state = { ...state, selectedPaperID: paperID };
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
    body: dom.window.document.body,
    controller,
  });

  assert.equal(
    dom.window.document.querySelectorAll("[data-paper-id]").length,
    10,
  );
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
  assert.deepEqual(
    [...detailCard.querySelectorAll(".rfz-badges span")].map(
      (badge) => badge.textContent,
    ),
    ["12 citations", "34 references", "DOI: 10.1000/example"],
  );
  assert.match(detailCard.textContent ?? "", /A useful abstract\./);

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
    "open:citing-1",
    "refresh",
  ]);

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
  const title = dom.window.document.querySelector(
    '[data-paper-id="ref-1"] [data-paper-title]',
  );
  assert.ok(title?.firstChild);
  const range = dom.window.document.createRange();
  range.selectNodeContents(title);
  const selection = dom.window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  title.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(translated, ["First reference"]);
  assert.equal(
    dom.window.document.querySelector("[data-translation-result]")?.textContent,
    "第一篇参考文献",
  );
  mounted.destroy();
});
