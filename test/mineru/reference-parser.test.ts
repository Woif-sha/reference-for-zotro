import assert from "node:assert/strict";
import test from "node:test";

import {
  MinerUContractError,
  type MinerUErrorCode,
} from "../../src/domain/reference";
import { parseReferenceEntries } from "../../src/mineru/reference-parser";

test("parses semantic MinerU Reference blocks in encounter order", () => {
  const first = "[1] First paper\ncontinued metadata";
  const tenth = "[10] Tenth paper";
  const ninth = "[9] Ninth paper";
  const fullMarkdown = [
    "# Paper",
    "",
    "## References",
    "",
    first,
    "",
    tenth,
    ninth,
    "",
    "## Appendix",
    "[99] Not a reference",
  ].join("\n");

  const entries = parseReferenceEntries(
    fullMarkdown,
    contentList(first, tenth, ninth),
  );

  assert.deepEqual(
    entries.map(({ ordinal, sourceLabel, lookupText }) => ({
      ordinal,
      sourceLabel,
      lookupText,
    })),
    [
      {
        ordinal: 0,
        sourceLabel: "1",
        lookupText: "First paper\ncontinued metadata",
      },
      { ordinal: 1, sourceLabel: "10", lookupText: "Tenth paper" },
      { ordinal: 2, sourceLabel: "9", lookupText: "Ninth paper" },
    ],
  );
  assert.equal(entries[0]?.rawMarkdown, first);
  assert.equal(
    fullMarkdown.slice(entries[0]?.charStart, entries[0]?.charEnd),
    entries[0]?.rawMarkdown,
  );
});

test("does not require a Markdown heading when MinerU typed the Reference blocks", () => {
  const first = "[1] First paper";
  const second = "[2] Second paper";
  const markdown = ["## V. CONCLUSION", "Conclusion text.", first, second].join(
    "\n\n",
  );
  const semanticBlocks = JSON.stringify([
    { type: "text", text: "V. CONCLUSION", text_level: 2 },
    { type: "text", text: "Conclusion text." },
    { type: "ref_text", text: first },
    { type: "ref_text", text: second },
    { type: "header", text: "REFERENCES" },
  ]);

  const entries = parseReferenceEntries(markdown, semanticBlocks);

  assert.deepEqual(
    entries.map(({ sourceLabel, lookupText }) => ({
      sourceLabel,
      lookupText,
    })),
    [
      { sourceLabel: "1", lookupText: "First paper" },
      { sourceLabel: "2", lookupText: "Second paper" },
    ],
  );
});

test("preserves carriage returns and supports numeric entry markers", () => {
  const first = "1) First\rcontinued";
  const second = "2. Second";
  const markdown = `# Paper\r${first}\r${second}`;

  const entries = parseReferenceEntries(markdown, contentList(first, second));

  assert.deepEqual(
    entries.map(({ sourceLabel, lookupText }) => ({
      sourceLabel,
      lookupText,
    })),
    [
      { sourceLabel: "1", lookupText: "First\rcontinued" },
      { sourceLabel: "2", lookupText: "Second" },
    ],
  );
});

test("preserves exact Reference text and source offsets", () => {
  const rawReference =
    "[123456] **Title** https://example.test/a\\_b?x=1&amp;y=2\n\ncontinued";
  const markdown = `Preface\n\n${rawReference}\n\nFooter`;

  const [entry] = parseReferenceEntries(markdown, contentList(rawReference));

  assert.equal(entry?.rawMarkdown, rawReference);
  assert.equal(
    entry?.lookupText,
    "**Title** https://example.test/a\\_b?x=1&amp;y=2\n\ncontinued",
  );
  assert.equal(markdown.slice(entry?.charStart, entry?.charEnd), rawReference);
});

test("rejects invalid content lists and inconsistent Reference structures", () => {
  const cases: readonly [string, string, MinerUErrorCode][] = [
    ["# Paper", "[]", "references-section-empty"],
    [
      "Author. Title. 2024.",
      contentList("Author. Title. 2024."),
      "references-entry-structure-unsupported",
    ],
    [
      "[1] One\n2. Two",
      contentList("[1] One", "2. Two"),
      "references-marker-mixed",
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
    assertMinerUCode(
      () => parseReferenceEntries(markdown, semanticBlocks),
      code,
    );
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
