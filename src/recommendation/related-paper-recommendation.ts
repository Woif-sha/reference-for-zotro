import type { RecommendationModelPort } from "../model/configured-recommendation-model";
import {
  RecommendationCacheRepository,
  type RecommendationCacheIdentity,
} from "../cache/recommendation-cache-repository";
import {
  normalizeScholarlyIdentifier,
  relateScholarlyIdentities,
} from "../literature/identifiers";
import type { PaperIdentity } from "../domain/literature";
import type { ReaderPaper } from "../reader/mountReaderSection";

export const RECOMMENDATION_INPUT_MAX_BYTES = 384 * 1024;
export const RECOMMENDATION_OUTPUT_MAX_CHARACTERS = 32_768;
export const RECOMMENDATION_TIMEOUT_MS = 180_000;
export const RECOMMENDATION_PROMPT_VERSION = 1;

export type RecommendationSource = "reference" | "citation";

export type RecommendationItem = Readonly<{
  candidateKey: string;
  paperID: string;
  title: string;
  sources: readonly RecommendationSource[];
  reason: string;
}>;

export type RecommendationResult =
  | Readonly<{ status: "no-candidates" }>
  | Readonly<{
      status: "completed";
      priority: readonly RecommendationItem[];
      optional: readonly RecommendationItem[];
    }>;

export type RecommendationRequest = Readonly<{
  currentPaper: Readonly<
    PaperIdentity & {
      fullMarkdown: string;
      fullMdSha256: string;
    }
  >;
  references: readonly ReaderPaper[];
  citingPapers: readonly ReaderPaper[];
  signal?: AbortSignal;
}>;

export class RecommendationAnalysisError extends Error {
  constructor(
    readonly code:
      | "analysis_invalid_output"
      | "analysis_input_too_large"
      | "analysis_output_too_large"
      | "analysis_timed_out",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RecommendationAnalysisError";
  }
}

type Candidate = {
  candidateKey: string;
  paper: ReaderPaper;
  abstract: string;
  sources: RecommendationSource[];
};

const INSTRUCTIONS = `You rank papers only by their direct semantic relationship to the supplied Current paper.
Return one JSON object with exactly schemaVersion, priority, and optional. schemaVersion must be 1. Each list item must contain exactly id and reason. Put at most five papers in priority and every remaining candidate in optional. Cover every candidate exactly once. Prefer direct relationships involving the core problem, hypothesis, conclusion, method, model, theory, data, or experiment. Only when semantic relevance is comparable, prefer a Citation. Each reason must be one concrete Chinese sentence with no newline and at most 240 Unicode code points. Do not use tools, web search, external knowledge, Markdown fences, scores, or extra fields.`;

export class RelatedPaperRecommendationService {
  constructor(
    private readonly model: RecommendationModelPort,
    private readonly options: Readonly<{
      timeoutMs?: number;
      cache?: RecommendationCacheRepository;
    }> = {},
  ) {}

  async readCached(
    request: RecommendationRequest,
  ): Promise<
    Extract<RecommendationResult, { status: "completed" }> | undefined
  > {
    if (!this.options.cache) return undefined;
    if (!this.model.identity) {
      throw new Error("Recommendation model identity is unavailable");
    }
    const candidates = recommendationCandidates(
      request.references,
      request.citingPapers,
    );
    const cached = await this.options.cache.read(
      cacheIdentity(request, candidates, this.model.identity()),
    );
    return cached ? { status: "completed", ...cached } : undefined;
  }

  subscribeIdentityChange(listener: () => void): () => void {
    return this.model.subscribeIdentityChange?.(listener) ?? (() => undefined);
  }

