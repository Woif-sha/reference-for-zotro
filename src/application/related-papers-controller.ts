import type { ReferenceEntry } from "../domain/reference";
import type { PaperIdentity, SessionToken } from "../domain/literature";
import type {
  ReaderPaper,
  ReaderPaperAction,
  ReaderSectionController,
  ReaderSectionState,
  ReaderTab,
} from "../reader/mountReaderSection";
import {
  canOpenPrimaryResult,
  sameReaderPaperIdentity,
} from "../reader/mountReaderSection";
import { PaperSessionCoordinator } from "../session/paper-session";
import type { TranslationCapability } from "../translation/paper-translate-bridge";
import {
  parseReferenceQuery,
  UNPARSED_REFERENCE_TITLE,
} from "../literature/reference-query";
import type {
  RecommendationRequest,
  RecommendationResult,
} from "../recommendation/related-paper-recommendation";

export type LoadedPaper = {
  identity: Omit<PaperIdentity, "sourceFingerprint">;
  sourceFingerprint: string;
  fullMarkdown: string;
  fullMdSha256: string;
  mineruDirectory?: string;
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

export type CachedRecommendation = Extract<
  RecommendationResult,
  { status: "completed" }
>;

export type SinglePaperDownloadResult =
  | Readonly<{ status: "downloaded"; savedPath: string }>
  | Readonly<{ status: "failed"; error: string }>;

export type PaperDownloadProgress = Readonly<{
  paperID: string;
  result: SinglePaperDownloadResult;
}>;

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
  recommendPapers?(
    request: RecommendationRequest,
  ): Promise<RecommendationResult>;
  readCachedRecommendation?(
    request: RecommendationRequest,
  ): Promise<CachedRecommendation | undefined>;
  subscribeRecommendationIdentityChange?(listener: () => void): () => void;
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
  downloadPapers?(
    request: Readonly<{
      papers: readonly (ReaderPaper & { status: "resolved" })[];
      signal: AbortSignal;
      onProgress(progress: PaperDownloadProgress): void;
    }>,
  ): Promise<readonly PaperDownloadProgress[]>;
  revealDownloadedFile?(savedPath: string): void;
  revealMineruDirectory?(directory: string): void;
  externalInteractionDocuments?(): readonly Document[];
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
    citingPapersStatus: { status: "idle" },
    recommendation: { status: "not-analyzed" },
    downloadSelection: [],
    paperDownloads: [],
    downloadInProgress: false,
    downloadAvailable: false,
  };
  private readonly listeners = new Set<(state: ReaderSectionState) => void>();
  private readonly sessions = new PaperSessionCoordinator();
  private loadController?: AbortController;
  private persistController?: AbortController;
  private downloadRun?: { invalidated: boolean; controller: AbortController };
  private recommendationRun?: {
    generation: number;
    controller: AbortController;
  };
  private readonly abstractLoads = new Set<string>();
  private loadGeneration = 0;
  private citingRequestGeneration = 0;
  private recommendationGeneration = 0;
  private context?: ResolutionContext;
  private readonly unsubscribeRecommendationIdentityChange?: () => void;
  private disposed = false;

  constructor(
    private readonly attachmentItemID: number,
    private readonly ports: RelatedPapersPorts,
  ) {
    this.state = {
      ...this.state,
      downloadAvailable: Boolean(ports.downloadPapers),
    };
    this.unsubscribeRecommendationIdentityChange =
      ports.subscribeRecommendationIdentityChange?.(() => {
        if (this.disposed) return;
        this.invalidateRecommendation();
        if (this.context) {
          void this.restoreCachedRecommendation(this.context);
        }
      });
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
      this.state.citingPapersStatus.status === "idle"
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

  async generateRecommendations(): Promise<void> {
    this.assertActive();
    const context = this.context;
    if (
      !context ||
      !this.ports.recommendPapers ||
      this.recommendationRun ||
      this.state.recommendation.status === "completed"
    ) {
      return;
    }
    const run = {
      generation: ++this.recommendationGeneration,
      controller: new AbortController(),
    };
    this.recommendationRun = run;
    this.update({ recommendation: { status: "analyzing" } });
    try {
      const request = this.recommendationRequest(
        context,
        run.controller.signal,
      );
      if (this.ports.readCachedRecommendation) {
        const cached = await this.ports.readCachedRecommendation(request);
        if (!this.recommendationIsCurrent(run, context.token)) return;
        if (cached) {
          this.update({
            recommendation: {
              status: "completed",
              priority: cached.priority,
              optional: cached.optional,
              restoredFromCache: true,
            },
          });
          return;
        }
      }
      const result = await this.ports.recommendPapers(request);
      if (!this.recommendationIsCurrent(run, context.token)) return;
      this.update({
        recommendation:
          result.status === "no-candidates"
            ? { status: "no-candidates" }
            : {
                status: "completed",
                priority: result.priority,
                optional: result.optional,
                restoredFromCache: false,
              },
      });
    } catch (error) {
      if (!this.recommendationIsCurrent(run, context.token)) return;
      this.update({
        recommendation: { status: "failed", message: conciseError(error) },
      });
    } finally {
      if (this.recommendationRun === run) this.recommendationRun = undefined;
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
      this.sameDownloadPaper(selectedEntry, entry),
    );
    if (selected === alreadySelected) return;
    this.update({
      downloadSelection: selected
        ? [...selection, entry]
        : selection.filter(
            (selectedEntry) => !this.sameDownloadPaper(selectedEntry, entry),
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
          this.sameDownloadPaper(candidate, entry),
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
                this.sameDownloadPaper(selectedEntry, entry),
              ),
          ),
        ]
      : selection.filter(
          (selectedEntry) =>
            !eligibleEntries.some((entry) =>
              this.sameDownloadPaper(selectedEntry, entry),
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
      !this.ports.downloadPapers
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

    const run = { invalidated: false, controller: new AbortController() };
    this.downloadRun = run;
    this.update({
      downloadInProgress: true,
      paperDownloads: snapshot.map(({ entry }) => ({
        ...entry,
        status: "queued" as const,
      })),
    });

    try {
      for (const { entry } of snapshot) {
        this.replaceDownload(entry, { status: "downloading" });
      }
      const results = await this.ports.downloadPapers({
        papers: snapshot.map(({ paper }) => paper),
        signal: run.controller.signal,
        onProgress: ({ paperID, result }) => {
          if (!this.downloadIsCurrent(run)) return;
          const selected = snapshot.find(({ paper }) => paper.id === paperID);
          if (selected) this.replaceDownload(selected.entry, result);
        },
      });
      if (!this.downloadIsCurrent(run)) return;
      for (const { paperID, result } of results) {
        const selected = snapshot.find(({ paper }) => paper.id === paperID);
        if (selected) this.replaceDownload(selected.entry, result);
      }
    } catch (error) {
      if (!this.downloadIsCurrent(run)) return;
      for (const { entry } of snapshot) {
        const current = this.state.paperDownloads.find((download) =>
          sameSelectionEntry(download, entry),
        );
        if (current?.status === "downloading") {
          this.replaceDownload(entry, {
            status: "failed",
            error: originalError(error),
          });
        }
      }
    } finally {
      if (this.downloadRun === run) {
        this.downloadRun = undefined;
        this.update({ downloadInProgress: false });
      }
    }
  }

  openDownloadedFolder(paperID: string): void {
    const requestedPaper =
      this.findPaperInTab(this.state.activeTab, paperID) ??
      this.findPaper(paperID);
    const result = this.state.paperDownloads.find((download) => {
      if (download.paperID === paperID) return true;
      if (!requestedPaper) return false;
      const downloadedPaper = this.findPaperInTab(
        download.originTab,
        download.paperID,
      );
      return (
        downloadedPaper !== undefined &&
        sameReaderPaperIdentity(downloadedPaper, requestedPaper)
      );
    });
    if (result?.status !== "downloaded") return;
    this.ports.revealDownloadedFile?.(result.savedPath);
  }

  openMineruDirectory(): void {
    const directory = this.state.mineruDirectory;
    if (directory) this.ports.revealMineruDirectory?.(directory);
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
    this.cancelRecommendation();
    this.cancelDownloads();
    this.sessions.cancelActive();
    this.context = undefined;
    this.citingRequestGeneration += 1;
    this.update({
      status: "loading",
      message: undefined,
      mineruDirectory: undefined,
      references: [],
      citingPapers: [],
      citingPapersLoaded: 0,
      citingPapersStatus: { status: "idle" },
      recommendation: { status: "not-analyzed" },
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
      mineruDirectory: paper.mineruDirectory,
      references: paper.entries.map((entry) => {
        const query = parseReferenceQuery(entry.lookupText);
        return {
          id: `reference:${entry.ordinal}`,
          ordinal: entry.ordinal,
          sourceLabel: entry.sourceLabel,
          title: query.title ?? UNPARSED_REFERENCE_TITLE,
          referenceText: entry.lookupText,
          venue: query.venue,
          year: query.year?.toString(),
          status: "matching",
          statusText: "Matching",
        };
      }),
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
            citingPapersStatus: {
              status: cached.citingPapersLoaded > 0 ? "ready" : "idle",
            },
          });
          await this.restoreCachedRecommendation(context);
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
          this.invalidateRecommendation();
          const next = [...this.state.references];
          next[resolved.ordinal] = resolved;
          this.update({ references: next });
        },
      );
      if (!this.sessions.canCommit(context.token)) return;
      this.invalidateRecommendation();
      this.update({ references: [...references] });
      await this.persistResults(context);
      await this.restoreCachedRecommendation(context);
    } catch (error) {
      if (!this.sessions.canCommit(context.token)) return;
      this.invalidateRecommendation();
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
      await this.restoreCachedRecommendation(context);
    }
  }

  private async restoreCachedRecommendation(
    context: ResolutionContext,
  ): Promise<void> {
    if (!this.ports.readCachedRecommendation) return;
    const run = {
      generation: ++this.recommendationGeneration,
      controller: new AbortController(),
    };
    this.recommendationRun = run;
    try {
      const cached = await this.ports.readCachedRecommendation(
        this.recommendationRequest(context, run.controller.signal),
      );
      if (!this.recommendationIsCurrent(run, context.token)) return;
      if (cached) {
        this.update({
          recommendation: {
            status: "completed",
            priority: cached.priority,
            optional: cached.optional,
            restoredFromCache: true,
          },
        });
      }
    } catch (error) {
      if (!this.recommendationIsCurrent(run, context.token)) return;
      this.update({
        recommendation: { status: "failed", message: conciseError(error) },
      });
    } finally {
      if (this.recommendationRun === run) this.recommendationRun = undefined;
    }
  }

  private recommendationRequest(
    context: ResolutionContext,
    signal: AbortSignal,
  ): RecommendationRequest {
    return {
      currentPaper: {
        ...context.paper.identity,
        fullMarkdown: context.paper.fullMarkdown,
        fullMdSha256: context.paper.fullMdSha256,
        sourceFingerprint: context.paper.sourceFingerprint,
      },
      references: [...this.state.references],
      citingPapers: [...this.state.citingPapers],
      signal,
    };
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

  openReferenceURL(url: string): void {
    const target = new URL(url);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Reference URL must use HTTP or HTTPS");
    }
    this.ports.openURL(target.href);
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

  externalInteractionDocuments(): readonly Document[] {
    return this.ports.externalInteractionDocuments?.() ?? [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadController?.abort();
    this.persistController?.abort();
    this.cancelRecommendation();
    this.cancelDownloads();
    this.sessions.dispose();
    this.ports.dispose?.();
    this.unsubscribeRecommendationIdentityChange?.();
    this.listeners.clear();
    this.context = undefined;
  }

  private async loadCitingPapers(limit: 10 | 30 | 50): Promise<void> {
    const context = this.context;
    if (!context || !this.sessions.canCommit(context.token)) return;
    const requestGeneration = ++this.citingRequestGeneration;
    this.update({ citingPapersStatus: { status: "loading" } });
    try {
      const citingPapers = await this.ports.loadCitingPapers(limit, context);
      if (!this.sessions.canCommit(context.token)) return;
      assertStablePrefix(this.state.citingPapers, citingPapers);
      this.invalidateRecommendation();
      const cumulativePapers =
        citingPapers.length >= this.state.citingPapers.length
          ? citingPapers
          : this.state.citingPapers;
      this.update({
        citingPapers: [...cumulativePapers],
        citingPapersLoaded: Math.max(this.state.citingPapersLoaded, limit),
        ...(requestGeneration === this.citingRequestGeneration
          ? { citingPapersStatus: { status: "ready" as const } }
          : {}),
      });
      await this.persistResults(context);
      await this.restoreCachedRecommendation(context);
    } catch (error) {
      if (!this.sessions.canCommit(context.token)) return;
      if (requestGeneration !== this.citingRequestGeneration) return;
      this.update({
        citingPapersStatus: {
          status: "error",
          message: conciseError(error),
        },
      });
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
      this.invalidateRecommendation();
      this.replacePaper(paperID, {
        abstract: loaded.text,
        abstractSource: loaded.source,
        abstractLoading: false,
        abstractError: undefined,
      });
      await this.persistResults(context);
      await this.restoreCachedRecommendation(context);
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
    if (tab === "references") return this.state.references;
    if (tab === "citations") {
      return this.state.citingPapers.slice(0, this.state.citingPaperLimit);
    }
    return [];
  }

  private downloadIsCurrent(run: { invalidated: boolean }): boolean {
    return !this.disposed && this.downloadRun === run && !run.invalidated;
  }

  private recommendationIsCurrent(
    run: { generation: number; controller: AbortController },
    token: SessionToken,
  ): boolean {
    return (
      !this.disposed &&
      this.recommendationRun === run &&
      run.generation === this.recommendationGeneration &&
      !run.controller.signal.aborted &&
      this.sessions.canCommit(token)
    );
  }

  private cancelRecommendation(): void {
    this.recommendationGeneration += 1;
    this.recommendationRun?.controller.abort();
    this.recommendationRun = undefined;
  }

  private invalidateRecommendation(): void {
    this.cancelRecommendation();
    if (this.state.recommendation.status !== "not-analyzed") {
      this.update({ recommendation: { status: "not-analyzed" } });
    }
  }

  private cancelDownloads(): void {
    if (!this.downloadRun) return;
    this.downloadRun.invalidated = true;
    this.downloadRun.controller.abort();
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
      tab === "references"
        ? this.state.references
        : tab === "citations"
          ? this.state.citingPapers
          : [];
    return papers.find((candidate) => candidate.id === paperID);
  }

  private sameDownloadPaper(
    left: Readonly<{ originTab: ReaderTab; paperID: string }>,
    right: Readonly<{ originTab: ReaderTab; paperID: string }>,
  ): boolean {
    const leftPaper = this.findPaperInTab(left.originTab, left.paperID);
    const rightPaper = this.findPaperInTab(right.originTab, right.paperID);
    if (!leftPaper || !rightPaper) return sameSelectionEntry(left, right);
    return sameReaderPaperIdentity(leftPaper, rightPaper);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("RelatedPapersController is disposed");
  }
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
