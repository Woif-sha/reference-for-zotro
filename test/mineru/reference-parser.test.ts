import assert from "node:assert/strict";
import test from "node:test";

import {
  MinerUContractError,
  type MinerUErrorCode,
} from "../../src/domain/reference";
import {
  normalizeReferenceEntries,
  parseReferenceEntries,
} from "../../src/mineru/reference-parser";

test("parses canonical Reference entries in semantic encounter order", () => {
  const first = "[1] First paper continued metadata";
  const tenth = "[10] Tenth paper";
  const ninth = "[9] Ninth paper";
  const fullMarkdown = ["# Paper", first, tenth, ninth].join("\n\n");

  const entries = parseReferenceEntries(
    fullMarkdown,
    contentList(first, tenth, ninth),
  );

  assert.deepEqual(entries, [
    {
      ordinal: 0,
      sourceLabel: "1",
      lookupText: "First paper continued metadata",
    },
    { ordinal: 1, sourceLabel: "10", lookupText: "Tenth paper" },
    { ordinal: 2, sourceLabel: "9", lookupText: "Ninth paper" },
  ]);
});

test("normalizes marker, whitespace, markup, quotes, escapes and identifier spacing", () => {
  const raw =
    "1)  Smith, J. &amp; Doe, A. <sup>2024</sup>. “A  title,” https: //doi.org/10.1000/ example\\_id";
  const normalized = normalizeReferenceEntries(raw, contentList(raw));
  const expected =
    '[1] Smith, J. & Doe, A. 2024. "A title," https://doi.org/10.1000/example_id';

  assert.equal(normalized.fullMarkdown, expected);
  assert.deepEqual(JSON.parse(normalized.contentListJson), [
    { type: "ref_text", text: expected },
  ]);
  assert.deepEqual(
    parseReferenceEntries(expected, normalized.contentListJson),
    [
      {
        ordinal: 0,
        sourceLabel: "1",
        lookupText:
          'Smith, J. & Doe, A. 2024. "A title," https://doi.org/10.1000/example_id',
      },
    ],
  );
});

test("merges MinerU continuation blocks into one canonical Reference line", () => {
  const first = "[8] Michael Hofmann. Modeling negative capacitance";
  const continuation =
    "field-effect transistors. In 2017 IEEE Conference. 1–4.";
  const second = "[9] Eric Jones. SciPy.";
  const markdown = [first, "", continuation, "", second].join("\n");
  const normalized = normalizeReferenceEntries(
    markdown,
    contentList(first, continuation, second),
  );

  assert.equal(
    normalized.fullMarkdown,
    "[8] Michael Hofmann. Modeling negative capacitance field-effect transistors. In 2017 IEEE Conference. 1–4.\n\n[9] Eric Jones. SciPy.",
  );
  assert.deepEqual(
    (
      JSON.parse(normalized.contentListJson) as Array<Record<string, unknown>>
    ).map((block) => block.text),
    [
      "[8] Michael Hofmann. Modeling negative capacitance field-effect transistors. In 2017 IEEE Conference. 1–4.",
      "[9] Eric Jones. SciPy.",
    ],
  );
});

test("infers one missing marker only from a unique adjacent sequence", () => {
  const eighth = "8. LightGBM";
  const ninth = "CatBoost";
  const tenth = "10. SIFT";
  const markdown = [eighth, ninth, tenth].join("\n");
  const normalized = normalizeReferenceEntries(
    markdown,
    contentList(eighth, ninth, tenth),
  );

  assert.equal(
    normalized.fullMarkdown,
    "[8] LightGBM\n[9] CatBoost\n[10] SIFT",
  );
});

test("demotes unnumbered trailing material instead of treating it as a Reference", () => {
  const reference = "1. A paper";
  const note = "Publisher's Note: this is not a bibliography entry.";
  const markdown = `${reference}\n\n${note}`;
  const normalized = normalizeReferenceEntries(
    markdown,
    contentList(reference, note),
  );

  assert.equal(normalized.fullMarkdown, `[1] A paper\n\n${note}`);
  assert.deepEqual(JSON.parse(normalized.contentListJson), [
    { type: "ref_text", text: "[1] A paper" },
    { type: "text", text: note },
  ]);
});

test("normalization is idempotent", () => {
  const raw = "1. Smith. <sub>A</sub> title. https: //example.test/a";
  const first = normalizeReferenceEntries(raw, contentList(raw));
  const second = normalizeReferenceEntries(
    first.fullMarkdown,
    first.contentListJson,
  );

  assert.equal(second.fullMarkdown, first.fullMarkdown);
  assert.equal(second.contentListJson, first.contentListJson);
  assert.deepEqual(second.edits, []);
});

test("rejects invalid content lists and unsupported Reference structures", () => {
  const cases: readonly [string, string, MinerUErrorCode][] = [
    ["# Paper", "[]", "references-section-empty"],
    [
      "Author. Title. 2024.",
      contentList("Author. Title. 2024."),
      "references-entry-structure-unsupported",
    ],
    [
      "[1] Actual",
      contentList("[1] Different"),
      "references-entry-structure-unsupported",
    ],
    ["# Paper", "not json", "md-cache-invalid"],
    ["# Paper", "{}", "md-cache-invalid"],
    ["# Paper", "[null]", "md-cache-invalid"],
    [
      "# Paper",
      JSON.stringify([{ type: "ref_text", text: "" }]),
      "md-cache-invalid",
    ],
  ];

  for (const [markdown, semanticBlocks, code] of cases) {
    const operation =
      code === "references-section-empty"
        ? () => parseReferenceEntries(markdown, semanticBlocks)
        : () => normalizeReferenceEntries(markdown, semanticBlocks);
    assertMinerUCode(operation, code);
  }
});

function contentList(...references: readonly string[]): string {
  return JSON.stringify(references.map((text) => ({ type: "ref_text", text })));
}

function assertMinerUCode(
  operation: () => unknown,
  code: MinerUErrorCode,
): void {
  assert.throws(
    operation,
    (error) => error instanceof MinerUContractError && error.code === code,
  );
}
