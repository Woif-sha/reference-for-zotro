import assert from "node:assert/strict";
import test from "node:test";

import type { RecommendationModelPort } from "../../src/model/configured-recommendation-model";
import { RelatedPaperRecommendationService } from "../../src/recommendation/related-paper-recommendation";
import type { ReaderPaper } from "../../src/reader/mountReaderSection";

test("one global model call ranks every abstract-bearing candidate and merges shared scholarly identities", async () => {
  const requests: Array<{ instructions: string; prompt: string }> = [];
  const model: RecommendationModelPort = {
    async generate(request) {
      requests.push(request);
      return {
        identity: {
          authMode: "openai_compatible",
          providerId: "provider-api",
          modelId: "model-api",
          model: "example-model",
          apiBase: "https://api.example.com/v1/chat/completions",
          effort: "",
        },
        text: JSON.stringify({
          schemaVersion: 1,
          priority: [
            {
              id: "paper-2",
              reason: "在相同数据上验证并扩展了当前论文的方法。",
            },
          ],
          optional: [{ id: "paper-1", reason: "提供当前论文采用的理论基础。" }],
        }),
      };
    },
  };
  const service = new RelatedPaperRecommendationService(model);

  const result = await service.recommend({
    currentPaper: {
      fullMarkdown: "# Current paper\n\nComplete MinerU Markdown.",
      fullMdSha256: "full-md-sha256",
      sourceFingerprint: "source-fingerprint",
    },
    references: [
      paper("reference:0", "Theory", "10.1000/theory", "Theory abstract"),
      paper(
        "reference:1",
        "Reference version",
        "10.1000/shared",
        "Older abstract",
      ),
      paper("reference:2", "No abstract", "10.1000/empty", "  "),
    ],
    citingPapers: [
      paper(
        "citation:0",
        "Citation version",
        "10.1000/shared",
        "Current citing abstract",
      ),
    ],
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0]!.prompt), {
    schemaVersion: 1,
    currentPaperMarkdown: "# Current paper\n\nComplete MinerU Markdown.",
    candidates: [
      {
        id: "paper-1",
        sources: ["Reference"],
        title: "Theory",
        abstract: "Theory abstract",
      },
      {
        id: "paper-2",
        sources: ["Reference", "Citation"],
        title: "Citation version",
        abstract: "Current citing abstract",
      },
    ],
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.priority[0], {
    candidateKey: "doi:10.1000/shared",
    paperID: "citation:0",
    title: "Citation version",
    sources: ["reference", "citation"],
    reason: "在相同数据上验证并扩展了当前论文的方法。",
  });
  assert.equal(result.optional[0]?.candidateKey, "doi:10.1000/theory");
});

test("the complete model output is rejected when any strict schema rule fails", async () => {
  const invalidOutputs: Array<[string, unknown]> = [
    ["empty output", ""],
    [
      "Markdown fence",
      '```json\n{"schemaVersion":1,"priority":[],"optional":[]}\n```',
    ],
    [
      "root extra field",
      { schemaVersion: 1, priority: [], optional: [], score: 1 },
    ],
    ["wrong schema version", { schemaVersion: 2, priority: [], optional: [] }],
    [
      "item extra field",
      {
        schemaVersion: 1,
        priority: [{ id: "paper-1", reason: "具体关系。", score: 1 }],
        optional: [{ id: "paper-2", reason: "具体关系。" }],
      },
    ],
    [
      "unknown ID",
      {
        schemaVersion: 1,
        priority: [{ id: "paper-3", reason: "具体关系。" }],
        optional: [{ id: "paper-1", reason: "具体关系。" }],
      },
    ],
    [
      "duplicate and missing ID",
      {
        schemaVersion: 1,
        priority: [{ id: "paper-1", reason: "具体关系。" }],
        optional: [{ id: "paper-1", reason: "具体关系。" }],
      },
    ],
    [
      "empty reason",
      {
        schemaVersion: 1,
        priority: [{ id: "paper-1", reason: "  " }],
        optional: [{ id: "paper-2", reason: "具体关系。" }],
      },
    ],
    [
      "multiline reason",
      {
        schemaVersion: 1,
        priority: [{ id: "paper-1", reason: "第一行\n第二行" }],
        optional: [{ id: "paper-2", reason: "具体关系。" }],
      },
    ],
    [
      "reason over 240 Unicode code points",
      {
        schemaVersion: 1,
        priority: [{ id: "paper-1", reason: "😀".repeat(241) }],
        optional: [{ id: "paper-2", reason: "具体关系。" }],
      },
    ],
    [
      "more than five priority papers",
      {
        schemaVersion: 1,
        priority: Array.from({ length: 6 }, (_, index) => ({
          id: `paper-${index + 1}`,
          reason: "具体关系。",
        })),
        optional: [],
      },
    ],
  ];

  for (const [name, output] of invalidOutputs) {
    const papers = Array.from(
      { length: name === "more than five priority papers" ? 6 : 2 },
      (_, index) =>
        paper(
          `reference:${index}`,
          `Paper ${index + 1}`,
          `10.1000/paper-${index + 1}`,
          `Abstract ${index + 1}`,
        ),
    );
    const service = new RelatedPaperRecommendationService({
      async generate() {
        return {
          identity: {
            authMode: "codex_auth",
            providerId: "legacy",
            modelId: "codex",
            model: "gpt-5.4",
            apiBase: "https://chatgpt.com/backend-api/codex/responses",
            effort: "medium",
          },
          text: typeof output === "string" ? output : JSON.stringify(output),
        };
      },
    });

    await assert.rejects(
      service.recommend({
        currentPaper: {
          fullMarkdown: "Current paper",
          fullMdSha256: "sha",
          sourceFingerprint: "fingerprint",
        },
        references: papers,
        citingPapers: [],
      }),
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "analysis_invalid_output",
          name,
        );
        return true;
      },
      name,
    );
  }
});