  async recommend(
    request: RecommendationRequest,
  ): Promise<RecommendationResult> {
    const allCandidates = recommendationCandidates(
      request.references,
      request.citingPapers,
    );
    const candidates = allCandidates.filter((candidate) => candidate.abstract);
    if (candidates.length === 0) return { status: "no-candidates" };

    const prompt = JSON.stringify({
      schemaVersion: 1,
      currentPaperMarkdown: request.currentPaper.fullMarkdown,
      candidates: candidates.map((candidate, index) => ({
        id: `paper-${index + 1}`,
        sources: candidate.sources.map(sourceLabel),
        title: candidate.paper.title,
        abstract: candidate.abstract,
      })),
    });
    const inputBytes =
      new TextEncoder().encode(INSTRUCTIONS).byteLength +
      new TextEncoder().encode(prompt).byteLength;
    if (inputBytes > RECOMMENDATION_INPUT_MAX_BYTES) {
      throw new RecommendationAnalysisError(
        "analysis_input_too_large",
        `Recommendation input exceeded the ${RECOMMENDATION_INPUT_MAX_BYTES}-byte limit`,
      );
    }
    const generated = await this.generateWithDeadline(
      INSTRUCTIONS,
      prompt,
      request.signal,
    );
    if ([...generated.text].length > RECOMMENDATION_OUTPUT_MAX_CHARACTERS) {
      throw new RecommendationAnalysisError(
        "analysis_output_too_large",
        `Recommendation output exceeded the ${RECOMMENDATION_OUTPUT_MAX_CHARACTERS}-character limit`,
      );
    }
    const output = validateOutput(
      generated.text,
      candidates.map((_, index) => `paper-${index + 1}`),
    );
    const project = ({ id, reason }: { id: string; reason: string }) => {
      const index = Number(id.replace(/^paper-/u, "")) - 1;
      const candidate = candidates[index]!;
      return {
        candidateKey: candidate.candidateKey,
        paperID: candidate.paper.id,
        title: candidate.paper.title,
        sources: candidate.sources,
        reason,
      };
    };
    const result = {
      status: "completed",
      priority: output.priority.map(project),
      optional: output.optional.map(project),
    } as const;
    if (this.options.cache) {
      await this.options.cache.write(
        cacheIdentity(request, allCandidates, generated.identity),
        { priority: result.priority, optional: result.optional },
        request.signal,
      );
    }
    return result;
  }

  private async generateWithDeadline(
    instructions: string,
    prompt: string,
    externalSignal?: AbortSignal,
  ) {
    if (externalSignal?.aborted) throw externalSignal.reason;
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    const timeoutError = new RecommendationAnalysisError(
      "analysis_timed_out",
      `Recommendation analysis exceeded ${RECOMMENDATION_TIMEOUT_MS / 1000} seconds`,
    );
    const timeout = setTimeout(
      () => controller.abort(timeoutError),
      this.options.timeoutMs ?? RECOMMENDATION_TIMEOUT_MS,
    );
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(controller.signal.reason),
        { once: true },
      );
    });
    try {
      return await Promise.race([
        this.model.generate({
          instructions,
          prompt,
          signal: controller.signal,
        }),
        aborted,
      ]);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

function cacheIdentity(
  request: RecommendationRequest,
  candidates: readonly Candidate[],
  model: RecommendationCacheIdentity["model"],
): RecommendationCacheIdentity {
  return {
    currentPaper: {
      libraryID: request.currentPaper.libraryID,
      attachmentID: request.currentPaper.attachmentID,
      attachmentKey: request.currentPaper.attachmentKey,
      parentItemKey: request.currentPaper.parentItemKey,
      sourceFingerprint: request.currentPaper.sourceFingerprint,
      fullMdSha256: request.currentPaper.fullMdSha256,
    },
    visibleCandidates: candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      paperID: candidate.paper.id,
      title: candidate.paper.title,
      sources: candidate.sources,
    })),
    analyzedCandidates: candidates.flatMap((candidate) =>
      candidate.abstract
        ? [
            {
              candidateKey: candidate.candidateKey,
              abstract: candidate.abstract,
            },
          ]
        : [],
    ),
    model,
    promptVersion: RECOMMENDATION_PROMPT_VERSION,
  };
}

