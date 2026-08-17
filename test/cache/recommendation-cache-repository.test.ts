import assert from "node:assert/strict";
import test from "node:test";

import {
  RecommendationCacheRepository,
  type RecommendationCacheIdentity,
  type RecommendationCacheStorage,
} from "../../src/cache/recommendation-cache-repository";

class MemoryStorage implements RecommendationCacheStorage {
  readonly values = new Map<string, string>();

  async read(directory: string): Promise<string | undefined> {
    return this.values.get(`${directory}/recommendation.json`);
  }

  async write(
    directory: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<void> {
    void signal;
    this.values.set(`${directory}/recommendation.json`, value);
  }
}

const identity: RecommendationCacheIdentity = {
  currentPaper: {
    libraryID: 3,
    attachmentID: 44,
    attachmentKey: "ABCDEFGH",
    parentItemKey: "PARENT01",
    sourceFingerprint: "source-fingerprint",
    fullMdSha256: "full-md-sha256",
  },
  visibleCandidates: [
    {
      candidateKey: "doi:10.1000/paper",
      paperID: "reference:0",
      title: "Paper",
      sources: ["reference"],
    },
  ],
  analyzedCandidates: [
    {
      candidateKey: "doi:10.1000/paper",
      abstract: "Paper abstract",
    },
  ],
  model: {
    authMode: "codex_auth",
    providerId: "provider-codex",
    modelId: "model-codex",
    model: "gpt-5.4",
    apiBase: "https://chatgpt.com/backend-api/codex/responses",
    effort: "medium",
  },
  promptVersion: 1,
};

const result = {
  priority: [
    {
      candidateKey: "doi:10.1000/paper",
      paperID: "reference:0",
      title: "Paper",
      sources: ["reference" as const],
      reason: "直接扩展当前论文的方法。",
    },
  ],
  optional: [],
};

test("recommendation cache uses one per-attachment file and restores the complete result", async () => {
  const storage = new MemoryStorage();
  const repository = new RecommendationCacheRepository(storage);

  await repository.write(identity, result);

  assert.deepEqual(
    [...storage.values.keys()],
    ["3-ABCDEFGH/recommendation.json"],
  );
  assert.deepEqual(await repository.read(identity), result);
  assert.match(
    storage.values.get("3-ABCDEFGH/recommendation.json") ?? "",
    /"abstract": "Paper abstract"/u,
  );
});

test("a previously analyzed Abstract may be absent after restart", async () => {
  const storage = new MemoryStorage();
  const repository = new RecommendationCacheRepository(storage);
  await repository.write(identity, result);

  assert.deepEqual(
    await repository.read({ ...identity, analyzedCandidates: [] }),
    result,
  );
});

test("an unknown recommendation schema is an explicit cache read error", async () => {
  const storage = new MemoryStorage();
  const repository = new RecommendationCacheRepository(storage);
  await repository.write(identity, result);
  const key = "3-ABCDEFGH/recommendation.json";
  const stored = JSON.parse(storage.values.get(key) ?? "{}") as Record<
    string,
    unknown
  >;
  storage.values.set(key, JSON.stringify({ ...stored, schemaVersion: 2 }));

  await assert.rejects(repository.read(identity), /schema/i);
});

test("illegal fields and damaged result sets are explicit cache read errors", async () => {
  const invalidFiles: Array<[string, (file: Record<string, unknown>) => void]> =
    [
      ["unknown root field", (file) => void (file.placeholder = true)],
      [
        "unknown candidate field",
        (file) => {
          const candidates = file.visibleCandidates as Record<
            string,
            unknown
          >[];
          candidates[0]!.score = 1;
        },
      ],
      [
        "duplicate result",
        (file) => {
          file.optional = file.priority;
        },
      ],
      [
        "missing result",
        (file) => {
          file.priority = [];
        },
      ],
    ];

  for (const [name, mutate] of invalidFiles) {
    const storage = new MemoryStorage();
    const repository = new RecommendationCacheRepository(storage);
    await repository.write(identity, result);
    const key = "3-ABCDEFGH/recommendation.json";
    const file = JSON.parse(storage.values.get(key) ?? "{}") as Record<
      string,
      unknown
    >;
    mutate(file);
    storage.values.set(key, JSON.stringify(file));

    await assert.rejects(repository.read(identity), /invalid|damaged/i, name);
  }
});

test("every recommendation identity field invalidates while secrets, generation time, and TTL do not participate", async () => {
  const storage = new MemoryStorage();
  const repository = new RecommendationCacheRepository(storage);
  await repository.write(identity, result);
  const changedIdentities: Array<[string, RecommendationCacheIdentity]> = [
    [
      "Current paper",
      {
        ...identity,
        currentPaper: { ...identity.currentPaper, attachmentID: 45 },
      },
    ],
    [
      "source fingerprint",
      {
        ...identity,
        currentPaper: {
          ...identity.currentPaper,
          sourceFingerprint: "changed-source",
        },
      },
    ],
    [
      "body SHA-256",
      {
        ...identity,
        currentPaper: {
          ...identity.currentPaper,
          fullMdSha256: "changed-body",
        },
      },
    ],
    [
      "visible candidate",
      {
        ...identity,
        visibleCandidates: [
          { ...identity.visibleCandidates[0]!, title: "Changed title" },
        ],
      },
    ],
    [
      "source set",
      {
        ...identity,
        visibleCandidates: [
          {
            ...identity.visibleCandidates[0]!,
            sources: ["reference", "citation"],
          },
        ],
      },
    ],
    [
      "known Abstract",
      {
        ...identity,
        analyzedCandidates: [
          {
            ...identity.analyzedCandidates[0]!,
            abstract: "Changed abstract",
          },
        ],
      },
    ],
    [
      "active model",
      { ...identity, model: { ...identity.model, model: "gpt-next" } },
    ],
    ["effort", { ...identity, model: { ...identity.model, effort: "high" } }],
    ["prompt version", { ...identity, promptVersion: 2 }],
  ];

  for (const [name, changed] of changedIdentities) {
    assert.equal(await repository.read(changed), undefined, name);
  }

  const key = "3-ABCDEFGH/recommendation.json";
  const file = JSON.parse(storage.values.get(key) ?? "{}") as Record<
    string,
    unknown
  >;
  file.generatedAt = "2099-01-01T00:00:00.000Z";
  storage.values.set(key, JSON.stringify(file));
  assert.deepEqual(await repository.read(identity), result);
  assert.doesNotMatch(storage.values.get(key) ?? "", /apiKey|expiresAt/u);
});

test("recommendations are isolated by validated library and attachment keys", async () => {
  const storage = new MemoryStorage();
  const repository = new RecommendationCacheRepository(storage);
  const otherIdentity: RecommendationCacheIdentity = {
    ...identity,
    currentPaper: {
      ...identity.currentPaper,
      libraryID: 4,
      attachmentID: 55,
      attachmentKey: "OTHER001",
    },
  };

  await repository.write(identity, result);
  await repository.write(otherIdentity, {
    priority: [],
    optional: result.priority,
  });

  assert.deepEqual(await repository.read(identity), result);
  assert.deepEqual(await repository.read(otherIdentity), {
    priority: [],
    optional: result.priority,
  });
  await assert.rejects(
    repository.write(
      {
        ...identity,
        currentPaper: { ...identity.currentPaper, attachmentKey: "../escape" },
      },
      result,
    ),
    /invalid|attachmentKey/iu,
  );
});
