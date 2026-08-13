import assert from "node:assert/strict";
import test from "node:test";

import {
  loadMineruReferences,
  type MinerUPorts,
  type MinerUReadResult,
} from "../../src/mineru/mineru-adapter";
import { MinerUContractError } from "../../src/domain/reference";

const DATA_DIRECTORY = "ZOTERO_DATA";
const ATTACHMENT_ID = 42;
const CACHE_DIRECTORY = `${DATA_DIRECTORY}/llm-for-zotero-mineru/${ATTACHMENT_ID}`;

test("loads references when MinerU classifies the heading as a page header", async () => {
  const fullMarkdown = [
    "## V. CONCLUSION",
    "",
    "Conclusion text.",
    "",
    "[1] First paper",
    "",
    "[2] Second paper",
  ].join("\n");
  const files = validFiles(fullMarkdown);
  files[`${CACHE_DIRECTORY}/content_list.json`] = {
    text: JSON.stringify([
      { type: "text", text: "V. CONCLUSION", text_level: 2 },
      { type: "text", text: "Conclusion text." },
      { type: "ref_text", text: "[1] First paper" },
      { type: "ref_text", text: "[2] Second paper" },
      { type: "header", text: "REFERENCES" },
    ]),
    revision: "content-list-v1",
  };

  const result = await loadMineruReferences(ATTACHMENT_ID, createPorts(files));

  assert.deepEqual(
    result.entries.map(({ sourceLabel, lookupText }) => ({
      sourceLabel,
      lookupText,
    })),
    [
      { sourceLabel: "1", lookupText: "First paper" },
      { sourceLabel: "2", lookupText: "Second paper" },
    ],
  );
});

test("silently numbers an unmarked Reference entry and persists one consistent cache", async () => {
  const unmarked =
    "Prokhorenkova, L. et al. CatBoost: unbiased boosting with categorical features.";
  const fullMarkdown = [
    "## References",
    "8. LightGBM",
    unmarked,
    "10. SIFT",
  ].join("\n");
  const files = validFiles(fullMarkdown);
  const contentListPath = `${CACHE_DIRECTORY}/content_list.json`;
  files[contentListPath] = {
    text: JSON.stringify([
      { type: "ref_text", text: "8. LightGBM" },
      { type: "ref_text", text: unmarked },
      { type: "ref_text", text: "10. SIFT" },
    ]),
    revision: "content-list-with-missing-marker",
  };
  const base = createPorts(files);
  const writes: string[] = [];
  const ports: MinerUPorts = {
    ...base,
    files: {
      ...base.files,
      async writeUtf8(path, text) {
        writes.push(path);
        await base.files.writeUtf8(path, text);
      },
    },
  };

  const result = await loadMineruReferences(ATTACHMENT_ID, ports);

  assert.deepEqual(
    result.entries.map(({ sourceLabel, rawMarkdown, lookupText }) => ({
      sourceLabel,
      rawMarkdown,
      lookupText,
    })),
    [
      {
        sourceLabel: "8",
        rawMarkdown: "8. LightGBM",
        lookupText: "LightGBM",
      },
      {
        sourceLabel: "9",
        rawMarkdown: `9. ${unmarked}`,
        lookupText: unmarked,
      },
      { sourceLabel: "10", rawMarkdown: "10. SIFT", lookupText: "SIFT" },
    ],
  );
  assert.equal(
    files[`${CACHE_DIRECTORY}/full.md`]?.text,
    fullMarkdown.replace(unmarked, `9. ${unmarked}`),
  );
  assert.deepEqual(JSON.parse(files[contentListPath]!.text), [
    { type: "ref_text", text: "8. LightGBM" },
    { type: "ref_text", text: `9. ${unmarked}` },
    { type: "ref_text", text: "10. SIFT" },
  ]);
  assert.deepEqual(
    JSON.parse(files[`${CACHE_DIRECTORY}/manifest.json`]!.text),
    {
      totalChars: fullMarkdown.length + 3,
      sections: [{ charStart: 0, charEnd: fullMarkdown.length + 3 }],
    },
  );
  assert.deepEqual(writes, [
    `${CACHE_DIRECTORY}/full.md`,
    `${CACHE_DIRECTORY}/manifest.json`,
    `${CACHE_DIRECTORY}/content_list.json`,
  ]);

  await loadMineruReferences(ATTACHMENT_ID, ports);
  assert.equal(writes.length, 3);
});

