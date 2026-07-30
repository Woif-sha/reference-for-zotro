import type { ReferenceMatchBasis } from "../domain/literature";

export type ReaderTab = "references" | "citations";
export type ReaderStatus = "loading" | "ready" | "error" | "no-md";
export type PaperStatus =
  | "matching"
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "invalid-identifier"
  | "unreachable"
  | "failed";
type ReaderPaperBase = {
  id: string;
  ordinal: number;
  title: string;
  authors?: string;
  venue?: string;
  year?: string;
  statusText?: string;
  doi?: string;
  abstract?: string;
  citationCount?: number;
  referenceCount?: number;
  source?: string;
  sourceRecordID?: string;
  retrievedAt?: string;
  matchedFields?: readonly string[];
  rawProvenance?: readonly string[];
  metadataIncomplete?: boolean;
  providerFailures?: readonly string[];
  connectedPaperInfo?: string;
};

export type ReaderPaper = ReaderPaperBase &
  (
    | {
        status: "resolved";
        primaryResultURL: string;
        matchedBy?: ReferenceMatchBasis;
      }
    | {
        status: Exclude<PaperStatus, "resolved">;
        primaryResultURL?: never;
        matchedBy?: never;
      }
  );

export function canOpenPrimaryResult(
  paper: ReaderPaper | undefined,
): paper is ReaderPaper & { status: "resolved" } {
  return paper?.status === "resolved" && paper.primaryResultURL.length > 0;
}

export interface ReaderSectionState {
  activeTab: ReaderTab;
  status: ReaderStatus;
  message?: string;
  references: readonly ReaderPaper[];
  citingPapers: readonly ReaderPaper[];
  citingPaperLimit: 10 | 30 | 50;
  citingPapersLoaded: number;
  selectedPaperID?: string;
}

export interface ReaderSectionController {
  getState(): ReaderSectionState;
  subscribe(listener: (state: ReaderSectionState) => void): () => void;
  selectTab(tab: ReaderTab): void;
  setCitationLimit(limit: 10 | 30 | 50): void;
  selectPaper(paperID: string): void;
  refresh(): void;
  openPrimaryResult(paperID: string): void;
  translateSelection?(text: string): Promise<string>;
}

export interface MountedReaderSection {
  destroy(): void;
}

