import type { ReferenceMatchBasis } from "../domain/literature";
import type { DownloadSettingsState } from "../application/download-settings";
import type { TranslationCapability } from "../translation/paper-translate-bridge";
import { relateScholarlyIdentities } from "../literature/identifiers";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const TRANSLATION_POPOVER_GAP = 8;
const TRANSLATION_POPOVER_MARGIN = 10;
const TRANSLATION_POPOVER_WIDTH = 340;

export type ReaderTab = "references" | "citations";
export type ReaderPaperAction = "copy-title" | "copy-doi" | "google-search";
export type ReaderStatus = "loading" | "ready" | "error" | "no-md";
export type CitingPapersStatus =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "error"; message: string }>;
export type PaperStatus =
  | "matching"
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "invalid-identifier"
  | "unreachable"
  | "failed";
export type PaperDownloadState =
  | Readonly<{ status: "queued" }>
  | Readonly<{ status: "downloading" }>
  | Readonly<{ status: "downloaded"; savedPath: string }>
  | Readonly<{ status: "failed"; error: string }>;
export type DownloadSelectionEntry = Readonly<{
  originTab: ReaderTab;
  paperID: string;
}>;
export type PaperDownloadProjection = DownloadSelectionEntry &
  PaperDownloadState;
type ReaderPaperBase = {
  id: string;
  ordinal: number;
  title: string;
  authors?: string;
  venue?: string;
  year?: string;
  statusText?: string;
  doi?: string;
  arxivID?: string;
  pmcid?: string;
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

export function sameReaderPaperIdentity(
  left: ReaderPaper,
  right: ReaderPaper,
): boolean {
  const relation = relateScholarlyIdentities(
    readerPaperIdentifiers(left),
    readerPaperIdentifiers(right),
  );
  return (
    relation === "same" || (relation === "unrelated" && left.id === right.id)
  );
}

export interface ReaderSectionState {
  activeTab: ReaderTab;
  status: ReaderStatus;
  message?: string;
  mineruDirectory?: string;
  references: readonly ReaderPaper[];
  citingPapers: readonly ReaderPaper[];
  citingPaperLimit: 10 | 30 | 50;
  citingPapersLoaded: number;
  citingPapersStatus: CitingPapersStatus;
  selectedPaperID?: string;
  downloadSelection: readonly DownloadSelectionEntry[];
  paperDownloads: readonly PaperDownloadProjection[];
  downloadInProgress: boolean;
  downloadAvailable: boolean;
  downloadSetup?: DownloadSettingsState;
}

export interface ReaderSectionController {
  getState(): ReaderSectionState;
  subscribe(listener: (state: ReaderSectionState) => void): () => void;
  selectTab(tab: ReaderTab): void;
  setCitationLimit(limit: 10 | 30 | 50): void;
  selectPaper(paperID: string): void;
  refresh(): void;
  openPaper(paperID: string): void;
  openReferenceURL(url: string): void;
  performPaperAction(paperID: string, action: ReaderPaperAction): void;
  setPaperDownloadSelected(
    tab: ReaderTab,
    paperID: string,
    selected: boolean,
  ): void;
  setTabDownloadSelected(tab: ReaderTab, selected: boolean): void;
  downloadSelected(): Promise<void>;
  openDownloadedFolder(paperID: string): void;
  openMineruDirectory?(): void;
  changeDownloadDestination?(): Promise<void>;
  resetDownloadDestination?(): void;
  translationCapability?(): TranslationCapability;
  translateSelection?(text: string): Promise<string>;
  externalInteractionDocuments?(): readonly Document[];
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
  const portal = body.ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  portal.className = "rfz-portal";
  const style = body.ownerDocument.createElementNS(XHTML_NAMESPACE, "style");
  style.textContent = READER_STYLES;
  const overlay = body.ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  overlay.className = "rfz-overlay";
  overlay.dataset.readerOverlay = "";
  const contextMenu = body.ownerDocument.createElementNS(
    XHTML_NAMESPACE,
    "div",
  );
  contextMenu.className = "rfz-context-menu";
  contextMenu.dataset.paperContextMenu = "";
  contextMenu.setAttribute("role", "menu");
  portal.append(style, overlay, contextMenu);
  body.ownerDocument.documentElement.append(portal);
  let destroyed = false;
  let translationRequest = 0;
  let detailWasOpenAtPointerDown = false;
  const externalInteractionDocuments = new Set<Document>();

  const dismissSelectedPaper = (): void => {
    const selectedPaperID = controller.getState().selectedPaperID;
    if (selectedPaperID) controller.selectPaper(selectedPaperID);
  };

  const onExternalPointerDown = (): void => {
    dismissSelectedPaper();
  };

  const syncExternalInteractionDocuments = (): void => {
    for (const document of controller.externalInteractionDocuments?.() ?? []) {
      if (externalInteractionDocuments.has(document)) continue;
      externalInteractionDocuments.add(document);
      document.addEventListener("pointerdown", onExternalPointerDown, true);
    }
  };

  const closeContextMenu = (): void => {
    contextMenu.classList.remove("is-open");
    contextMenu.replaceChildren();
    delete contextMenu.dataset.paperId;
    root
      .querySelector<HTMLElement>(".is-context-target")
      ?.classList.remove("is-context-target");
  };

  const openContextMenu = (
    paper: ReaderPaper,
    clientX: number,
    clientY: number,
  ): void => {
    closeContextMenu();
    contextMenu.dataset.paperId = paper.id;
    contextMenu.innerHTML = `
      <div class="rfz-context-item" role="menuitem" tabindex="0" data-paper-action="copy-title">复制论文标题</div>
      <div class="rfz-context-item" role="menuitem" tabindex="${paper.doi ? "0" : "-1"}" data-paper-action="copy-doi" aria-disabled="${paper.doi ? "false" : "true"}">复制 DOI</div>
      <div class="rfz-context-item" role="menuitem" tabindex="0" data-paper-action="google-search">使用 Google 搜索</div>`;
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
    const rootTranslation =
      root.querySelector<HTMLElement>("[data-translation]");
    const overlayTranslation =
      overlay.querySelector<HTMLElement>("[data-translation]");
    const activeElement = body.ownerDocument.activeElement;
    const focusKey =
      activeElement instanceof body.ownerDocument.defaultView!.Element &&
      root.contains(activeElement)
        ? activeElement.getAttribute("data-focus-key")
        : null;
    const papers =
      state.activeTab === "references"
        ? state.references
        : state.citingPapers.slice(
            0,
            Math.min(state.citingPaperLimit, state.citingPapers.length),
          );
    const downloadDisabled =
      state.downloadSelection.length === 0 ||
      state.downloadInProgress ||
      !state.downloadAvailable;
    root.innerHTML = `
      <header class="rfz-header" data-no-translation="">
        <span class="rfz-mineru-source">
          <strong>MinerU MD</strong>
          <small data-mineru-path="" title="${escapeAttribute(state.mineruDirectory ?? "")}">${escapeHTML(mineruPathLabel(state))}</small>
        </span>
        <span class="rfz-mineru-actions">
          <span class="rfz-mineru-action${state.mineruDirectory ? "" : " is-disabled"}" role="button" tabindex="${state.mineruDirectory ? "0" : "-1"}" aria-disabled="${state.mineruDirectory ? "false" : "true"}" data-open-mineru-folder=""><span class="rfz-mineru-icon" aria-hidden="true">📂</span> 打开文件夹</span>
          <span class="rfz-mineru-action" role="button" tabindex="0" data-refresh=""><span class="rfz-mineru-icon" aria-hidden="true">↻</span> 刷新</span>
        </span>
      </header>
      <nav class="rfz-tabs" aria-label="Paper relationship">
        <div class="rfz-tab" role="tab" tabindex="0" data-tab="references" data-focus-key="tab:references" aria-selected="${state.activeTab === "references"}">References <span>${state.references.length}</span></div>
        <div class="rfz-tab" role="tab" tabindex="0" data-tab="citations" data-focus-key="tab:citations" aria-selected="${state.activeTab === "citations"}">Citations <span>${state.citingPapersStatus.status === "loading" && state.citingPapers.length === 0 ? "…" : state.citingPapers.length}</span></div>
      </nav>
      ${
        state.activeTab === "citations"
          ? `<div class="rfz-limits" aria-label="Visible Citing papers">
              ${([10, 30, 50] as const)
                .map(
                  (limit) =>
                    `<div class="rfz-limit" role="button" tabindex="0" data-limit="${limit}" data-focus-key="limit:${limit}" aria-pressed="${state.citingPaperLimit === limit}">${limit}</div>`,
                )
                .join("")}
            </div>`
          : ""
      }
      <main class="rfz-content">
        ${renderContent(state, papers)}
      </main>
      ${
        state.downloadSelection.length > 0
          ? `<footer class="rfz-download-dock" data-no-translation="">
              <button type="button" class="rfz-download-button" data-download-selected="" data-focus-key="download-selected" aria-label="Download ${state.downloadSelection.length} selected papers" ${downloadDisabled ? 'disabled=""' : ""}>Download selected (${state.downloadSelection.length})</button>
              <span class="rfz-sr-only" role="status" aria-live="polite">${escapeHTML(downloadAnnouncement(state))}</span>
            </footer>`
          : ""
      }`;
    if (focusKey) {
      const replacement = [
        ...root.querySelectorAll<HTMLElement>("[data-focus-key]"),
      ].find((element) => element.dataset.focusKey === focusKey);
      replacement?.focus();
    }
    const detailCard = renderDetailCard(state, papers);
    overlay.innerHTML = detailCard;
    overlay.classList.toggle("is-open", detailCard.length > 0);
    positionDetailCard(root, overlay);
    if (rootTranslation) root.append(rootTranslation);
    if (overlayTranslation && detailCard.length > 0) {
      overlay.append(overlayTranslation);
    }
    syncExternalInteractionDocuments();
  }

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Element)) return;
    const selectPaper = target.closest<HTMLElement>("[data-select-paper]");
    const selectedPaperID = selectPaper?.dataset.selectPaper;
    if (selectedPaperID) {
      controller.setPaperDownloadSelected(
        controller.getState().activeTab,
        selectedPaperID,
        selectPaper?.getAttribute("aria-checked") !== "true",
      );
      return;
    }
    if (target === overlay) {
      dismissSelectedPaper();
      return;
    }
    if (target.closest("[data-refresh]")) {
      controller.refresh();
      return;
    }
    if (target.closest("[data-open-mineru-folder]")) {
      controller.openMineruDirectory?.();
      return;
    }
    if (target.closest("[data-download-selected]")) {
      void controller.downloadSelected();
      return;
    }
    const referenceLink = target.closest<HTMLElement>("[data-reference-link]");
    if (referenceLink) {
      event.preventDefault();
      const url = referenceLink.dataset.referenceLink;
      if (url) controller.openReferenceURL(url);
      return;
    }
    const openFolder = target.closest<HTMLElement>("[data-open-folder]");
    if (openFolder) {
      const paperID =
        openFolder.closest<HTMLElement>("[data-paper-id]")?.dataset.paperId;
      if (paperID) controller.openDownloadedFolder(paperID);
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
    if (body.ownerDocument.defaultView?.getSelection()?.toString().trim()) {
      return;
    }
    controller.selectPaper(paperID);
  };

  root.addEventListener("click", onClick);
  overlay.addEventListener("click", onClick);
  const openPaperContextMenu = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Element)) return;
    const title = target.closest<HTMLElement>("[data-paper-title]");
    const paperRow = title?.closest<HTMLElement>("[data-paper-id]");
    const paperID = paperRow?.dataset.paperId;
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
    paperRow.classList.add("is-context-target");
  };
  const onRightMouseDown = (event: MouseEvent): void => {
    if (event.button === 2) openPaperContextMenu(event);
  };
  root.addEventListener("mousedown", onRightMouseDown, true);
  root.addEventListener("contextmenu", openPaperContextMenu, true);
  const suppressDetailContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    closeContextMenu();
  };
  overlay.addEventListener("contextmenu", suppressDetailContextMenu);
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
    const openMineruFolder = target.closest<HTMLElement>(
      "[data-open-mineru-folder]",
    );
    if (openMineruFolder) {
      if (openMineruFolder.getAttribute("aria-disabled") !== "true") {
        event.preventDefault();
        controller.openMineruDirectory?.();
      }
      return;
    }
    if (target.closest("[data-refresh]")) {
      event.preventDefault();
      controller.refresh();
      return;
    }
    const tab = target.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (tab === "references" || tab === "citations") {
      event.preventDefault();
      controller.selectTab(tab);
      return;
    }
    const limit = Number(
      target.closest<HTMLElement>("[data-limit]")?.dataset.limit,
    );
    if (limit === 10 || limit === 30 || limit === 50) {
      event.preventDefault();
      controller.setCitationLimit(limit);
      return;
    }
    const title = target.closest<HTMLElement>("[data-paper-title]");
    if (!title) return;
    const paperID =
      title.closest<HTMLElement>("[data-paper-id]")?.dataset.paperId;
    if (!paperID) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      controller.openPaper(paperID);
      return;
    }
    controller.selectPaper(paperID);
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
    if (detailWasOpenAtPointerDown) dismissSelectedPaper();
  };
  body.ownerDocument.addEventListener("click", onDocumentClick);
  const onDocumentPointerDown = (event: Event): void => {
    detailWasOpenAtPointerDown = Boolean(controller.getState().selectedPaperID);
    const target = event.target;
    if (!(target instanceof body.ownerDocument.defaultView!.Node)) return;
    const translation =
      root.querySelector<HTMLElement>("[data-translation]") ??
      overlay.querySelector<HTMLElement>("[data-translation]");
    if (!translation || translation.contains(target)) return;
    translationRequest += 1;
    clearTranslation(root, overlay);
  };
  body.ownerDocument.addEventListener("pointerdown", onDocumentPointerDown);
  const onMouseUp = (event: MouseEvent): void => {
    const selection = body.ownerDocument.defaultView?.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    if (!selection.toString().trim()) return;
    const request = ++translationRequest;
    clearTranslation(root, overlay);
    const academicSelection = selectedAcademicSelection(
      selection,
      root,
      overlay,
      { x: event.clientX, y: event.clientY },
    );
    if (!academicSelection) return;
    const { anchor, container, text } = academicSelection;
    const capability = controller.translationCapability?.() ?? {
      available: Boolean(controller.translateSelection),
      reason: "not-installed" as const,
    };
    if (!capability.available || !controller.translateSelection) {
      showTranslation(
        container,
        anchor,
        text,
        `UI translation unavailable: ${capability.available ? "incompatible-api" : capability.reason}`,
      );
      return;
    }
    showTranslation(container, anchor, text, "Translating…");
    void controller
      .translateSelection(text)
      .then((result) => {
        if (destroyed || request !== translationRequest) return;
        showTranslation(container, anchor, text, result);
      })
      .catch((error: unknown) => {
        if (destroyed || request !== translationRequest) return;
        showTranslation(
          container,
          anchor,
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
      root.removeEventListener("mousedown", onRightMouseDown, true);
      root.removeEventListener("contextmenu", openPaperContextMenu, true);
      overlay.removeEventListener("contextmenu", suppressDetailContextMenu);
      contextMenu.removeEventListener("click", onContextMenuAction);
      root.removeEventListener("keydown", onKeyDown);
      contextMenu.removeEventListener("keydown", onContextMenuKeyDown);
      body.ownerDocument.removeEventListener("click", onDocumentClick);
      body.ownerDocument.removeEventListener(
        "pointerdown",
        onDocumentPointerDown,
      );
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
      for (const document of externalInteractionDocuments) {
        document.removeEventListener(
          "pointerdown",
          onExternalPointerDown,
          true,
        );
      }
      externalInteractionDocuments.clear();
      portal.remove();
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

function mineruPathLabel(state: ReaderSectionState): string {
  if (state.mineruDirectory) return state.mineruDirectory;
  if (state.status === "loading") return "Locating MinerU Markdown…";
  if (state.status === "no-md") return "MinerU Markdown not found";
  return "MinerU Markdown unavailable";
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

  if (
    state.activeTab === "citations" &&
    state.citingPapersStatus.status === "loading" &&
    papers.length === 0
  ) {
    return `<section class="rfz-status" role="status"><strong>正在查找引用论文…</strong><p>正在使用当前论文的 DOI 等标识查询 OpenCitations。</p></section>`;
  }

  if (
    state.activeTab === "citations" &&
    state.citingPapersStatus.status === "error" &&
    papers.length === 0
  ) {
    return `<section class="rfz-status" role="alert"><strong>引用论文查询失败</strong><p>${escapeHTML(
      state.citingPapersStatus.message,
    )}</p></section>`;
  }

  if (
    state.activeTab === "citations" &&
    state.citingPapersStatus.status === "ready" &&
    papers.length === 0
  ) {
    return `<section class="rfz-status"><strong>未找到引用文献</strong><p>OpenCitations 暂未返回引用该论文的记录。</p></section>`;
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
          paper.status === "resolved" ||
          paper.status === "unresolved" ||
          paper.status === "ambiguous" ||
          paper.status === "unreachable"
            ? ""
            : `<span class="rfz-paper-status">${escapeHTML(
                paper.statusText ?? statusLabel(paper.status),
              )}</span>`;
        const selectable = paper.status === "resolved";
        const unavailableReason =
          paper.status === "resolved" ? undefined : statusLabel(paper.status);
        const checkboxLabel = selectable
          ? `Select ${paper.title} for download`
          : `${paper.title} cannot be selected: ${unavailableReason}`;
        const selectedForDownload = state.downloadSelection.some((entry) =>
          selectionMatchesPaper(state, entry, paper),
        );
        const download = renderDownloadState(
          state.paperDownloads.find((entry) =>
            selectionMatchesPaper(state, entry, paper),
          ),
        );
        const metadata = [paper.year, paper.venue].filter(Boolean).join(" · ");
        return `<li class="rfz-paper rfz-paper--${paper.status}${
          state.selectedPaperID === paper.id ? " is-selected" : ""
        }${selectedForDownload ? " is-download-selected" : ""}" data-paper-id="${escapeAttribute(paper.id)}">
          <button class="rfz-paper-checkbox" type="button" role="checkbox" aria-checked="${selectedForDownload}" data-select-paper="${escapeAttribute(paper.id)}" data-paper-control="" data-focus-key="select:${state.activeTab}:${escapeAttribute(paper.id)}" aria-label="${escapeAttribute(checkboxLabel)}" ${selectable ? "" : 'disabled=""'}><span class="rfz-checkbox-mark" aria-hidden="true">✓</span></button>
          <span class="rfz-ordinal">${paper.ordinal + 1}.</span><div class="rfz-paper-main">
            <div class="rfz-paper-title" data-paper-title="" data-translation-text="" data-focus-key="title:${state.activeTab}:${escapeAttribute(paper.id)}" role="button" tabindex="0">${escapeHTML(
              paper.title,
            )}</div>${metadata ? `<small class="rfz-paper-metadata" data-paper-metadata="" data-translation-text="">${escapeHTML(metadata)}</small>` : ""}${status}
            ${unavailableReason ? `<span class="rfz-download-unavailable" data-no-translation="">Download unavailable · ${escapeHTML(unavailableReason)}</span>` : ""}${download}
          </div>
        </li>`;
      })
      .join("")}
  </ol>`;
}

function selectionMatchesPaper(
  state: ReaderSectionState,
  entry: DownloadSelectionEntry,
  paper: ReaderPaper,
): boolean {
  const source = (
    entry.originTab === "references" ? state.references : state.citingPapers
  ).find((candidate) => candidate.id === entry.paperID);
  return source
    ? sameReaderPaperIdentity(source, paper)
    : entry.paperID === paper.id;
}

function readerPaperIdentifiers(paper: ReaderPaper) {
  return {
    doi: paper.doi,
    arxiv: paper.arxivID,
    pmcid: paper.pmcid,
  };
}

function renderDownloadState(
  state: PaperDownloadProjection | undefined,
): string {
  if (!state) return "";
  const content = {
    queued: "Queued",
    downloading: "Downloading",
    downloaded: "Downloaded",
    failed: "Failed",
  }[state.status];
  const detail =
    state.status === "downloaded"
      ? `<span class="rfz-download-detail" data-saved-path="">${escapeHTML(state.savedPath)}</span><button type="button" class="rfz-open-folder" data-open-folder="" data-paper-control="" data-focus-key="open-folder:${escapeAttribute(state.paperID)}">Open folder</button>`
      : state.status === "failed"
        ? `<span class="rfz-download-detail">${escapeHTML(state.error)}</span>`
        : "";
  return `<div class="rfz-download-state rfz-download-state--${state.status}" data-download-state="${state.status}" data-no-translation=""><strong>${content}</strong>${detail}</div>`;
}

function downloadAnnouncement(state: ReaderSectionState): string {
  const current =
    [...state.paperDownloads]
      .reverse()
      .find((download) => download.status !== "queued") ??
    state.paperDownloads[0];
  if (!current) return "";
  const papers =
    current.originTab === "references" ? state.references : state.citingPapers;
  const title =
    papers.find((paper) => paper.id === current.paperID)?.title ??
    current.paperID;
  if (current.status === "downloaded") {
    return `${title}: Downloaded to ${current.savedPath}`;
  }
  if (current.status === "failed") return `${title}: Failed: ${current.error}`;
  return `${title}: ${current.status === "queued" ? "Queued" : "Downloading"}`;
}

function renderDetailCard(
  state: ReaderSectionState,
  papers: readonly ReaderPaper[],
): string {
  const paper = papers.find(
    (candidate) => candidate.id === state.selectedPaperID,
  );
  if (!paper) return "";
  if (paper.status !== "resolved") return "";
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
  return `<aside class="rfz-detail-card" data-detail-card="" data-paper-id="${escapeAttribute(paper.id)}">
    <button type="button" class="rfz-card-close" data-detail-close="" aria-label="Close paper details">×</button>
    <strong class="rfz-card-title" data-translation-text="">${escapeHTML(paper.title)}</strong>
    ${badges.length ? `<div class="rfz-badges">${badges.map((badge) => `<span class="rfz-badge-${badge.kind}"${badge.kind === "doi" ? ' data-translation-text=""' : ""}>${escapeHTML(badge.label)}</span>`).join("")}</div>` : ""}
    ${paper.authors ? `<div class="rfz-card-meta" data-translation-text="">${escapeHTML(paper.authors)}</div>` : ""}
    ${
      paper.venue || paper.year
        ? `<div class="rfz-card-meta" data-translation-text="">${escapeHTML([paper.venue, paper.year].filter(Boolean).join(" · "))}</div>`
        : ""
    }
    <section class="rfz-abstract"><strong>Abstract</strong><p${paper.abstract ? ' data-translation-text=""' : ""}>${escapeHTML(
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
    ambiguous: "匹配不唯一",
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

function clearTranslation(...containers: HTMLElement[]): void {
  for (const container of containers) {
    container.querySelector("[data-translation]")?.remove();
  }
}

function showTranslation(
  container: HTMLElement,
  anchor: TranslationAnchor,
  source: string,
  result: string,
): void {
  container.querySelector("[data-translation]")?.remove();
  const ownerDocument = container.ownerDocument;
  const popover = ownerDocument.createElementNS(XHTML_NAMESPACE, "aside");
  popover.className = "rfz-translation";
  popover.dataset.translation = "";
  const original = ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  original.className = "rfz-translation-source";
  original.textContent = source;
  const translated = ownerDocument.createElementNS(XHTML_NAMESPACE, "div");
  translated.dataset.translationResult = "";
  translated.textContent = result;
  popover.append(original, translated);
  container.append(popover);
  positionTranslationPopover(popover, anchor);
}

function selectedAcademicSelection(
  selection: Selection,
  root: HTMLElement,
  overlay: HTMLElement,
  fallbackAnchor: { x: number; y: number },
):
  | { anchor: TranslationAnchor; container: HTMLElement; text: string }
  | undefined {
  const text = selection.toString().trim();
  if (!text || selection.rangeCount !== 1) return undefined;
  const range = selection.getRangeAt(0);
  const startHost = selectionHost(range.startContainer, root, overlay);
  const endHost = selectionHost(range.endContainer, root, overlay);
  if (!startHost || startHost !== endHost) return undefined;

  const view = root.ownerDocument.defaultView;
  if (!view) return undefined;
  const walker = root.ownerDocument.createTreeWalker(
    startHost,
    view.NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || !node.textContent?.trim()) continue;
    const parent = node.parentElement;
    if (!parent?.closest("[data-translation-text]")) return undefined;
  }
  return {
    anchor: selectionAnchor(range, fallbackAnchor),
    container: startHost,
    text,
  };
}

type TranslationAnchor = Pick<
  DOMRect,
  "bottom" | "height" | "left" | "top" | "width"
>;

function selectionAnchor(
  range: Range,
  fallback: { x: number; y: number },
): TranslationAnchor {
  const measured =
    typeof range.getBoundingClientRect === "function"
      ? range.getBoundingClientRect()
      : undefined;
  if (measured && (measured.width > 0 || measured.height > 0)) return measured;
  return {
    bottom: fallback.y,
    height: 0,
    left: fallback.x,
    top: fallback.y,
    width: 0,
  };
}

function positionTranslationPopover(
  popover: HTMLElement,
  anchor: TranslationAnchor,
): void {
  const view = popover.ownerDocument.defaultView;
  if (!view) return;
  const bounds = popover.getBoundingClientRect();
  const width =
    bounds.width ||
    Math.min(
      TRANSLATION_POPOVER_WIDTH,
      Math.max(0, view.innerWidth - TRANSLATION_POPOVER_MARGIN * 2),
    );
  const centeredLeft = anchor.left + (anchor.width - width) / 2;
  const maximumLeft = Math.max(
    TRANSLATION_POPOVER_MARGIN,
    view.innerWidth - width - TRANSLATION_POPOVER_MARGIN,
  );
  const left = Math.min(
    maximumLeft,
    Math.max(TRANSLATION_POPOVER_MARGIN, centeredLeft),
  );
  const below = anchor.bottom + TRANSLATION_POPOVER_GAP;
  const top =
    below + bounds.height <= view.innerHeight - TRANSLATION_POPOVER_MARGIN
      ? below
      : Math.max(
          TRANSLATION_POPOVER_MARGIN,
          anchor.top - bounds.height - TRANSLATION_POPOVER_GAP,
        );
  Object.assign(popover.style, {
    bottom: "auto",
    left: `${Math.round(left)}px`,
    right: "auto",
    top: `${Math.round(top)}px`,
  });
}

function selectionHost(
  node: Node,
  root: HTMLElement,
  overlay: HTMLElement,
): HTMLElement | undefined {
  if (root.contains(node)) return root;
  if (overlay.contains(node)) return overlay;
  return undefined;
}

const READER_STYLES = `
  .reference-for-zotero {
    --rfz-accent: #2d6cdf;
    --rfz-accent-soft: color-mix(in srgb, var(--rfz-accent) 12%, transparent);
    --rfz-header-height: 56px;
    --rfz-tabs-height: 39px;
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    color: var(--fill-primary, #242428);
    background: var(--material-sidepane, #fbfbfc);
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .reference-for-zotero * { box-sizing: border-box; }
  .rfz-header, .rfz-tabs, .rfz-limits, .rfz-download-dock { display: flex; flex: none; align-items: center; }
  .rfz-header { position: sticky; z-index: 3; top: 0; min-height: var(--rfz-header-height); padding: 7px 10px 6px 12px; border-bottom: 1px solid var(--material-border, #d6d6d9); background: var(--material-sidepane, #f6f6f7); }
  .rfz-mineru-source { display: flex; flex: 1; min-width: 0; flex-direction: column; }
  .rfz-mineru-source strong { font-size: 13px; }
  .rfz-mineru-source small { overflow: hidden; color: var(--fill-secondary, #6a6a70); font-size: 10px; text-overflow: ellipsis; user-select: text; white-space: nowrap; }
  .rfz-mineru-actions { display: flex; flex: none; gap: 10px; align-items: center; margin-left: auto; padding-left: 10px; }
  .rfz-mineru-action { display: inline-flex; align-items: center; color: var(--rfz-accent); font-size: 11px; line-height: 16px; cursor: pointer; user-select: none; white-space: nowrap; }
  .rfz-mineru-icon { font-size: 13px; line-height: 1; }
  .rfz-mineru-action:hover, .rfz-mineru-action:focus { text-decoration: underline; outline: none; }
  .rfz-mineru-action.is-disabled { color: var(--fill-tertiary, #9a9aa0); cursor: default; text-decoration: none; }
  .rfz-tab, .rfz-limit, .rfz-paper-title, .rfz-card-close {
    border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer;
  }
  .rfz-card-close:hover { background: var(--fill-quinary, #ececef); }
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
  .rfz-paper-checkbox { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 15px; height: 15px; border: 1px solid var(--material-border, #8d8d94); border-radius: 3px; padding: 0; color: #fff; background: var(--material-background, #fff); font: 700 12px/1 sans-serif; }
  .rfz-paper-checkbox[aria-checked="true"] { border-color: var(--rfz-accent); background: var(--rfz-accent); }
  .rfz-checkbox-mark { opacity: 0; }
  .rfz-paper-checkbox[aria-checked="true"] .rfz-checkbox-mark { opacity: 1; }
  .rfz-paper-checkbox:disabled { opacity: 0.5; cursor: default; }
  .rfz-content { flex: 1; min-height: 0; overflow: auto; }
  .rfz-paper-list { margin: 0; padding: 0; list-style: none; }
  .rfz-paper { display: grid; grid-template-columns: 18px 22px minmax(0, 1fr); gap: 6px; width: 100%; padding: 10px 8px; border-bottom: 1px solid var(--material-border, #ececef); cursor: default; }
  .rfz-paper.is-selected { background: var(--rfz-accent-soft); }
  .rfz-paper.is-context-target { outline: 2px solid var(--rfz-accent); outline-offset: -2px; background: var(--rfz-accent-soft); }
  .rfz-paper.is-download-selected { box-shadow: inset 3px 0 var(--rfz-accent); }
  .rfz-paper-checkbox { grid-column: 1; margin: 1px 0 0; cursor: pointer; }
  .rfz-paper-main { grid-column: 3; min-width: 0; width: 100%; }
  .rfz-ordinal { grid-column: 2; color: var(--fill-secondary, #85858b); text-align: right; font-size: 13px; }
  .rfz-paper-title { display: block; width: 100%; padding: 0; color: var(--fill-primary, CanvasText); text-align: left; font-size: 13px; font-weight: 600; line-height: 1.35; white-space: normal; overflow-wrap: break-word; word-break: normal; }
  .rfz-paper--resolved .rfz-paper-title { color: var(--rfz-accent); font-weight: 700; }
  .rfz-paper small, .rfz-paper-status { display: block; margin-top: 2px; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
  .rfz-paper-status { color: #8a5d0b; }
  .rfz-paper--failed .rfz-paper-status { color: #ba3b32; }
  .rfz-download-unavailable { display: block; margin-top: 4px; color: #8a5d0b; font-size: 10px; }
  .rfz-download-state { display: flex; flex-wrap: wrap; gap: 3px 6px; align-items: center; margin-top: 5px; color: var(--fill-secondary, #6a6a70); font-size: 10px; overflow-wrap: anywhere; }
  .rfz-download-state--downloading strong { color: var(--rfz-accent); }
  .rfz-download-state--downloaded strong { color: #237a3b; }
  .rfz-download-state--failed strong { color: #ba3b32; }
  .rfz-download-detail { flex-basis: 100%; user-select: text; }
  .rfz-open-folder { border: 0; padding: 0; color: var(--rfz-accent); background: transparent; font: inherit; text-decoration: underline; cursor: pointer; }
  .rfz-download-dock { gap: 7px; min-height: 55px; padding: 7px 9px; border-top: 1px solid var(--material-border, #bfc5cf); background: var(--material-sidepane, #f8f9fb); box-shadow: 0 -5px 15px #0001; }
  .rfz-download-dock > span { min-width: 0; font-size: 10px; }
  .rfz-download-dock strong, .rfz-download-dock small { display: block; }
  .rfz-download-dock small { margin-top: 2px; color: var(--fill-secondary, #6a6a70); }
  .rfz-download-button { margin-left: auto; flex: none; border: 1px solid #1f5fbe; border-radius: 5px; padding: 5px 8px; color: #fff; background: var(--rfz-accent); font: inherit; font-size: 10px; font-weight: 650; cursor: pointer; }
  .rfz-download-button:disabled { border-color: #d2d2d5; color: #919197; background: #e4e4e6; cursor: default; }
  .rfz-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  .rfz-context-menu { position: fixed; z-index: 2147483640; display: none; min-width: 174px; padding: 4px; border: 1px solid var(--material-border, #aaaeb5); border-radius: 6px; color: var(--fill-primary, CanvasText); background: var(--material-background, #fff); box-shadow: 0 8px 24px #0003; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .rfz-context-menu.is-open { display: block; }
  .rfz-context-item { padding: 6px 10px; border-radius: 4px; color: var(--fill-primary, CanvasText); background: transparent; cursor: pointer; user-select: none; }
  .rfz-context-item:hover, .rfz-context-item:focus { background: var(--fill-quinary, #ececef); outline: none; }
  .rfz-context-item[aria-disabled="true"] { color: var(--fill-tertiary, #9a9aa0); cursor: default; }
  .rfz-status { padding: 36px 18px; text-align: center; }
  .rfz-status p { color: var(--fill-secondary, #6a6a70); }
  .rfz-overlay { position: fixed; z-index: 2147483000; inset: 0; pointer-events: none; }
  .rfz-overlay.is-open { pointer-events: none; }
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
  .rfz-translation { position: fixed; z-index: 20; width: min(340px, calc(100vw - 20px)); max-height: calc(100vh - 20px); overflow: auto; padding: 10px 12px; border: 1px solid var(--material-border, #aaaeb5); border-radius: 7px; background: var(--material-sidepane, #fff); box-shadow: 0 8px 24px #0003; user-select: text; }
  .rfz-translation-source { margin-bottom: 5px; color: var(--fill-secondary, #6a6a70); font-size: 10px; }
`;