function recommendationCandidates(
  references: readonly ReaderPaper[],
  citingPapers: readonly ReaderPaper[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const [source, papers] of [
    ["reference", references],
    ["citation", citingPapers],
  ] as const) {
    for (const paper of papers) {
      const existing = candidates.find(
        (candidate) =>
          relateScholarlyIdentities(
            readerPaperIdentity(candidate.paper),
            readerPaperIdentity(paper),
          ) === "same",
      );
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        const currentAbstract = paper.abstract?.trim();
        if (source === "citation") {
          existing.paper = paper;
          if (currentAbstract) existing.abstract = currentAbstract;
        } else if (!existing.abstract && currentAbstract) {
          existing.paper = paper;
          existing.abstract = currentAbstract;
        }
        continue;
      }
      candidates.push({
        candidateKey: uniqueCandidateKey(paper, source, candidates),
        paper,
        abstract: paper.abstract?.trim() ?? "",
        sources: [source],
      });
    }
  }
  return candidates;
}

function readerPaperIdentity(paper: ReaderPaper) {
  return {
    doi: paper.doi,
    arxiv: paper.arxivID,
    pmcid: paper.pmcid,
  };
}

function stableCandidateKey(
  paper: ReaderPaper,
  source: RecommendationSource,
): string {
  const doi = normalizeScholarlyIdentifier("doi", paper.doi);
  if (doi) return `doi:${doi}`;
  const arxiv = normalizeScholarlyIdentifier("arxiv", paper.arxivID);
  if (arxiv) return `arxiv:${arxiv}`;
  const pmcid = normalizeScholarlyIdentifier("pmcid", paper.pmcid);
  if (pmcid) return `pmcid:${pmcid}`;
  return `reader:${source}:${paper.id}`;
}

function uniqueCandidateKey(
  paper: ReaderPaper,
  source: RecommendationSource,
  candidates: readonly Candidate[],
): string {
  const stable = stableCandidateKey(paper, source);
  if (!candidates.some((candidate) => candidate.candidateKey === stable))
    return stable;
  return `${stable}|reader:${source}:${paper.id}`;
}

function sourceLabel(source: RecommendationSource): "Reference" | "Citation" {
  return source === "reference" ? "Reference" : "Citation";
}

type ValidatedOutputItem = Readonly<{ id: string; reason: string }>;
type ValidatedOutput = Readonly<{
  priority: readonly ValidatedOutputItem[];
  optional: readonly ValidatedOutputItem[];
}>;

function validateOutput(
  text: string,
  candidateIDs: readonly string[],
): ValidatedOutput {
  if (!text.trim() || /```/u.test(text))
    return invalidOutput("Model output is empty or fenced");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return invalidOutput("Model output is not valid JSON", error);
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "priority", "optional"])
  ) {
    return invalidOutput("Model output root fields are invalid");
  }
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.priority) ||
    !Array.isArray(value.optional)
  ) {
    return invalidOutput("Model output schema is invalid");
  }
  if (value.priority.length > 5)
    return invalidOutput("Priority contains more than five papers");

  const expected = new Set(candidateIDs);
  const seen = new Set<string>();
  const validateItems = (items: unknown[]): ValidatedOutputItem[] =>
    items.map((item) => {
      if (!isRecord(item) || !hasExactKeys(item, ["id", "reason"])) {
        return invalidOutput("Recommendation item fields are invalid");
      }
      if (
        typeof item.id !== "string" ||
        !expected.has(item.id) ||
        seen.has(item.id)
      ) {
        return invalidOutput("Recommendation item ID is unknown or duplicated");
      }
      if (typeof item.reason !== "string")
        return invalidOutput("Recommendation reason is invalid");
      const reason = item.reason.trim();
      if (
        !reason ||
        /[\r\n\u2028\u2029]/u.test(reason) ||
        [...reason].length > 240
      ) {
        return invalidOutput(
          "Recommendation reason is empty, multiline, or too long",
        );
      }
      seen.add(item.id);
      return { id: item.id, reason };
    });
  const priority = validateItems(value.priority);
  const optional = validateItems(value.optional);
  if (seen.size !== expected.size)
    return invalidOutput(
      "Recommendation output does not cover every candidate",
    );
  return { priority, optional };
}

function invalidOutput(message: string, cause?: unknown): never {
  throw new RecommendationAnalysisError("analysis_invalid_output", message, {
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => keys.includes(key))
  );
}