export function mountReaderSection(options: {
  body: HTMLElement;
  controller: ReaderSectionController;
}): MountedReaderSection {
  const { body, controller } = options;
  const root = body.ownerDocument.createElement("div");
  root.className = "reference-for-zotero";
  body.replaceChildren(root);
  let destroyed = false;
  let translationRequest = 0;
  let translationEnabled = Boolean(controller.translateSelection);

  function render(state: ReaderSectionState): void {
    const papers =
      state.activeTab === "references"
        ? state.references
        : state.citingPapers.slice(
            0,
            Math.min(state.citingPaperLimit, state.citingPapers.length),
          );
    root.innerHTML = `
      <style>${READER_STYLES}</style>
      <header class="rfz-header">
        <div>
          <strong>Related Papers</strong>
          <small>${state.activeTab === "references" ? "MinerU Markdown" : "Scholarly sources"}</small>
        </div>
        <button type="button" class="rfz-icon-button" data-refresh aria-label="Refresh current paper">↻</button>
      </header>
      <nav class="rfz-tabs" aria-label="Paper relationship">
        <button type="button" data-tab="references" aria-pressed="${state.activeTab === "references"}">References <span>${state.references.length}</span></button>
        <button type="button" data-tab="citations" aria-pressed="${state.activeTab === "citations"}">Citations <span>${state.citingPapers.length}</span></button>
      </nav>
      ${
        state.activeTab === "citations"
          ? `<div class="rfz-limits" aria-label="Visible Citing papers">
              ${([10, 30, 50] as const)
                .map(
                  (limit) =>
                    `<button type="button" data-limit="${limit}" aria-pressed="${state.citingPaperLimit === limit}">${limit}</button>`,
                )
                .join("")}
            </div>`
          : ""
      }
      <main class="rfz-content" data-translation-scope>
        ${renderContent(state, papers)}
      </main>
      ${renderDetailCard(state, papers)}`;
  }

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Element)) return;
    if (target.closest("[data-refresh]")) {
      controller.refresh();
      return;
    }
    const tab = target.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (tab === "references" || tab === "citations") {
      controller.selectTab(tab);
      return;
    }
    const limit = Number(
      target.closest<HTMLElement>("[data-limit]")?.dataset.limit,
    );
    if (limit === 10 || limit === 30 || limit === 50) {
      controller.setCitationLimit(limit);
      return;
    }
    const title = target.closest<HTMLElement>("[data-paper-title]");
    if (!title) return;
    const paperID =
      title.closest<HTMLElement>("[data-paper-id]")?.dataset.paperId;
    if (!paperID) return;
    const state = controller.getState();
    const paper = [...state.references, ...state.citingPapers].find(
      (candidate) => candidate.id === paperID,
    );
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
      if (
        mouseEvent.ctrlKey &&
        mouseEvent.button === 0 &&
        canOpenPrimaryResult(paper)
      ) {
        controller.openPrimaryResult(paperID);
      }
      return;
    }
    controller.selectPaper(paperID);
  };

  root.addEventListener("click", onClick);
  const onMouseUp = (): void => {
    const selection = body.ownerDocument.defaultView?.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text || selection.rangeCount === 0) return;
    const commonNode = selection.getRangeAt(0).commonAncestorContainer;
    const commonElement =
      commonNode.nodeType === commonNode.TEXT_NODE
        ? commonNode.parentElement
        : commonNode;
    if (!(commonElement instanceof body.ownerDocument.defaultView!.Element)) {
      return;
    }
    const translationScope = commonElement.closest("[data-translation-scope]");
    if (!translationScope || !root.contains(translationScope)) return;
    const request = ++translationRequest;
    if (!translationEnabled || !controller.translateSelection) {
      showTranslation(root, text, "UI translation disabled");
      return;
    }
    showTranslation(root, text, "Translating…");
    void controller
      .translateSelection(text)
      .then((result) => {
        if (destroyed || request !== translationRequest) return;
        showTranslation(root, text, result);
      })
      .catch((error: unknown) => {
        if (destroyed || request !== translationRequest) return;
        translationEnabled = false;
        showTranslation(
          root,
          text,
          error instanceof Error ? error.message : "UI translation unavailable",
        );
      });
  };
  root.addEventListener("mouseup", onMouseUp);
  render(controller.getState());
  const unsubscribe = controller.subscribe(render);

  return {
    destroy() {
      destroyed = true;
      translationRequest += 1;
      unsubscribe();
      root.removeEventListener("click", onClick);
      root.removeEventListener("mouseup", onMouseUp);
      root.remove();
    },
  };
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHTML(value);
}

function renderContent(
  state: ReaderSectionState,
  papers: readonly ReaderPaper[],
): string {
  if (state.status !== "ready") {
    const content = {
      loading: [
        "Loading related literature",
        "Reference entries appear before matching completes.",
      ],
      error: [
        "Related literature unavailable",
        state.message ??
          "The request failed. Refresh to try the current paper again.",
      ],
      "no-md": [
        "No MinerU Markdown",
        state.message ??
          "Configure the llm-for-zotero MinerU API and generate Markdown for this paper.",
      ],
    }[state.status];
    if (!content) return "";
    return `<section class="rfz-status" role="${state.status === "error" ? "alert" : "status"}">
      <strong>${escapeHTML(content[0])}</strong>
      <p>${escapeHTML(content[1])}</p>
    </section>`;
  }

  if (papers.length === 0) {
    return `<section class="rfz-status"><strong>No results</strong><p>${escapeHTML(
      state.message ?? "No papers are available for the current view.",
    )}</p></section>`;
  }

  return `<ol class="rfz-paper-list">
    ${papers
      .map((paper) => {
        const status =
          paper.status === "resolved"
            ? ""
            : `<span class="rfz-paper-status">${escapeHTML(
                paper.statusText ?? statusLabel(paper.status),
              )}</span>`;
        const provenance = renderPaperProvenance(paper);
        return `<li class="rfz-paper rfz-paper--${paper.status}${
          state.selectedPaperID === paper.id ? " is-selected" : ""
        }" data-paper-id="${escapeAttribute(paper.id)}">
          <span class="rfz-ordinal">${paper.ordinal + 1}.</span><div>
            <button type="button" class="rfz-paper-title" data-paper-title>${escapeHTML(
              paper.title,
            )}</button><small>${escapeHTML(
              [paper.authors, paper.venue, paper.year]
                .filter(Boolean)
                .join(" · "),
            )}</small>${provenance}${status}
          </div>
        </li>`;
      })
      .join("")}
  </ol>`;
}

