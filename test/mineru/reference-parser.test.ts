import assert from "node:assert/strict";
import test from "node:test";

import {
  MinerUContractError,
  type MinerUErrorCode,
} from "../../src/domain/reference";
import { parseReferenceEntries } from "../../src/mineru/reference-parser";

test("parses the exact References heading and preserves Markdown encounter order", () => {
  const fullMarkdown = [
    "# Paper",
    "",
    "## References",
    "",
    "[1] First paper",
    "continued metadata",
    "",
    "[10] Tenth paper",
    "[9] Ninth paper",
    "",
    "## Appendix",
    "[99] Not a reference",
  ].join("\n");

  const entries = parseReferenceEntries(fullMarkdown);

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
  assert.equal(entries[0]?.rawMarkdown, "[1] First paper\ncontinued metadata");
  assert.equal(
    fullMarkdown.slice(entries[0]?.charStart, entries[0]?.charEnd),
    entries[0]?.rawMarkdown,
  );
});

test("treats carriage-return line endings as Markdown lines", () => {
  const entries = parseReferenceEntries(
    "# Paper\r  ### LITERATURE CITED  \r1) First\rcontinued\r2. Second",
  );

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

test("accepts only the four exact References heading names at levels one through six", () => {
  const cases = [
    "# References",
    "## reference",
    "### BIBLIOGRAPHY",
    "###### Literature Cited",
  ];

  for (const heading of cases) {
    assert.equal(
      parseReferenceEntries(`${heading}\n[1] Entry`)[0]?.lookupText,
      "Entry",
    );
  }
  assertMinerUCode(
    () => parseReferenceEntries("## References and notes\n[1] Entry"),
    "references-heading-missing",
  );
});

test("keeps deeper headings inside References and stops at the next peer heading", () => {
  const markdown = [
    "# Paper",
    "## References",
    "[1] Entry",
    "### Supplemental note",
    "continuation",
    "## Acknowledgements",
    "[2] Outside",
  ].join("\n");

  const [entry] = parseReferenceEntries(markdown);

  assert.equal(entry?.lookupText, "Entry\n### Supplemental note\ncontinuation");
});

test("preserves raw Markdown while removing only the marker from lookup text", () => {
  const markdown =
    "## References\n  [123456] **Title** https://example.test/a\\_b?x=1&amp;y=2\n\ncontinued";

  const [entry] = parseReferenceEntries(markdown);

  assert.equal(
    entry?.rawMarkdown,
    "[123456] **Title** https://example.test/a\\_b?x=1&amp;y=2\n\ncontinued",
  );
  assert.equal(
    entry?.lookupText,
    "**Title** https://example.test/a\\_b?x=1&amp;y=2\n\ncontinued",
  );
  assert.equal(
    markdown.slice(entry?.charStart, entry?.charEnd),
    entry?.rawMarkdown,
  );
});

test("fails the entire parse for ambiguous or unsupported References structures", () => {
  const cases: readonly [string, MinerUErrorCode][] = [
    ["# Paper", "references-heading-missing"],
    [
      "## References\n[1] One\n## Bibliography\n[2] Two",
      "references-heading-ambiguous",
    ],
    ["## References\n \n", "references-section-empty"],
    ["## References\n[1] One\n2. Two", "references-marker-mixed"],
    ["## References\npreface\n[1] One", "references-prefix-unparsed"],
    [
      "## References\nAuthor. Title. 2024.",
      "references-entry-structure-unsupported",
    ],
  ];

  for (const [markdown, code] of cases) {
    assertMinerUCode(() => parseReferenceEntries(markdown), code);
  }
});

function assertMinerUCode(
  operation: () => unknown,
  code: MinerUErrorCode,
): void {
  assert.throws(
    operation,
    (error) => error instanceof MinerUContractError && error.code === code,
  );
}