test("does not guess an unmarked Reference number without a unique sequence", async () => {
  const fullMarkdown = [
    "## References",
    "1. First",
    "Unmarked reference",
    "4. Fourth",
  ].join("\n");
  const files = validFiles(fullMarkdown);
  files[`${CACHE_DIRECTORY}/content_list.json`] = {
    text: JSON.stringify([
      { type: "ref_text", text: "1. First" },
      { type: "ref_text", text: "Unmarked reference" },
      { type: "ref_text", text: "4. Fourth" },
    ]),
    revision: "content-list-with-ambiguous-marker",
  };

  await assertRejectsWithCode(
    loadMineruReferences(ATTACHMENT_ID, createPorts(files)),
    "references-entry-structure-unsupported",
  );
});

test("loads references only from the validated current attachment MinerU cache", async () => {
  const fullMarkdown = "## References\n[1] First paper\n[2] Second paper";
  const files = validFiles(fullMarkdown);
  const ports = createPorts(files);

  const result = await loadMineruReferences(ATTACHMENT_ID, ports);

  assert.deepEqual(result.identity, {
    libraryID: 7,
    parentItemKey: "PARENT01",
    attachmentID: 42,
    attachmentKey: "ATTACH01",
  });
  assert.equal(result.fullMarkdown, fullMarkdown);
  assert.equal(result.fullMdSha256, "known-full-md-sha256");
  assert.equal(result.sourceFingerprint, "known-full-md-sha256");
  assert.deepEqual(
    result.entries.map(({ sourceLabel, lookupText }) => ({
      sourceLabel,
      lookupText,
    })),
    [
      { sourceLabel: "1", lookupText: "First paper" },
      { sourceLabel: "2", lookupText: "Second paper" },
    ],
  );
});

test("surfaces cache inspection failures as an explicit invalid-cache state", async () => {
  const ports = createPorts(validFiles("## References\n[1] First"));
  const failingPorts: MinerUPorts = {
    ...ports,
    files: {
      ...ports.files,
      exists: async () => {
        throw new Error("disk unavailable");
      },
    },
  };

  await assert.rejects(
    loadMineruReferences(ATTACHMENT_ID, failingPorts),
    (error) =>
      error instanceof MinerUContractError && error.code === "md-cache-invalid",
  );
});

test("distinguishes an ungenerated cache from a partially missing cache", async () => {
  await assertRejectsWithCode(
    loadMineruReferences(ATTACHMENT_ID, createPorts({})),
    "md-not-generated",
  );

  const files = validFiles("## References\n[1] First");
  delete files[`${CACHE_DIRECTORY}/manifest.json`];
  await assert.rejects(
    loadMineruReferences(ATTACHMENT_ID, createPorts(files)),
    (error) =>
      error instanceof MinerUContractError &&
      error.code === "md-cache-incomplete" &&
      assert.deepEqual(error.filenames, ["manifest.json"]) === undefined,
  );

  const missingContentList = validFiles("## References\n[1] First");
  delete missingContentList[`${CACHE_DIRECTORY}/content_list.json`];
  await assert.rejects(
    loadMineruReferences(ATTACHMENT_ID, createPorts(missingContentList)),
    (error) =>
      error instanceof MinerUContractError &&
      error.code === "md-cache-incomplete" &&
      assert.deepEqual(error.filenames, ["content_list.json"]) === undefined,
  );
});

test("rejects Reader items that are not the exact live attachment and parent pair", async () => {
  const valid = createPorts(validFiles("## References\n[1] First"));
  const invalidItems: readonly MinerUPorts["items"][] = [
    { get: () => undefined },
    {
      get: (id) =>
        id === ATTACHMENT_ID
          ? {
              id,
              key: "ATTACH01",
              libraryID: 7,
              parentItemID: 24,
              isAttachment: false,
            }
          : undefined,
    },
    {
      get: (id) =>
        id === ATTACHMENT_ID
          ? {
              id,
              key: "ATTACH01",
              libraryID: 7,
              parentItemID: null,
              isAttachment: true,
            }
          : undefined,
    },
    {
      get: (id) =>
        id === ATTACHMENT_ID
          ? {
              id,
              key: "ATTACH01",
              libraryID: 7,
              parentItemID: 24,
              isAttachment: true,
            }
          : id === 24
            ? {
                id,
                key: "PARENT01",
                libraryID: 7,
                parentItemID: null,
                isAttachment: true,
              }
            : undefined,
    },
  ];

  for (const items of invalidItems) {
    await assertRejectsWithCode(
      loadMineruReferences(ATTACHMENT_ID, { ...valid, items }),
      "unsupported-reader-item",
    );
  }
});

