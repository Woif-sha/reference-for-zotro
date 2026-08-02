import type { ReferenceEntry } from "../domain/reference";
import type { PaperIdentity, SessionToken } from "../domain/literature";
import type {
  ReaderPaper,
  ReaderSectionController,
  ReaderSectionState,
  ReaderTab,
} from "../reader/mountReaderSection";
import { canOpenPrimaryResult } from "../reader/mountReaderSection";
import { PaperSessionCoordinator } from "../session/paper-session";

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
  translateSelection?(text: string, attachmentItemID: number): Promise<string>;
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
  };
  private readonly listeners = new Set<(state: ReaderSectionState) => void>();
  private readonly sessions = new PaperSessionCoordinator();
  private loadController?: AbortController;
  private persistController?: AbortController;
  private readonly abstractLoads = new Set<string>();
  private loadGeneration = 0;
  private context?: ResolutionContext;
  private disposed = false;

  constructor(
    private readonly attachmentItemID: number,
    private readonly ports: RelatedPapersPorts,
  ) {}

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
    this.sessions.cancelActive();
    this.context = undefined;
    this.update({
      status: "loading",
      message: undefined,
      references: [],
      citingPapers: [],
      citingPapersLoaded: 0,
      selectedPaperID: undefined,
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

  openPrimaryResult(paperID: string): void {
    const paper = [...this.state.references, ...this.state.citingPapers].find(
      (candidate) => candidate.id === paperID,
    );
    if (!canOpenPrimaryResult(paper)) return;
    this.ports.openURL(paper.primaryResultURL);
  }

  async translateSelection(text: string): Promise<string> {
    if (!this.ports.translateSelection) {
      throw new Error("UI translation unavailable");
    }
    return this.ports.translateSelection(text, this.attachmentItemID);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadController?.abort();
    this.persistController?.abort();
    this.sessions.dispose();
    this.ports.dispose?.();
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

  private assertActive(): void {
    if (this.disposed) throw new Error("RelatedPapersController is disposed");
  }
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
