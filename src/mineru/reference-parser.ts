import { MinerUContractError, type ReferenceEntry } from "../domain/reference";

type EntryMarker = Readonly<{
  style: "bracket" | "numeric";
  sourceLabel: string;
  punctuation?: "." | ")";
}>;

export type ReferenceNormalization = Readonly<{
  fullMarkdown: string;
  contentListJson: string;
  inferredMarker?: Readonly<{ position: number; length: number }>;
}>;

const BRACKET_MARKER = /^(\s*)\[(\d+)\]\s*/u;
const NUMERIC_MARKER = /^(\s*)(\d+)([.)])\s+/u;

export function normalizeReferenceEntries(
  fullMarkdown: string,
  contentListJson: string,
): ReferenceNormalization {
  const parsed = parseContentList(contentListJson);
  const markers = parsed.references.map(({ text }) => tryParseMarker(text));
  const missing = markers.flatMap((marker, index) => (marker ? [] : [index]));
  if (missing.length === 0) {
    return { fullMarkdown, contentListJson };
  }
  if (missing.length !== 1) unsupportedMarker();

  const missingIndex = missing[0]!;
  const previous = markers[missingIndex - 1];
  const next = markers[missingIndex + 1];
  if (
    !previous ||
    !next ||
    previous.style !== next.style ||
    Number(next.sourceLabel) - Number(previous.sourceLabel) !== 2
  ) {
    unsupportedMarker();
  }
  const raw = parsed.references[missingIndex]!.text;
  const normalized = prependMarker(
    raw,
    Number(previous.sourceLabel) + 1,
    previous,
  );
  let searchStart = 0;
  for (let index = 0; index < missingIndex; index += 1) {
    const text = parsed.references[index]!.text;
    const position = fullMarkdown.indexOf(text, searchStart);
    if (position < 0) entryDoesNotMatch();
    searchStart = position + text.length;
  }
  const rawStart = fullMarkdown.indexOf(raw, searchStart);
  const normalizedStart = fullMarkdown.indexOf(normalized, searchStart);
  const alreadyNormalized =
    normalizedStart >= 0 && (rawStart < 0 || normalizedStart <= rawStart);
  const entryStart = alreadyNormalized ? normalizedStart : rawStart;
  if (entryStart < 0) entryDoesNotMatch();
  const fullMarkdownWithMarker = alreadyNormalized
    ? fullMarkdown
    : `${fullMarkdown.slice(0, entryStart)}${normalized}${fullMarkdown.slice(entryStart + raw.length)}`;
  const markerLength = normalized.length - raw.length;
  const normalizedBlocks = [...parsed.blocks];
  const blockIndex = parsed.references[missingIndex]!.blockIndex;
  normalizedBlocks[blockIndex] = {
    ...(normalizedBlocks[blockIndex] as Record<string, unknown>),
    text: normalized,
  };

  return {
    fullMarkdown: fullMarkdownWithMarker,
    contentListJson: JSON.stringify(normalizedBlocks),
    inferredMarker: { position: entryStart, length: markerLength },
  };
}

export function parseReferenceEntries(
  fullMarkdown: string,
  contentListJson: string,
): readonly ReferenceEntry[] {
  const referenceTexts = parseReferenceTexts(contentListJson);
  if (referenceTexts.length === 0) {
    throw new MinerUContractError(
      "references-section-empty",
      "The MinerU content list has no Reference entries",
    );
  }

  const markers = referenceTexts.map(parseMarker);
  const style = markers[0]!.style;
  if (markers.some((marker) => marker.style !== style)) {
    throw new MinerUContractError(
      "references-marker-mixed",
      "The References section mixes marker styles",
    );
  }

  let searchStart = 0;
  return referenceTexts.map((rawMarkdown, ordinal) => {
    const charStart = fullMarkdown.indexOf(rawMarkdown, searchStart);
    if (charStart < 0) {
      throw new MinerUContractError(
        "references-entry-structure-unsupported",
        "A MinerU Reference entry does not match full.md",
      );
    }
    const charEnd = charStart + rawMarkdown.length;
    searchStart = charEnd;
    const marker = markers[ordinal]!;
    const markerPattern =
      marker.style === "bracket" ? BRACKET_MARKER : NUMERIC_MARKER;

    return {
      ordinal,
      sourceLabel: marker.sourceLabel,
      rawMarkdown,
      lookupText: rawMarkdown.replace(markerPattern, "").trim(),
      charStart,
      charEnd,
    };
  });
}

function parseReferenceTexts(contentListJson: string): readonly string[] {
  return parseContentList(contentListJson).references.map(({ text }) => text);
}

function parseContentList(contentListJson: string): Readonly<{
  blocks: readonly unknown[];
  references: readonly Readonly<{ blockIndex: number; text: string }>[];
}> {
  let contentList: unknown;
  try {
    contentList = JSON.parse(contentListJson);
  } catch {
    throw invalidCache("The MinerU content list is not valid JSON");
  }
  if (!Array.isArray(contentList)) {
    throw invalidCache("The MinerU content list is not a JSON array");
  }

  const references: Array<{ blockIndex: number; text: string }> = [];
  for (const [blockIndex, block] of contentList.entries()) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw invalidCache("The MinerU content list contains an invalid block");
    }
    const record = block as Record<string, unknown>;
    if (record.type !== "ref_text") continue;
    if (typeof record.text !== "string" || !record.text.trim()) {
      throw invalidCache("A MinerU Reference block has invalid text");
    }
    references.push({ blockIndex, text: record.text });
  }
  return { blocks: contentList, references };
}

function parseMarker(referenceText: string): EntryMarker {
  const marker = tryParseMarker(referenceText);
  if (marker) return marker;
  return unsupportedMarker();
}

function tryParseMarker(referenceText: string): EntryMarker | undefined {
  const bracket = BRACKET_MARKER.exec(referenceText);
  if (bracket) {
    return { style: "bracket", sourceLabel: bracket[2]! };
  }
  const numeric = NUMERIC_MARKER.exec(referenceText);
  if (numeric) {
    return {
      style: "numeric",
      sourceLabel: numeric[2]!,
      punctuation: numeric[3] as "." | ")",
    };
  }
  return undefined;
}

function prependMarker(
  referenceText: string,
  sourceLabel: number,
  previous: EntryMarker,
): string {
  const indentation = /^[\t ]*/u.exec(referenceText)?.[0] ?? "";
  const marker =
    previous.style === "bracket"
      ? `[${sourceLabel}] `
      : `${sourceLabel}${previous.punctuation ?? "."} `;
  return `${indentation}${marker}${referenceText.slice(indentation.length)}`;
}

function unsupportedMarker(): never {
  throw new MinerUContractError(
    "references-entry-structure-unsupported",
    "A MinerU Reference entry has no supported marker",
  );
}

function entryDoesNotMatch(): never {
  throw new MinerUContractError(
    "references-entry-structure-unsupported",
    "A MinerU Reference entry does not match full.md",
  );
}

function invalidCache(message: string): MinerUContractError {
  return new MinerUContractError("md-cache-invalid", message);
}