test("rejects every invalid provenance dimension", async () => {
  const invalidValues: ReadonlyArray<readonly [string, unknown]> = [
    ["kind", "other"],
    ["version", 1],
    ["attachmentId", 41],
    ["attachmentKey", "WRONGKEY"],
    ["parentItemKey", "WRONGPAR"],
    ["origin", "imported"],
    ["recordedAt", "not-a-date"],
  ];

  for (const [field, value] of invalidValues) {
    const files = validFiles("## References\n[1] First");
    const path = `${CACHE_DIRECTORY}/_llm_source.json`;
    const provenance = JSON.parse(files[path]!.text) as Record<string, unknown>;
    provenance[field] = value;
    files[path] = {
      ...files[path]!,
      text: JSON.stringify(provenance),
    };
    await assertRejectsWithCode(
      loadMineruReferences(ATTACHMENT_ID, createPorts(files)),
      "md-cache-invalid",
    );
  }
});

test("validates manifest length as UTF-16 and rejects invalid section ranges", async () => {
  const fullMarkdown = "😀\n## References\n[1] First";
  const valid = validFiles(fullMarkdown);
  const result = await loadMineruReferences(ATTACHMENT_ID, createPorts(valid));
  assert.equal(result.fullMarkdown.length, fullMarkdown.length);

  const invalidRanges = [
    [{ charStart: -1, charEnd: 1 }],
    [{ charStart: 4, charEnd: 3 }],
    [{ charStart: 0, charEnd: fullMarkdown.length + 1 }],
    [
      { charStart: 0, charEnd: 5 },
      { charStart: 4, charEnd: 6 },
    ],
  ];
  for (const sections of invalidRanges) {
    const files = validFiles(fullMarkdown);
    files[`${CACHE_DIRECTORY}/manifest.json`] = {
      text: JSON.stringify({ totalChars: fullMarkdown.length, sections }),
      revision: "manifest-invalid",
    };
    await assertRejectsWithCode(
      loadMineruReferences(ATTACHMENT_ID, createPorts(files)),
      "md-cache-invalid",
    );
  }

  const wrongLength = validFiles(fullMarkdown);
  wrongLength[`${CACHE_DIRECTORY}/manifest.json`] = {
    text: JSON.stringify({
      totalChars: [...fullMarkdown].length,
      sections: [],
    }),
    revision: "manifest-code-point-length",
  };
  await assertRejectsWithCode(
    loadMineruReferences(ATTACHMENT_ID, createPorts(wrongLength)),
    "md-cache-invalid",
  );
});

test("discards a cache or Reader identity that changes during preparation", async () => {
  const files = validFiles("## References\n[1] First");
  const base = createPorts(files);
  let markdownReads = 0;
  const changingCache: MinerUPorts = {
    ...base,
    files: {
      ...base.files,
      readUtf8: async (path) => {
        const value = await base.files.readUtf8(path);
        if (!path.endsWith("/full.md")) return value;
        markdownReads += 1;
        return markdownReads === 1
          ? value
          : { ...value, revision: "markdown-v2" };
      },
    },
  };
  await assertRejectsWithCode(
    loadMineruReferences(ATTACHMENT_ID, changingCache),
    "md-cache-invalid",
  );

  let attachmentReads = 0;
  const changingIdentity: MinerUPorts = {
    ...base,
    items: {
      get: (id) => {
        const item = base.items.get(id);
        if (id !== ATTACHMENT_ID || !item) return item;
        attachmentReads += 1;
        return attachmentReads === 1 ? item : { ...item, key: "CHANGED1" };
      },
    },
  };
  await assertRejectsWithCode(
    loadMineruReferences(ATTACHMENT_ID, changingIdentity),
    "md-cache-invalid",
  );
});

test("rechecks the live Reader identity after asynchronous hashing completes", async () => {
  const base = createPorts(validFiles("## References\n[1] First"));
  let changedDuringHash = false;
  const ports: MinerUPorts = {
    ...base,
    items: {
      get: (id) => {
        const item = base.items.get(id);
        return changedDuringHash && id === ATTACHMENT_ID && item
          ? { ...item, key: "CHANGED1" }
          : item;
      },
    },
    sha256: async () => {
      changedDuringHash = true;
      return "known-full-md-sha256";
    },
  };

  await assertRejectsWithCode(
    loadMineruReferences(ATTACHMENT_ID, ports),
    "md-cache-invalid",
  );
});

test("rejects a MinerU cache that changes while fingerprints are computed", async () => {
  const files = validFiles("## References\n[1] First");
  const base = createPorts(files);
  let hashCalls = 0;
  const ports: MinerUPorts = {
    ...base,
    sha256: async () => {
      hashCalls += 1;
      if (hashCalls === 1) {
        files[`${CACHE_DIRECTORY}/manifest.json`] = {
          ...files[`${CACHE_DIRECTORY}/manifest.json`]!,
          revision: "manifest-v2",
        };
      }
      return "known-full-md-sha256";
    },
  };

  await assertRejectsWithCode(
    loadMineruReferences(ATTACHMENT_ID, ports),
    "md-cache-invalid",
  );
});

