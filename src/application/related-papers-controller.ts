import type { ReferenceEntry } from "../domain/reference";
import type { PaperIdentity, SessionToken } from "../domain/literature";
import {
  DEFAULT_DOWNLOAD_DESTINATION,
  type DownloadFirstUseController,
} from "./download-first-use";
import type {
  ReaderPaper,
  ReaderPaperAction,
  ReaderSectionController,
  ReaderSectionState,
  ReaderTab,
} from "../reader/mountReaderSection";
import { canOpenPrimaryResult } from "../reader/mountReaderSection";
import { PaperSessionCoordinator } from "../session/paper-session";
import type { TranslationCapability } from "../translation/paper-translate-bridge";

export type LoadedPaper = {
  identity: Omit<PaperIdentity, "sourceFingerprint">;
  sourceFingerprint: string;
  entries: readonly ReferenceEntry[];
};

export type ResolutionContext = {
  paper: LoadedPaper;
  token: SessionToken;
  signal: AbortSignal;
};

export type CachedRelatedPapers = {
  references: readonly ReaderPaper[];
  citingPapers: readonly ReaderPaper[];
  citingPapersLoaded: number;
};

export type SinglePaperDownloadResult =
  | Readonly<{ status: "downloaded"; savedPath: string }>
  | Readonly<{ status: "failed"; error: string }>;

export interface RelatedPapersPorts {
  loadPaper(
    attachmentItemID: number,
    signal: AbortSignal,
  ): Promise<LoadedPaper>;
  resolveReferences(
    entries: readonly ReferenceEntry[],
    context: ResolutionContext,
    onResolved: (paper: ReaderPaper) => void,
  ): Promise<readonly ReaderPaper[]>;
  loadCitingPapers(
    limit: 10 | 30 | 50,
    context: ResolutionContext,
  ): Promise<readonly ReaderPaper[]>;
  loadAbstract?(
    paper: ReaderPaper,
    context: ResolutionContext,
  ): Promise<Readonly<{ text: string; source: string }>>;
  readCachedResults?(
    paper: LoadedPaper,
  ): Promise<CachedRelatedPapers | undefined>;
  writeCachedResults?(
    paper: LoadedPaper,
    results: CachedRelatedPapers,
    context: ResolutionContext,
  ): Promise<void>;
  translationCapability?(): TranslationCapability;
  translateSelection?(text: string, attachmentItemID: number): Promise<string>;
  downloadPaper?(
    paper: ReaderPaper & { status: "resolved" },
  ): Promise<SinglePaperDownloadResult>;
  revealDownloadedFile?(savedPath: string): void;
  downloadSetup?: DownloadFirstUseController;
  copyText?(text: string): void;
  openURL(url: string): void;
  dispose?(): void;
}

export class RelatedPapersController implements ReaderSectionController {
  private state: ReaderSectionState = {
    activeTab: "references",
    status: "loading",
    references: [],
    citingPapers: [],
    citingPaperLimit: 10,
    citingPapersLoaded: 0,
    downloadSelection: [],
    paperDownloads: [],
    downloadInProgress: false,
    downloadAvailable: false,
    downloadSetup: defaultDownloadSetupState(),
  };
  private readonly listeners = new Set<(state: ReaderSectionState) => void>();
  private readonly sessions = new PaperSessionCoordinator();
  private loadController?: AbortController;
  private persistController?: AbortController;
  private downloadRun?: { invalidated: boolean };
  private readonly abstractLoads = new Set<string>();
  private loadGeneration = 0;
  private context?: ResolutionContext;
  private disposed = false;
  private unsubscribeDownloadSetup?: () => void;

  constructor(
    private readonly attachmentItemID: number,
    private readonly ports: RelatedPapersPorts,
  ) {
    this.state = {
      ...this.state,
      downloadAvailable: Boolean(ports.downloadPaper),
      downloadSetup:
        ports.downloadSetup?.getState() ?? defaultDownloadSetupState(),
    };
    this.unsubscribeDownloadSetup = ports.downloadSetup?.subscribe(
      (downloadSetup) => this.update({ downloadSetup }),
    );
  }

  getState(): ReaderSectionState {
    return this.state;
  }

