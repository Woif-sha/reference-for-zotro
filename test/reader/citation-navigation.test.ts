import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  citationNumberAtOffset,
  citationNumberAtPoint,
  referenceForCitationNumber,
} from "../../src/reader/citation-navigation";
import {
  mountReaderSection,
  type ReaderPaper,
  type ReaderSectionState,
} from "../../src/reader/mountReaderSection";

test("citation marker parsing selects the number nearest the pointer offset", () => {
  const text = "Prior work [3, 5–7] established the result.";

  assert.equal(citationNumberAtOffset(text, text.indexOf("3")), 3);
  assert.equal(citationNumberAtOffset(text, text.indexOf("5")), 5);
  assert.equal(citationNumberAtOffset(text, text.indexOf("7")), 7);
  assert.equal(citationNumberAtOffset("参见［12，15］", 4), 12);
  assert.equal(
    citationNumberAtOffset("Section 12 has no marker", 8),
    undefined,
  );
});

test("citation hit testing joins split PDF text-layer spans", () => {
  const dom = new JSDOM(
    '<!doctype html><body><div class="textLayer"><span>[</span><span>3, </span><span>5</span><span>]</span></div></body>',
  );
  const spans = [...dom.window.document.querySelectorAll("span")];
  spans.forEach((span, index) => {
    Object.defineProperty(span, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 20, left: index * 20 }),
    });
  });
  const target = spans[2]?.firstChild;
  assert.ok(target);
  Object.defineProperty(dom.window.document, "caretPositionFromPoint", {
    value: () => ({ offsetNode: target, offset: 1 }),
  });

  assert.equal(citationNumberAtPoint(dom.window.document, 45, 10), 5);
});

test("explicit MinerU source labels take precedence over list position", () => {
  const references = referencePapers();

  assert.equal(referenceForCitationNumber(references, 5)?.id, "ref-2");
  assert.equal(referenceForCitationNumber(references, 1)?.id, "ref-1");
  assert.equal(referenceForCitationNumber(references, 2), undefined);
  assert.equal(referenceForCitationNumber(references, 99), undefined);
  assert.equal(
    referenceForCitationNumber(
      [{ ...references[1]!, sourceLabel: undefined }],
      2,
    )?.id,
    "ref-2",
  );
});

test("Ctrl+right-click reveals and highlights the matching Reference entry", async () => {
  const host = new JSDOM(`<!doctype html><body>
    <context-pane>
      <item-details>
        <item-pane-custom-section data-pane="reference-for-zotero-related-papers">
          <section id="mount"></section>
        </item-pane-custom-section>
      </item-details>
    </context-pane>
  </body>`);
  const paper = new JSDOM(
    '<!doctype html><body><div class="textLayer"><span>[5]</span><span>[99]</span></div></body>',
  );
  const citationSpans = paper.window.document.querySelectorAll("span");
  const citationText = citationSpans[0]?.firstChild;
  const unknownCitationText = citationSpans[1]?.firstChild;
  assert.ok(citationText);
  assert.ok(unknownCitationText);
  let caretText = citationText;
  Object.defineProperty(paper.window.document, "caretPositionFromPoint", {
    value: () => ({ offsetNode: caretText, offset: 2 }),
  });
  const contextPane = host.window.document.querySelector("context-pane") as
    (HTMLElement & { collapsed: boolean }) | null;
  const itemDetails = host.window.document.querySelector("item-details") as
    | (HTMLElement & {
        scrollToPane(paneID: string, behavior: string): Promise<void>;
      })
    | null;
  const section = host.window.document.querySelector(
    "item-pane-custom-section",
  ) as (HTMLElement & { open: boolean }) | null;
  const body = host.window.document.querySelector("#mount") as HTMLElement;
  assert.ok(contextPane);
  assert.ok(itemDetails);
  assert.ok(section);
  contextPane.collapsed = true;
  section.open = false;
  const paneScrolls: Array<[string, string]> = [];
  itemDetails.scrollToPane = async (paneID, behavior) => {
    paneScrolls.push([paneID, behavior]);
  };
  let state = readerState("citations");
  let listener: ((next: ReaderSectionState) => void) | undefined;
  const mounted = mountReaderSection({
    body,
    controller: {
      getState: () => state,
      subscribe(next) {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      selectTab(tab) {
        state = { ...state, activeTab: tab, selectedPaperID: undefined };
        listener?.(state);
      },
      setCitationLimit() {},
      selectPaper() {},
      refresh() {},
      openPaper() {},
      openReferenceURL() {},
      performPaperAction() {},
      setPaperDownloadSelected() {},
      setTabDownloadSelected() {},
      async downloadSelected() {},
      openDownloadedFolder() {},
      externalInteractionDocuments: () => [paper.window.document],
    },
  });

  caretText = unknownCitationText;
  const unknownJump = new paper.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    ctrlKey: true,
  });
  unknownCitationText.parentElement?.dispatchEvent(unknownJump);
  assert.equal(unknownJump.defaultPrevented, false);

  caretText = citationText;
  const ordinaryMenu = new paper.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  citationText.parentElement?.dispatchEvent(ordinaryMenu);
  assert.equal(ordinaryMenu.defaultPrevented, false);

  const jump = new paper.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    ctrlKey: true,
  });
  citationText.parentElement?.dispatchEvent(jump);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(jump.defaultPrevented, true);
  assert.equal(state.activeTab, "references");
  assert.equal(contextPane.collapsed, false);
  assert.equal(section.open, true);
  assert.deepEqual(paneScrolls, [
    ["reference-for-zotero-related-papers", "instant"],
  ]);
  assert.ok(
    body
      .querySelector('[data-paper-id="ref-2"]')
      ?.classList.contains("is-reference-jump-target"),
  );
  assert.equal(body.querySelector("[data-detail-card]"), null);

  mounted.destroy();
  const afterDestroy = new paper.window.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
    ctrlKey: true,
  });
  citationText.parentElement?.dispatchEvent(afterDestroy);
  assert.equal(afterDestroy.defaultPrevented, false);
});

function referencePapers(): readonly ReaderPaper[] {
  return [
    {
      id: "ref-1",
      ordinal: 0,
      sourceLabel: "[1]",
      title: "First reference",
      status: "unresolved",
    },
    {
      id: "ref-2",
      ordinal: 1,
      sourceLabel: "5",
      title: "Fifth reference",
      status: "unresolved",
    },
  ];
}

function readerState(
  activeTab: "references" | "citations",
): ReaderSectionState {
  return {
    activeTab,
    status: "ready",
    references: referencePapers(),
    citingPapers: [],
    citingPaperLimit: 10,
    citingPapersLoaded: 10,
    citingPapersStatus: { status: "ready" },
    downloadSelection: [],
    paperDownloads: [],
    downloadInProgress: false,
    downloadAvailable: false,
  };
}