test("includes the semantic content list in the source fingerprint", async () => {
  const fullMarkdown = "## References\n[1] First";
  const firstFiles = validFiles(fullMarkdown);
  const secondFiles = validFiles(fullMarkdown);
  const contentListPath = `${CACHE_DIRECTORY}/content_list.json`;
  secondFiles[contentListPath] = {
    text: JSON.stringify([
      { type: "ref_text", text: "[1] First" },
      { type: "footer", text: "Page 1" },
    ]),
    revision: "content-list-v2",
  };
  const firstPorts = createPorts(firstFiles);
  const secondPorts = createPorts(secondFiles);

  const first = await loadMineruReferences(ATTACHMENT_ID, {
    ...firstPorts,
    sha256: async (text) => text,
  });
  const second = await loadMineruReferences(ATTACHMENT_ID, {
    ...secondPorts,
    sha256: async (text) => text,
  });

  assert.equal(first.fullMdSha256, second.fullMdSha256);
  assert.notEqual(first.sourceFingerprint, second.sourceFingerprint);
});

test("reads only the validated MinerU cache contract", async () => {
  const fullMarkdown = "## References\n[1] First";
  const files = validFiles(fullMarkdown);
  const base = createPorts(files);
  const inspected = new Set<string>();
  const ports: MinerUPorts = {
    ...base,
    files: {
      ...base.files,
      exists: async (path) => {
        inspected.add(path);
        return base.files.exists(path);
      },
      readUtf8: async (path) => {
        inspected.add(path);
        return base.files.readUtf8(path);
      },
    },
  };

  await loadMineruReferences(ATTACHMENT_ID, ports);

  assert.deepEqual(
    [...inspected].sort(),
    [
      `${CACHE_DIRECTORY}/_llm_source.json`,
      `${CACHE_DIRECTORY}/content_list.json`,
      `${CACHE_DIRECTORY}/full.md`,
      `${CACHE_DIRECTORY}/manifest.json`,
    ].sort(),
  );
});

function validFiles(fullMarkdown: string): Record<string, MinerUReadResult> {
  return {
    [`${CACHE_DIRECTORY}/_llm_source.json`]: {
      text: JSON.stringify({
        kind: "llm-for-zotero/mineru-cache-source",
        version: 2,
        attachmentId: 42,
        attachmentKey: "ATTACH01",
        parentItemKey: "PARENT01",
        origin: "parsed",
        recordedAt: "2026-07-30T00:00:00.000Z",
      }),
      revision: "source-v1",
    },
    [`${CACHE_DIRECTORY}/full.md`]: {
      text: fullMarkdown,
      revision: "markdown-v1",
    },
    [`${CACHE_DIRECTORY}/manifest.json`]: {
      text: JSON.stringify({
        totalChars: fullMarkdown.length,
        sections: [{ charStart: 0, charEnd: fullMarkdown.length }],
      }),
      revision: "manifest-v1",
    },
    [`${CACHE_DIRECTORY}/content_list.json`]: {
      text: JSON.stringify(
        fullMarkdown
          .split(/\r\n|\r|\n/u)
          .filter((line) => /^\s*(?:\[\d+\]|\d+[.)])\s+/u.test(line))
          .map((text) => ({ type: "ref_text", text: text.trimStart() })),
      ),
      revision: "content-list-v1",
    },
  };
}

function createPorts(files: Record<string, MinerUReadResult>): MinerUPorts {
  return {
    dataDirectory: DATA_DIRECTORY,
    items: {
      get: (itemID) => {
        if (itemID === 42) {
          return {
            id: 42,
            key: "ATTACH01",
            libraryID: 7,
            parentItemID: 24,
            isAttachment: true,
          };
        }
        if (itemID === 24) {
          return {
            id: 24,
            key: "PARENT01",
            libraryID: 7,
            parentItemID: null,
            isAttachment: false,
          };
        }
        return undefined;
      },
    },
    files: {
      join: (...segments) => segments.join("/"),
      exists: async (path) => path in files,
      readUtf8: async (path) => {
        const result = files[path];
        if (!result) throw new Error(`Unexpected read: ${path}`);
        return result;
      },
      writeUtf8: async (path, text) => {
        files[path] = { text, revision: `written:${text.length}` };
      },
    },
    sha256: async () => "known-full-md-sha256",
  };
}

async function assertRejectsWithCode(
  promise: Promise<unknown>,
  code: MinerUContractError["code"],
): Promise<void> {
  await assert.rejects(
    promise,
    (error) => error instanceof MinerUContractError && error.code === code,
  );
}