test("empty candidates skip the model and oversized UTF-8 input fails without truncating or splitting", async () => {
  let calls = 0;
  const service = new RelatedPaperRecommendationService({
    async generate() {
      calls += 1;
      throw new Error("must not be called");
    },
  });

  assert.deepEqual(
    await service.recommend({
      currentPaper: {
        fullMarkdown: "Current paper",
        fullMdSha256: "sha",
        sourceFingerprint: "fingerprint",
      },
      references: [paper("reference:0", "Empty", "10.1000/empty", "  ")],
      citingPapers: [],
    }),
    { status: "no-candidates" },
  );
  await assert.rejects(
    service.recommend({
      currentPaper: {
        fullMarkdown: "论".repeat(384 * 1024),
        fullMdSha256: "sha",
        sourceFingerprint: "fingerprint",
      },
      references: [
        paper("reference:1", "Eligible", "10.1000/eligible", "Abstract"),
      ],
      citingPapers: [],
    }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "analysis_input_too_large",
      );
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("the whole analysis times out once and aborts the single model request", async () => {
  let modelSignal: AbortSignal | undefined;
  const service = new RelatedPaperRecommendationService(
    {
      async generate(request) {
        modelSignal = request.signal;
        return new Promise(() => undefined);
      },
    },
    { timeoutMs: 5 },
  );

  await assert.rejects(
    service.recommend({
      currentPaper: {
        fullMarkdown: "Current paper",
        fullMdSha256: "sha",
        sourceFingerprint: "fingerprint",
      },
      references: [
        paper("reference:0", "Eligible", "10.1000/eligible", "Abstract"),
      ],
      citingPapers: [],
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "analysis_timed_out");
      return true;
    },
  );
  assert.equal(modelSignal?.aborted, true);
});

test("visible model output over 32,768 characters fails as a whole", async () => {
  const service = new RelatedPaperRecommendationService({
    async generate() {
      return {
        identity: {
          authMode: "codex_auth",
          providerId: "legacy",
          modelId: "codex",
          model: "gpt-5.4",
          apiBase: "https://chatgpt.com/backend-api/codex/responses",
          effort: "medium",
        },
        text: "x".repeat(32_769),
      };
    },
  });

  await assert.rejects(
    service.recommend({
      currentPaper: {
        fullMarkdown: "Current paper",
        fullMdSha256: "sha",
        sourceFingerprint: "fingerprint",
      },
      references: [
        paper("reference:0", "Eligible", "10.1000/eligible", "Abstract"),
      ],
      citingPapers: [],
    }),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "analysis_output_too_large",
      );
      return true;
    },
  );
});

test("identity merging requires a shared non-conflicting stable identifier and retains a non-empty Reference abstract", async () => {
  let prompt: Record<string, unknown> | undefined;
  const service = new RelatedPaperRecommendationService({
    async generate(request) {
      prompt = JSON.parse(request.prompt) as Record<string, unknown>;
      return {
        identity: {
          authMode: "codex_auth",
          providerId: "legacy",
          modelId: "codex",
          model: "gpt-5.4",
          apiBase: "https://chatgpt.com/backend-api/codex/responses",
          effort: "medium",
        },
        text: JSON.stringify({
          schemaVersion: 1,
          priority: [],
          optional: [
            { id: "paper-1", reason: "共享 DOI，保留可用摘要。" },
            { id: "paper-2", reason: "没有共同稳定标识符。" },
            { id: "paper-3", reason: "没有共同稳定标识符。" },
            { id: "paper-4", reason: "标识符冲突，不进行合并。" },
            { id: "paper-5", reason: "标识符冲突，不进行合并。" },
          ],
        }),
      };
    },
  });
  const sharedReference = paper(
    "reference:0",
    "Shared ref",
    "10.1000/shared",
    "Reference abstract",
  );
  const sharedCitation = paper(
    "citation:0",
    "Shared cite",
    "10.1000/shared",
    " ",
  );
  const noIDReference = {
    ...paper("reference:1", "Same title", "10.1000/remove-a", "A"),
    doi: undefined,
  };
  const noIDCitation = {
    ...paper("citation:1", "Same title", "10.1000/remove-b", "B"),
    doi: undefined,
  };
  const conflictingReference = {
    ...paper("reference:2", "Conflict", "10.1000/conflict", "C"),
    arxivID: "2401.00001",
  };
  const conflictingCitation = {
    ...paper("citation:2", "Conflict", "10.1000/conflict", "D"),
    arxivID: "2401.00002",
  };

  await service.recommend({
    currentPaper: {
      fullMarkdown: "Current paper",
      fullMdSha256: "sha",
      sourceFingerprint: "fingerprint",
    },
    references: [sharedReference, noIDReference, conflictingReference],
    citingPapers: [sharedCitation, noIDCitation, conflictingCitation],
  });

  assert.deepEqual(prompt?.candidates, [
    {
      id: "paper-1",
      sources: ["Reference", "Citation"],
      title: "Shared cite",
      abstract: "Reference abstract",
    },
    {
      id: "paper-2",
      sources: ["Reference"],
      title: "Same title",
      abstract: "A",
    },
    { id: "paper-3", sources: ["Reference"], title: "Conflict", abstract: "C" },
    {
      id: "paper-4",
      sources: ["Citation"],
      title: "Same title",
      abstract: "B",
    },
    { id: "paper-5", sources: ["Citation"], title: "Conflict", abstract: "D" },
  ]);
});

test("a duplicate in one source remains eligible when any copy has a non-empty Abstract", async () => {
  let prompt: { candidates: unknown[] } | undefined;
  const service = new RelatedPaperRecommendationService({
    async generate(request) {
      prompt = JSON.parse(request.prompt) as { candidates: unknown[] };
      return {
        identity: {
          authMode: "codex_auth",
          providerId: "legacy",
          modelId: "codex",
          model: "gpt-5.4",
          apiBase: "https://chatgpt.com/backend-api/codex/responses",
          effort: "medium",
        },
        text: JSON.stringify({
          schemaVersion: 1,
          priority: [{ id: "paper-1", reason: "提供当前论文的直接理论基础。" }],
          optional: [],
        }),
      };
    },
  });

  await service.recommend({
    currentPaper: {
      fullMarkdown: "Current paper",
      fullMdSha256: "sha",
      sourceFingerprint: "fingerprint",
    },
    references: [
      paper("reference:0", "Empty copy", "10.1000/duplicate", " "),
      paper(
        "reference:1",
        "Complete copy",
        "10.1000/duplicate",
        "Complete abstract",
      ),
    ],
    citingPapers: [],
  });

  assert.deepEqual(prompt?.candidates, [
    {
      id: "paper-1",
      sources: ["Reference"],
      title: "Complete copy",
      abstract: "Complete abstract",
    },
  ]);
});

function paper(
  id: string,
  title: string,
  doi: string,
  abstract: string,
): ReaderPaper {
  return {
    id,
    ordinal: 0,
    title,
    doi,
    abstract,
    status: "resolved",
    primaryResultURL: `https://doi.org/${doi}`,
  };
}