function renderDetailCard(
  state: ReaderSectionState,
  papers: readonly ReaderPaper[],
): string {
  const paper = papers.find(
    (candidate) => candidate.id === state.selectedPaperID,
  );
  if (!paper || paper.status !== "resolved") return "";
  const badges = [
    paper.citationCount === undefined
      ? undefined
      : `${paper.citationCount} citations`,
    paper.referenceCount === undefined
      ? undefined
      : `${paper.referenceCount} references`,
    paper.connectedPaperInfo,
    paper.doi ? `DOI: ${paper.doi}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return `<aside class="rfz-detail-card" data-detail-card data-translation-scope>
    <strong>${escapeHTML(paper.title)}</strong>
    ${badges.length ? `<div class="rfz-badges">${badges.map((badge) => `<span>${escapeHTML(badge)}</span>`).join("")}</div>` : ""}
    ${paper.authors ? `<div>${escapeHTML(paper.authors)}</div>` : ""}
    ${
      paper.venue || paper.year
        ? `<div>${escapeHTML([paper.venue, paper.year].filter(Boolean).join(" · "))}</div>`
        : ""
    }
    ${
      paper.abstract
        ? `<div class="rfz-abstract"><b>Abstract</b> ${escapeHTML(paper.abstract)}</div>`
        : ""
    }
  </aside>`;
}

function renderPaperProvenance(paper: ReaderPaper): string {
  const matchedBy =
    paper.matchedBy !== undefined
      ? matchedByLabel(paper.matchedBy)
      : paper.matchedFields?.join(", ");
  const parts = [
    paper.source ? `Source: ${paper.source}` : undefined,
    matchedBy ? `Matched by: ${matchedBy}` : undefined,
    paper.providerFailures?.length
      ? `Provider failures: ${paper.providerFailures.join("; ")}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
  return parts.length
    ? `<small class="rfz-provenance">${escapeHTML(parts.join(" · "))}</small>`
    : "";
}

function matchedByLabel(matchedBy: ReferenceMatchBasis): string {
  return {
    doi: "DOI",
    arxiv: "arXiv",
    "ieee-article-number": "IEEE article number",
    "trusted-source-url": "trusted source URL",
    pmid: "PMID",
    pmcid: "PMCID",
    omid: "OMID",
    metadata: "title, author, and year",
  }[matchedBy];
}

function statusLabel(status: Exclude<PaperStatus, "resolved">): string {
  return {
    matching: "Matching",
    unresolved: "Unresolved",
    ambiguous: "Ambiguous",
    "invalid-identifier": "Invalid identifier",
    unreachable: "Landing page unreachable",
    failed: "Failed",
  }[status];
}

function showTranslation(
  root: HTMLElement,
  source: string,
  result: string,
): void {
  root.querySelector("[data-translation]")?.remove();
  const popover = root.ownerDocument.createElement("aside");
  popover.className = "rfz-translation";
  popover.dataset.translation = "";
  const original = root.ownerDocument.createElement("div");
  original.className = "rfz-translation-source";
  original.textContent = source;
  const translated = root.ownerDocument.createElement("div");
  translated.dataset.translationResult = "";
  translated.textContent = result;
  popover.append(original, translated);
  root.append(popover);
}

const READER_STYLES = `
  .reference-for-zotero {
    --rfz-accent: #2d6cdf;
    --rfz-accent-soft: color-mix(in srgb, var(--rfz-accent) 12%, transparent);
    position: relative;
    height: 100%;
    color: var(--fill-primary, #242428);
    background: var(--material-sidepane, #fff);
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .reference-for-zotero * { box-sizing: border-box; }
  .rfz-header, .rfz-tabs, .rfz-limits { display: flex; align-items: center; }
  .rfz-header { justify-content: space-between; padding: 10px 12px 8px; }
  .rfz-header small { display: block; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
  .rfz-icon-button, .rfz-tabs button, .rfz-limits button, .rfz-paper-title {
    border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer;
  }
  .rfz-icon-button { padding: 4px 8px; border-radius: 5px; font-size: 17px; }
  .rfz-tabs { border-block: 1px solid var(--material-border, #d6d6d9); }
  .rfz-tabs button { flex: 1; padding: 8px 4px; border-bottom: 2px solid transparent; }
  .rfz-tabs button[aria-pressed="true"] { border-bottom-color: var(--rfz-accent); color: var(--rfz-accent); font-weight: 700; }
  .rfz-tabs span { padding: 1px 5px; border-radius: 8px; background: var(--material-button, #ececef); font-size: 10px; }
  .rfz-limits { justify-content: flex-end; gap: 2px; padding: 5px 8px; border-bottom: 1px solid var(--material-border, #e4e4e7); }
  .rfz-limits button { min-width: 30px; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  .rfz-limits button[aria-pressed="true"] { color: #fff; background: var(--rfz-accent); }
  .rfz-content { overflow: auto; max-height: calc(100% - 90px); }
  .rfz-paper-list { margin: 0; padding: 0; list-style: none; }
  .rfz-paper { display: grid; grid-template-columns: 28px 1fr; gap: 5px; padding: 9px 8px; border-bottom: 1px solid var(--material-border, #ececef); }
  .rfz-paper.is-selected { background: var(--rfz-accent-soft); }
  .rfz-ordinal { color: var(--fill-secondary, #85858b); text-align: right; font-size: 11px; }
  .rfz-paper-title { display: block; padding: 0; text-align: left; font-weight: 600; line-height: 1.35; }
  .rfz-paper--resolved .rfz-paper-title { color: var(--rfz-accent); font-weight: 700; }
  .rfz-paper small, .rfz-paper-status { display: block; margin-top: 2px; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
  .rfz-paper-status { color: #8a5d0b; }
  .rfz-paper--failed .rfz-paper-status { color: #ba3b32; }
  .rfz-status { padding: 36px 18px; text-align: center; }
  .rfz-status p { color: var(--fill-secondary, #6a6a70); }
  .rfz-detail-card { position: absolute; z-index: 10; top: 42px; right: 100%; width: min(680px, 65vw); max-height: calc(100% - 70px); padding: 16px 18px; border: 1px solid var(--material-border, #aaaeb5); border-radius: 8px 0 0 8px; background: var(--material-sidepane, #fff); box-shadow: -8px 12px 28px #0003; overflow: auto; user-select: text; }
  .rfz-detail-card > strong { color: var(--rfz-accent); font-size: 18px; }
  .rfz-badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
  .rfz-badges span { padding: 2px 9px; border-radius: 999px; color: #fff; background: #2d9fa1; font-size: 11px; }
  .rfz-abstract { margin-top: 9px; line-height: 1.55; }
  .rfz-translation { position: absolute; z-index: 20; right: 10px; bottom: 10px; width: min(340px, calc(100% - 20px)); padding: 10px 12px; border: 1px solid var(--material-border, #aaaeb5); border-radius: 7px; background: var(--material-sidepane, #fff); box-shadow: 0 8px 24px #0003; user-select: text; }
  .rfz-translation-source { margin-bottom: 5px; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
`;
