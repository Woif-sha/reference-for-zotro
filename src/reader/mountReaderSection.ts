import type { ReferenceMatchBasis } from "../domain/literature";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export type ReaderTab = "references" | "citations";
export type ReaderPaperAction = "copy-title" | "copy-doi" | "google-search";
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
  abstractSource?: string;
  abstractLoading?: boolean;
  abstractError?: string;
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
  openPaper(paperID: string): void;
  performPaperAction(paperID: string, action: ReaderPaperAction): void;
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
  const root = body.ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  root.className = "reference-for-zotero";
  body.replaceChildren(root);
  const overlay = body.ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  overlay.className = "rfz-overlay";
  overlay.dataset.readerOverlay = "";
  body.ownerDocument.documentElement.append(overlay);
  const contextMenu = body.ownerDocument.createElementNS(
    XHTML_NAMESPACE,
    "div",
  );
  contextMenu.className = "rfz-context-menu";
  contextMenu.dataset.paperContextMenu = "";
  contextMenu.setAttribute("role", "menu");
  body.ownerDocument.documentElement.append(contextMenu);
  let destroyed = false;
  let translationRequest = 0;
  let translationEnabled = Boolean(controller.translateSelection);

  const dismissSelectedPaper = (): void => {
    const selectedPaperID = controller.getState().selectedPaperID;
    if (selectedPaperID) controller.selectPaper(selectedPaperID);
  };

  const closeContextMenu = (): void => {
    contextMenu.classList.remove("is-open");
    contextMenu.replaceChildren();
    delete contextMenu.dataset.paperId;
  };

  const openContextMenu = (
    paper: ReaderPaper,
    clientX: number,
    clientY: number,
  ): void => {
    contextMenu.dataset.paperId = paper.id;
    contextMenu.innerHTML = `
      <div class="rfz-context-item" role="menuitem" tabindex="0" data-paper-action="copy-title">Copy paper title</div>
      <div class="rfz-context-item" role="menuitem" tabindex="${paper.doi ? "0" : "-1"}" data-paper-action="copy-doi" aria-disabled="${paper.doi ? "false" : "true"}">Copy DOI</div>
      <div class="rfz-context-item" role="menuitem" tabindex="0" data-paper-action="google-search">Search with Google</div>`;
    contextMenu.classList.add("is-open");
    const view = body.ownerDocument.defaultView;
    const bounds = contextMenu.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(clientX, (view?.innerWidth ?? clientX) - bounds.width - 8),
    );
    const top = Math.max(
      8,
      Math.min(clientY, (view?.innerHeight ?? clientY) - bounds.height - 8),
    );
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu
      .querySelector<HTMLElement>('[data-paper-action="copy-title"]')
      ?.focus();
  };

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
        <strong>Related Papers</strong>
        <small>${state.activeTab === "references" ? "MinerU Markdown" : "Scholarly sources"}</small>
        <button type="button" class="rfz-icon-button" data-refresh="" aria-label="Refresh current paper">↻</button>
      </header>
      <nav class="rfz-tabs" aria-label="Paper relationship">
        <div class="rfz-tab" role="tab" tabindex="0" data-tab="references" aria-selected="${state.activeTab === "references"}">References <span>${state.references.length}</span></div>
        <div class="rfz-tab" role="tab" tabindex="0" data-tab="citations" aria-selected="${state.activeTab === "citations"}">Citations <span>${state.citingPapers.length}</span></div>
      </nav>
      ${
        state.activeTab === "citations"
          ? `<div class="rfz-limits" aria-label="Visible Citing papers">
              ${([10, 30, 50] as const)
                .map(
                  (limit) =>
                    `<div class="rfz-limit" role="button" tabindex="0" data-limit="${limit}" aria-pressed="${state.citingPaperLimit === limit}">${limit}</div>`,
                )
                .join("")}
            </div>`
          : ""
      }
      <main class="rfz-content" data-translation-scope="">
        ${renderContent(state, papers)}
      </main>`;
    const detailCard = renderDetailCard(state, papers);
    overlay.innerHTML = detailCard;
    overlay.classList.toggle("is-open", detailCard.length > 0);
    positionDetailCard(root, overlay);
  }

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Element)) return;
    if (target === overlay) {
      dismissSelectedPaper();
      return;
    }
    if (target.closest("[data-refresh]")) {
      controller.refresh();
      return;
    }
    const close = target.closest<HTMLElement>("[data-detail-close]");
    if (close) {
      dismissSelectedPaper();
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
    const mouseEvent = event as MouseEvent;
    if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
      if (mouseEvent.ctrlKey && mouseEvent.button === 0) {
        controller.openPaper(paperID);
      }
      return;
    }
    controller.selectPaper(paperID);
  };

  root.addEventListener("click", onClick);
  overlay.addEventListener("click", onClick);
  const onContextMenu = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Element)) return;
    const paperID =
      target.closest<HTMLElement>("[data-paper-id]")?.dataset.paperId;
    if (!paperID) {
      closeContextMenu();
      return;
    }
    const state = controller.getState();
    const paper = [...state.references, ...state.citingPapers].find(
      (candidate) => candidate.id === paperID,
    );
    if (!paper) return;
    event.preventDefault();
    openContextMenu(paper, event.clientX, event.clientY);
  };
  root.addEventListener("contextmenu", onContextMenu);
  const onContextMenuAction = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Element)) return;
    const item = target.closest<HTMLElement>("[data-paper-action]");
    if (!item || item.getAttribute("aria-disabled") === "true") return;
    const paperID = contextMenu.dataset.paperId;
    const action = item.dataset.paperAction;
    if (!paperID || !isReaderPaperAction(action)) return;
    controller.performPaperAction(paperID, action);
    closeContextMenu();
  };
  contextMenu.addEventListener("click", onContextMenuAction);
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Element)) return;
    const tab = target.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (tab === "references" || tab === "citations") {
      event.preventDefault();
      controller.selectTab(tab);
      return;
    }
    const limit = Number(
      target.closest<HTMLElement>("[data-limit]")?.dataset.limit,
    );
    if (limit !== 10 && limit !== 30 && limit !== 50) return;
    event.preventDefault();
    controller.setCitationLimit(limit);
  };
  root.addEventListener("keydown", onKeyDown);
  const onContextMenuKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      closeContextMenu();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.HTMLElement)) {
      return;
    }
    if (!target.matches("[data-paper-action]")) return;
    event.preventDefault();
    target.click();
  };
  contextMenu.addEventListener("keydown", onContextMenuKeyDown);
  const onDocumentClick = (event: Event): void => {
    if (!contextMenu.contains(event.target as Node)) closeContextMenu();
  };
  body.ownerDocument.addEventListener("click", onDocumentClick);
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
    if (
      !translationScope ||
      (!root.contains(translationScope) && !overlay.contains(translationScope))
    ) {
      return;
    }
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
  overlay.addEventListener("mouseup", onMouseUp);
  const repositionDetailCard = (): void => positionDetailCard(root, overlay);
  body.ownerDocument.defaultView?.addEventListener(
    "resize",
    repositionDetailCard,
  );
  body.ownerDocument.addEventListener("scroll", repositionDetailCard, true);
  render(controller.getState());
  const unsubscribe = controller.subscribe(render);

  return {
    destroy() {
      destroyed = true;
      translationRequest += 1;
      unsubscribe();
      root.removeEventListener("click", onClick);
      overlay.removeEventListener("click", onClick);
      root.removeEventListener("contextmenu", onContextMenu);
      contextMenu.removeEventListener("click", onContextMenuAction);
      root.removeEventListener("keydown", onKeyDown);
      contextMenu.removeEventListener("keydown", onContextMenuKeyDown);
      body.ownerDocument.removeEventListener("click", onDocumentClick);
      root.removeEventListener("mouseup", onMouseUp);
      overlay.removeEventListener("mouseup", onMouseUp);
      body.ownerDocument.defaultView?.removeEventListener(
        "resize",
        repositionDetailCard,
      );
      body.ownerDocument.removeEventListener(
        "scroll",
        repositionDetailCard,
        true,
      );
      overlay.remove();
      contextMenu.remove();
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
        const metadata = [paper.authors, paper.venue, paper.year]
          .filter(Boolean)
          .join(" · ");
        const status =
          paper.status === "resolved" ||
          paper.status === "unresolved" ||
          paper.status === "ambiguous" ||
          paper.status === "unreachable"
            ? ""
            : `<span class="rfz-paper-status">${escapeHTML(
                paper.statusText ?? statusLabel(paper.status),
              )}</span>`;
        return `<li class="rfz-paper rfz-paper--${paper.status}${
          state.selectedPaperID === paper.id ? " is-selected" : ""
        }" data-paper-id="${escapeAttribute(paper.id)}">
          <span class="rfz-ordinal">${paper.ordinal + 1}.</span><div>
            <div class="rfz-paper-title" data-paper-title="">${escapeHTML(
              paper.title,
            )}</div>${metadata ? `<small>${escapeHTML(metadata)}</small>` : ""}${status}
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
      : { label: `${paper.citationCount} citations`, kind: "count" },
    paper.referenceCount === undefined
      ? undefined
      : { label: `${paper.referenceCount} references`, kind: "count" },
    paper.connectedPaperInfo
      ? { label: paper.connectedPaperInfo, kind: "connected" }
      : undefined,
    paper.doi ? { label: `DOI: ${paper.doi}`, kind: "doi" } : undefined,
  ].filter(
    (value): value is { label: string; kind: string } => value !== undefined,
  );
  return `<aside class="rfz-detail-card" data-detail-card="" data-paper-id="${escapeAttribute(paper.id)}" data-translation-scope="">
    <button type="button" class="rfz-card-close" data-detail-close="" aria-label="Close paper details">×</button>
    <strong class="rfz-card-title">${escapeHTML(paper.title)}</strong>
    ${badges.length ? `<div class="rfz-badges">${badges.map((badge) => `<span class="rfz-badge-${badge.kind}">${escapeHTML(badge.label)}</span>`).join("")}</div>` : ""}
    ${paper.authors ? `<div class="rfz-card-meta">${escapeHTML(paper.authors)}</div>` : ""}
    ${
      paper.venue || paper.year
        ? `<div class="rfz-card-meta">${escapeHTML([paper.venue, paper.year].filter(Boolean).join(" · "))}</div>`
        : ""
    }
    <section class="rfz-abstract"><strong>Abstract</strong><p>${escapeHTML(
      paper.abstract ??
        (paper.abstractLoading
          ? "Loading abstract…"
          : paper.abstractError
            ? `Abstract unavailable: ${paper.abstractError}`
            : "Current metadata source did not provide an abstract."),
    )}</p></section>
  </aside>`;
}