  subscribe(listener: (state: ReaderSectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  selectTab(tab: ReaderTab): void {
    if (this.state.activeTab === tab) return;
    this.update({ activeTab: tab, selectedPaperID: undefined });
    if (
      tab === "citations" &&
      this.context &&
      this.state.citingPapers.length === 0
    ) {
      void this.loadCitingPapers(this.state.citingPaperLimit);
    }
  }

  setCitationLimit(limit: 10 | 30 | 50): void {
    this.update({ citingPaperLimit: limit, selectedPaperID: undefined });
    if (this.context && limit > this.state.citingPapersLoaded) {
      void this.loadCitingPapers(limit);
    }
  }

  setPaperDownloadSelected(
    tab: ReaderTab,
    paperID: string,
    selected: boolean,
  ): void {
    this.assertActive();
    const paper = this.findPaperInTab(tab, paperID);
    if (paper?.status !== "resolved") return;
    const selection = this.state.downloadSelection;
    const entry = { originTab: tab, paperID } as const;
    const alreadySelected = selection.some((selectedEntry) =>
      sameSelectionEntry(selectedEntry, entry),
    );
    if (selected === alreadySelected) return;
    this.update({
      downloadSelection: selected
        ? [...selection, entry]
        : selection.filter(
            (selectedEntry) => !sameSelectionEntry(selectedEntry, entry),
          ),
    });
  }

  setTabDownloadSelected(tab: ReaderTab, selected: boolean): void {
    this.assertActive();
    const eligibleEntries: ReaderSectionState["downloadSelection"][number][] =
      [];
    for (const paper of this.visiblePapers(tab)) {
      if (paper.status !== "resolved") continue;
      const entry = { originTab: tab, paperID: paper.id } as const;
      if (
        !eligibleEntries.some((candidate) =>
          sameSelectionEntry(candidate, entry),
        )
      ) {
        eligibleEntries.push(entry);
      }
    }
    if (eligibleEntries.length === 0) return;
    const selection = this.state.downloadSelection;
    const next = selected
      ? [
          ...selection,
          ...eligibleEntries.filter(
            (entry) =>
              !selection.some((selectedEntry) =>
                sameSelectionEntry(selectedEntry, entry),
              ),
          ),
        ]
      : selection.filter(
          (selectedEntry) =>
            !eligibleEntries.some((entry) =>
              sameSelectionEntry(selectedEntry, entry),
            ),
        );
    if (sameOrderedSelection(selection, next)) return;
    this.update({ downloadSelection: next });
  }

  async downloadSelected(): Promise<void> {
    this.assertActive();
    if (
      this.state.downloadInProgress ||
      this.state.downloadSelection.length === 0 ||
      !this.ports.downloadPaper
    ) {
      return;
    }

    const snapshot = this.state.downloadSelection
      .map((entry) => ({
        entry,
        paper: this.findPaperInTab(entry.originTab, entry.paperID),
      }))
      .filter(
        (
          selected,
        ): selected is {
          entry: (typeof selected)["entry"];
          paper: ReaderPaper & { status: "resolved" };
        } => selected.paper?.status === "resolved",
      );
    if (snapshot.length === 0) return;

    const run = { invalidated: false };
    this.downloadRun = run;
    this.update({
      downloadInProgress: true,
      paperDownloads: snapshot.map(({ entry }) => ({
        ...entry,
        status: "queued" as const,
      })),
    });

    try {
      for (const { entry, paper } of snapshot) {
        if (!this.downloadIsCurrent(run)) return;
        this.replaceDownload(entry, { status: "downloading" });
        let result: SinglePaperDownloadResult;
        try {
          result = await this.ports.downloadPaper(paper);
        } catch (error) {
          if (!this.downloadIsCurrent(run)) return;
          result = { status: "failed", error: originalError(error) };
        }
        if (!this.downloadIsCurrent(run)) return;
        this.replaceDownload(entry, result);
      }
    } finally {
      if (this.downloadRun === run) {
        this.downloadRun = undefined;
        this.update({ downloadInProgress: false });
      }
    }
  }

  openDownloadedFolder(paperID: string): void {
    const result = this.state.paperDownloads.find(
      (download) => download.paperID === paperID,
    );
    if (result?.status !== "downloaded") return;
    this.ports.revealDownloadedFile?.(result.savedPath);
  }

  changeDownloadDestination(): Promise<void> {
    return (
      this.ports.downloadSetup?.changeDownloadDestination() ?? Promise.resolve()
    );
  }

  resetDownloadDestination(): void {
    this.ports.downloadSetup?.resetDownloadDestination();
  }

  checkDownloadRuntime(): Promise<void> {
    return this.ports.downloadSetup?.checkRuntime() ?? Promise.resolve();
  }

  choosePythonExecutable(): Promise<void> {
    return (
      this.ports.downloadSetup?.choosePythonExecutable() ?? Promise.resolve()
    );
  }

  installDownloadRuntime(): Promise<void> {
    return this.ports.downloadSetup?.installRuntime() ?? Promise.resolve();
  }

  cancelDownloadRuntimeInstallation(): void {
    this.ports.downloadSetup?.cancelRuntimeInstallation();
  }

  selectPaper(paperID: string): void {
    const closing = this.state.selectedPaperID === paperID;
    this.update({
      selectedPaperID: closing ? undefined : paperID,
    });
    if (!closing) void this.loadPaperAbstract(paperID);
  }

  refresh(): void {
    void this.refreshAsync({ bypassCache: true });
  }

  async refreshAsync(options: { bypassCache?: boolean } = {}): Promise<void> {
    this.assertActive();
    const generation = ++this.loadGeneration;
    this.loadController?.abort();
    this.loadController = new AbortController();
    this.persistController?.abort();
    this.cancelDownloads();
    this.sessions.cancelActive();
    this.context = undefined;
    this.update({
      status: "loading",
      message: undefined,
      references: [],
      citingPapers: [],
      citingPapersLoaded: 0,
      selectedPaperID: undefined,
      downloadSelection: [],
      paperDownloads: [],
      downloadInProgress: Boolean(this.downloadRun),
    });

    let paper: LoadedPaper;
    try {
      paper = await this.ports.loadPaper(
        this.attachmentItemID,
        this.loadController.signal,
      );
    } catch (error) {
      if (!this.loadIsCurrent(generation)) return;
      this.publishLoadFailure(error);
      return;
    }
    if (!this.loadIsCurrent(generation)) return;

    const active = this.sessions.begin({
      ...paper.identity,
      sourceFingerprint: paper.sourceFingerprint,
    });
    const context: ResolutionContext = {
      paper,
      token: active.token,
      signal: active.signal,
    };
    this.context = context;
    this.update({
      status: "ready",
      references: paper.entries.map((entry) => ({
        id: `reference:${entry.ordinal}`,
        ordinal: entry.ordinal,
        title: entry.lookupText,
        status: "matching",
        statusText: "Matching",
      })),
    });

    if (!options.bypassCache && this.ports.readCachedResults) {
      try {
        const cached = await this.ports.readCachedResults(paper);
        if (!this.sessions.canCommit(context.token)) return;
        if (cached) {
          this.update({
            references: [...cached.references],
            citingPapers: [...cached.citingPapers],
            citingPapersLoaded: cached.citingPapersLoaded,
          });
          return;
        }
      } catch (error) {
        if (!this.sessions.canCommit(context.token)) return;
        this.update({
          status: "error",
          message: `Plugin cache read failed: ${conciseError(error)}`,
        });
        return;
      }
    }

    try {
      const references = await this.ports.resolveReferences(
        paper.entries,
        context,
        (resolved) => {
          if (!this.sessions.canCommit(context.token)) return;
          const next = [...this.state.references];
          next[resolved.ordinal] = resolved;
          this.update({ references: next });
        },
      );
      if (!this.sessions.canCommit(context.token)) return;
      this.update({ references: [...references] });
      await this.persistResults(context);
    } catch (error) {
      if (!this.sessions.canCommit(context.token)) return;
      this.update({
        references: this.state.references.map((paperState) =>
          paperState.status === "matching"
            ? {
                ...paperState,
                status: "failed",
                statusText: conciseError(error),
              }
            : paperState,
        ),
      });
      await this.persistResults(context);
    }
  }

  openPaper(paperID: string): void {
    const paper = this.findPaper(paperID);
    if (!paper || paper.status === "matching") return;
    this.ports.openURL(
      canOpenPrimaryResult(paper)
        ? paper.primaryResultURL
        : searchURL("google-scholar", paper),
    );
  }

  performPaperAction(paperID: string, action: ReaderPaperAction): void {
    const paper = this.findPaper(paperID);
    if (!paper) return;
    if (action === "google-search") {
      this.ports.openURL(searchURL("google", paper));
      return;
    }
    if (!this.ports.copyText) {
      throw new Error("Clipboard unavailable");
    }
    if (action === "copy-title") {
      this.ports.copyText(paper.title);
      return;
    }
    if (!paper.doi) throw new Error("Paper DOI unavailable");
    this.ports.copyText(paper.doi);
  }

  async translateSelection(text: string): Promise<string> {
    if (!this.ports.translateSelection) {
      throw new Error("UI translation unavailable");
    }
    return this.ports.translateSelection(text, this.attachmentItemID);
  }

  translationCapability(): TranslationCapability {
    if (this.ports.translationCapability) {
      return this.ports.translationCapability();
    }
    return this.ports.translateSelection
      ? { available: true }
      : { available: false, reason: "not-installed" };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadController?.abort();
    this.persistController?.abort();
    this.cancelDownloads();
    this.sessions.dispose();
    this.ports.dispose?.();
    this.unsubscribeDownloadSetup?.();
    this.unsubscribeDownloadSetup = undefined;
    this.listeners.clear();
    this.context = undefined;
  }

  private async loadCitingPapers(limit: 10 | 30 | 50): Promise<void> {
    const context = this.context;
    if (!context || !this.sessions.canCommit(context.token)) return;
    try {
      const citingPapers = await this.ports.loadCitingPapers(limit, context);
      if (!this.sessions.canCommit(context.token)) return;
      assertStablePrefix(this.state.citingPapers, citingPapers);
      const cumulativePapers =
        citingPapers.length >= this.state.citingPapers.length
          ? citingPapers
          : this.state.citingPapers;
      this.update({
        citingPapers: [...cumulativePapers],
        citingPapersLoaded: Math.max(
          this.state.citingPapersLoaded,
          citingPapers.length,
        ),
      });
      await this.persistResults(context);
    } catch (error) {
      if (!this.sessions.canCommit(context.token)) return;
      this.update({ message: conciseError(error) });
    }
  }

  private async loadPaperAbstract(paperID: string): Promise<void> {
    const context = this.context;
    const paper = [...this.state.references, ...this.state.citingPapers].find(
      (candidate) => candidate.id === paperID,
    );
    if (
      !context ||
      !this.ports.loadAbstract ||
      paper?.status !== "resolved" ||
      paper.abstract ||
      paper.abstractLoading
    ) {
      return;
    }
    const requestKey = `${context.token.generation}:${paperID}`;
    if (this.abstractLoads.has(requestKey)) return;
    this.abstractLoads.add(requestKey);
    this.replacePaper(paperID, {
      abstractLoading: true,
      abstractError: undefined,
    });
    try {
      const loaded = await this.ports.loadAbstract(paper, context);
      if (!this.sessions.canCommit(context.token)) return;
      this.replacePaper(paperID, {
        abstract: loaded.text,
        abstractSource: loaded.source,
        abstractLoading: false,
        abstractError: undefined,
      });
      await this.persistResults(context);
    } catch (error) {
      if (!this.sessions.canCommit(context.token)) return;
      this.replacePaper(paperID, {
        abstractLoading: false,
        abstractError: conciseError(error),
      });
    } finally {
      this.abstractLoads.delete(requestKey);
    }
  }

  private publishLoadFailure(error: unknown): void {
    const code = getErrorCode(error);
    if (isMinerUContractFailure(code)) {
      this.update({
        status: "no-md",
        message: `${conciseError(error)} Configure the llm-for-zotero MinerU API and generate Markdown for this paper.`,
      });
      return;
    }
    this.update({ status: "error", message: conciseError(error) });
  }

  private async persistResults(context: ResolutionContext): Promise<void> {
    if (!this.ports.writeCachedResults) return;
    this.persistController?.abort();
    const writeController = new AbortController();
    this.persistController = writeController;
    const abortWrite = () => writeController.abort();
    context.signal.addEventListener("abort", abortWrite, { once: true });
    try {
      await this.ports.writeCachedResults(
        context.paper,
        {
          references: this.state.references,
          citingPapers: this.state.citingPapers,
          citingPapersLoaded: this.state.citingPapersLoaded,
        },
        { ...context, signal: writeController.signal },
      );
    } catch (error) {
      if (writeController.signal.aborted) return;
      if (!this.sessions.canCommit(context.token)) return;
      this.update({
        status: "error",
        message: `Plugin cache write failed: ${conciseError(error)}`,
      });
    } finally {
      context.signal.removeEventListener("abort", abortWrite);
      if (this.persistController === writeController) {
        this.persistController = undefined;
      }
    }
  }

  private loadIsCurrent(generation: number): boolean {
    return (
      !this.disposed &&
      generation === this.loadGeneration &&
      !this.loadController?.signal.aborted
    );
  }

  private update(patch: Partial<ReaderSectionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private replacePaper(paperID: string, patch: Partial<ReaderPaper>): void {
    const replace = (paper: ReaderPaper): ReaderPaper =>
      paper.id === paperID ? ({ ...paper, ...patch } as ReaderPaper) : paper;
    this.update({
      references: this.state.references.map(replace),
      citingPapers: this.state.citingPapers.map(replace),
    });
  }

  private replaceDownload(
    entry: ReaderSectionState["downloadSelection"][number],
    result: SinglePaperDownloadResult | Readonly<{ status: "downloading" }>,
  ): void {
    this.update({
      paperDownloads: this.state.paperDownloads.map((download) =>
        sameSelectionEntry(download, entry)
          ? { ...entry, ...result }
          : download,
      ),
    });
  }

  private visiblePapers(tab: ReaderTab): readonly ReaderPaper[] {
    return tab === "references"
      ? this.state.references
      : this.state.citingPapers.slice(0, this.state.citingPaperLimit);
  }

  private downloadIsCurrent(run: { invalidated: boolean }): boolean {
    return !this.disposed && this.downloadRun === run && !run.invalidated;
  }

  private cancelDownloads(): void {
    if (this.downloadRun) this.downloadRun.invalidated = true;
  }

  private findPaper(paperID: string): ReaderPaper | undefined {
    return [...this.state.references, ...this.state.citingPapers].find(
      (candidate) => candidate.id === paperID,
    );
  }

  private findPaperInTab(
    tab: ReaderTab,
    paperID: string,
  ): ReaderPaper | undefined {
    const papers =
      tab === "references" ? this.state.references : this.state.citingPapers;
    return papers.find((candidate) => candidate.id === paperID);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("RelatedPapersController is disposed");
  }
}

function defaultDownloadSetupState(): ReaderSectionState["downloadSetup"] {
  return {
    downloadDestination: DEFAULT_DOWNLOAD_DESTINATION,
    usingDefaultDestination: true,
    runtime: { status: "unchecked" },
    institutionLogin: {
      status: "unavailable",
      error: "Institution browser policy is not connected",
    },
  };
}

function searchURL(
  engine: "google" | "google-scholar",
  paper: ReaderPaper,
): string {
  const query = `"${paper.title}"${paper.year ? ` ${paper.year}` : ""}`;
  const base =
    engine === "google"
      ? "https://www.google.com/search?q="
      : "https://scholar.google.com/scholar?q=";
  return `${base}${encodeURIComponent(query)}`;
}

function assertStablePrefix(
  existing: readonly ReaderPaper[],
  next: readonly ReaderPaper[],
): void {
  const sharedLength = Math.min(existing.length, next.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (existing[index]?.id !== next[index]?.id) {
      throw new Error("Citing paper provider changed the loaded result prefix");
    }
  }
}

function getErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "";
}

function isMinerUContractFailure(code: string): boolean {
  return (
    code.startsWith("md-") ||
    code.startsWith("references-") ||
    code === "unsupported-reader-item"
  );
}

function conciseError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/g, "[URL omitted]")
    .slice(0, 180);
}

function originalError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameSelectionEntry(
  left: Readonly<{ originTab: ReaderTab; paperID: string }>,
  right: Readonly<{ originTab: ReaderTab; paperID: string }>,
): boolean {
  return left.paperID === right.paperID;
}

function sameOrderedSelection(
  left: readonly Readonly<{ originTab: ReaderTab; paperID: string }>[],
  right: readonly Readonly<{ originTab: ReaderTab; paperID: string }>[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const rightEntry = right[index];
      return rightEntry !== undefined && sameSelectionEntry(entry, rightEntry);
    })
  );
}