function positionDetailCard(root: HTMLElement, overlay: HTMLElement): void {
  const card = overlay.querySelector<HTMLElement>("[data-detail-card]");
  if (!card) return;
  const view = root.ownerDocument.defaultView;
  const viewportWidth = view?.innerWidth ?? 0;
  const viewportHeight = view?.innerHeight ?? 0;
  const rootRect = root.getBoundingClientRect();
  const paperID = card.dataset.paperId;
  const anchor = [
    ...root.querySelectorAll<HTMLElement>("[data-paper-id]"),
  ].find((paperRow) => paperRow.dataset.paperId === paperID);
  const anchorRect = anchor?.getBoundingClientRect() ?? rootRect;
  const sidebarLeft = rootRect.left > 0 ? rootRect.left : viewportWidth;
  const right = Math.max(12, viewportWidth - sidebarLeft + 1);
  const width = Math.max(280, Math.min(760, sidebarLeft - 24));
  card.style.right = `${right}px`;
  card.style.width = `${width}px`;
  card.style.maxHeight = `${Math.max(180, viewportHeight - 24)}px`;
  const measuredHeight =
    card.getBoundingClientRect().height || card.scrollHeight;
  const cardHeight = Math.min(measuredHeight, Math.max(0, viewportHeight - 24));
  const maximumTop = Math.max(12, viewportHeight - cardHeight - 12);
  const top = Math.min(Math.max(anchorRect.top, 12), maximumTop);
  card.style.top = `${top}px`;
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

function isReaderPaperAction(
  value: string | undefined,
): value is ReaderPaperAction {
  return (
    value === "copy-title" || value === "copy-doi" || value === "google-search"
  );
}

function showTranslation(
  root: HTMLElement,
  source: string,
  result: string,
): void {
  root.querySelector("[data-translation]")?.remove();
  const popover = root.ownerDocument.createElementNS(XHTML_NAMESPACE, "aside");
  popover.className = "rfz-translation";
  popover.dataset.translation = "";
  const original = root.ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  original.className = "rfz-translation-source";
  original.textContent = source;
  const translated = root.ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  translated.dataset.translationResult = "";
  translated.textContent = result;
  popover.append(original, translated);
  root.append(popover);
}

const READER_STYLES = `
  .reference-for-zotero {
    --rfz-accent: #2d6cdf;
    --rfz-accent-soft: color-mix(in srgb, var(--rfz-accent) 12%, transparent);
    --rfz-header-height: 42px;
    --rfz-tabs-height: 39px;
    position: relative;
    height: 100%;
    color: var(--fill-primary, #242428);
    background: var(--material-sidepane, #fbfbfc);
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .reference-for-zotero * { box-sizing: border-box; }
  .rfz-header, .rfz-tabs, .rfz-limits { display: flex; align-items: center; }
  .rfz-header { position: sticky; z-index: 3; top: 0; min-height: var(--rfz-header-height); padding: 0 10px 0 12px; border-bottom: 1px solid var(--material-border, #d6d6d9); background: var(--material-sidepane, #f6f6f7); }
  .rfz-header strong { font-size: 13px; }
  .rfz-header small { margin-left: auto; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
  .rfz-icon-button, .rfz-tab, .rfz-limit, .rfz-paper-title, .rfz-card-close {
    border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer;
  }
  .rfz-icon-button { margin-left: 4px; padding: 3px 6px; border-radius: 5px; font-size: 15px; }
  .rfz-icon-button:hover, .rfz-card-close:hover { background: var(--fill-quinary, #ececef); }
  .rfz-tabs { position: sticky; z-index: 3; top: var(--rfz-header-height); min-height: var(--rfz-tabs-height); border-bottom: 1px solid var(--material-border, #d6d6d9); background: var(--material-background, #fff); }
  .rfz-tab { position: relative; flex: 1; padding: 11px 8px 9px; color: var(--fill-secondary, #69696f); text-align: center; font-weight: 600; }
  .rfz-tab[aria-selected="true"] { color: var(--fill-primary, #242428); }
  .rfz-tab[aria-selected="true"]::after { position: absolute; right: 18px; bottom: -1px; left: 18px; height: 2px; background: var(--rfz-accent); content: ""; }
  .rfz-tabs span { padding: 1px 5px; border-radius: 8px; background: var(--material-button, #ececef); font-size: 10px; }
  .rfz-limits { position: sticky; z-index: 3; top: calc(var(--rfz-header-height) + var(--rfz-tabs-height)); justify-content: flex-end; min-height: 42px; padding: 7px 10px; border-bottom: 1px solid var(--material-border, #e0e0e2); background: var(--material-sidepane, #fafafa); }
  .rfz-limit { display: flex; align-items: center; justify-content: center; min-width: 29px; padding: 3px 5px; border: 1px solid var(--material-border, #c5c5c8); border-right: 0; color: var(--fill-primary, CanvasText); background: var(--material-background, #fff); font-size: 10px; user-select: none; }
  .rfz-limit:first-child { border-radius: 5px 0 0 5px; }
  .rfz-limit:last-child { border-right: 1px solid var(--material-border, #c5c5c8); border-radius: 0 5px 5px 0; }
  .rfz-limit[aria-pressed="true"] { color: #154e9f; background: #dce8fb; }
  .rfz-content { overflow: auto; max-height: calc(100% - 85px); }
  .rfz-paper-list { margin: 0; padding: 0; list-style: none; }
  .rfz-paper { display: grid; grid-template-columns: 27px 1fr; gap: 5px; padding: 10px 8px; border-bottom: 1px solid var(--material-border, #ececef); cursor: default; }
  .rfz-paper.is-selected { background: var(--rfz-accent-soft); }
  .rfz-ordinal { color: var(--fill-secondary, #85858b); text-align: right; font-size: 11px; }
  .rfz-paper-title { display: block; width: 100%; padding: 0; color: var(--fill-primary, CanvasText); text-align: left; font-size: 12px; font-weight: 600; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; }
  .rfz-paper--resolved .rfz-paper-title { color: var(--rfz-accent); font-weight: 700; }
  .rfz-paper small, .rfz-paper-status { display: block; margin-top: 2px; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
  .rfz-paper-status { color: #8a5d0b; }
  .rfz-paper--failed .rfz-paper-status { color: #ba3b32; }
  .rfz-context-menu { position: fixed; z-index: 2147483640; display: none; min-width: 174px; padding: 4px; border: 1px solid var(--material-border, #aaaeb5); border-radius: 6px; color: var(--fill-primary, CanvasText); background: var(--material-background, #fff); box-shadow: 0 8px 24px #0003; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .rfz-context-menu.is-open { display: block; }
  .rfz-context-item { padding: 6px 10px; border-radius: 4px; color: var(--fill-primary, CanvasText); background: transparent; cursor: pointer; user-select: none; }
  .rfz-context-item:hover, .rfz-context-item:focus { background: var(--fill-quinary, #ececef); outline: none; }
  .rfz-context-item[aria-disabled="true"] { color: var(--fill-tertiary, #9a9aa0); cursor: default; }
  .rfz-status { padding: 36px 18px; text-align: center; }
  .rfz-status p { color: var(--fill-secondary, #6a6a70); }
  .rfz-overlay { position: fixed; z-index: 2147483000; inset: 0; pointer-events: none; }
  .rfz-overlay.is-open { pointer-events: auto; }
  .rfz-detail-card { position: fixed; padding: 16px 18px 18px; border: 1px solid var(--material-border, #aaaeb5); border-radius: 8px 0 0 8px; color: var(--fill-primary, #242428); background: var(--material-background, #fff); box-shadow: -8px 12px 28px #0003; overflow: auto; pointer-events: auto; user-select: text; }
  .rfz-card-title { display: block; max-width: calc(100% - 30px); color: var(--rfz-accent); font-size: 18px; font-weight: 750; line-height: 1.25; }
  .rfz-card-close { position: absolute; top: 12px; right: 12px; width: 24px; height: 24px; border-radius: 50%; color: var(--fill-secondary, #65656b); background: var(--fill-quinary, #f0f0f2); user-select: none; }
  .rfz-badges { display: flex; flex-wrap: wrap; gap: 9px; margin: 11px 0 9px; }
  .rfz-badges span { padding: 2px 11px; border-radius: 999px; color: #fff; background: #76c3c5; font-size: 11px; line-height: 1.2; }
  .rfz-badges .rfz-badge-connected { background: #2d9fa1; }
  .rfz-badges .rfz-badge-doi { background: #f5aa17; }
  .rfz-card-meta { color: var(--fill-secondary, #6e6e74); font-size: 12px; line-height: 1.5; }
  .rfz-abstract { margin: 12px 0 0; color: var(--fill-primary, #34343a); font-size: 13px; line-height: 1.55; }
  .rfz-abstract strong { display: block; margin-bottom: 3px; font-size: 12px; }
  .rfz-abstract p { margin: 0; }
  .rfz-translation { position: absolute; z-index: 20; right: 10px; bottom: 10px; width: min(340px, calc(100% - 20px)); padding: 10px 12px; border: 1px solid var(--material-border, #aaaeb5); border-radius: 7px; background: var(--material-sidepane, #fff); box-shadow: 0 8px 24px #0003; user-select: text; }
  .rfz-translation-source { margin-bottom: 5px; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
`;
