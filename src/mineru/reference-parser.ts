import { decodeHTML } from "entities";

import { MinerUContractError, type ReferenceEntry } from "../domain/reference";

type EntryMarker = Readonly<{
  sourceLabel: string;
}>;

type ReferenceBlock = Readonly<{
  blockIndex: number;
  text: string;
}>;

type LocatedReferenceBlock = ReferenceBlock &
  Readonly<{
    charStart: number;
    charEnd: number;
    marker?: EntryMarker;
  }>;

export type ReferenceTextEdit = Readonly<{
  position: number;
  removedLength: number;
  insertedLength: number;
}>;

export type ReferenceNormalization = Readonly<{
  fullMarkdown: string;
  contentListJson: string;
  edits: readonly ReferenceTextEdit[];
}>;

const BRACKET_MARKER = /^(\s*)\[(\d+)\]\s*/u;
const NUMERIC_MARKER = /^(\s*)(\d+)[.)]\s+/u;

export function normalizeReferenceEntries(
  fullMarkdown: string,
  contentListJson: string,
): ReferenceNormalization {
  const parsed = parseContentList(contentListJson);
  if (parsed.references.length === 0) {
    return { fullMarkdown, contentListJson, edits: [] };
  }

  const located = locateReferenceBlocks(fullMarkdown, parsed.references);
  const markedIndexes = located.flatMap((block, index) =>
    block.marker ? [index] : [],
  );
  if (markedIndexes.length === 0) unsupportedMarker();

  const firstMarked = markedIndexes[0]!;
  const lastMarked = markedIndexes.at(-1)!;
  const groups: Array<{
    marker: EntryMarker;
    members: LocatedReferenceBlock[];
  }> = [];
  const nonReferenceBlocks = new Set<number>();

  for (const [index, block] of located.entries()) {
    if (block.marker) {
      groups.push({ marker: block.marker, members: [block] });
      continue;
    }
    if (index < firstMarked || index > lastMarked) {
      nonReferenceBlocks.add(block.blockIndex);
      continue;
    }
    const current = groups.at(-1);
    if (!current) unsupportedMarker();
    const nextMarked = located
      .slice(index + 1)
      .find((candidate) => candidate.marker);
    const sequenceGap = nextMarked?.marker
      ? Number(nextMarked.marker.sourceLabel) -
        Number(current.marker.sourceLabel)
      : 0;
    if (nextMarked?.marker && sequenceGap === 2) {
      groups.push({
        marker: { sourceLabel: String(Number(current.marker.sourceLabel) + 1) },
        members: [block],
      });
      continue;
    }
    if (sequenceGap !== 1) unsupportedMarker();
    current.members.push(block);
  }

  const replacements = groups.map((group) => {
    const first = group.members[0]!;
    const last = group.members.at(-1)!;
    const body = group.members
      .map((member) => removeMarker(member.text))
      .join(" ");
    const text = `[${group.marker.sourceLabel}] ${normalizeReferenceText(body)}`;
    return {
      group,
      text,
      position: first.charStart,
      removedLength: last.charEnd - first.charStart,
      insertedLength: text.length,
    };
  });

  let normalizedMarkdown = fullMarkdown;
  for (const replacement of [...replacements].reverse()) {
    normalizedMarkdown = `${normalizedMarkdown.slice(0, replacement.position)}${replacement.text}${normalizedMarkdown.slice(replacement.position + replacement.removedLength)}`;
  }

  const firstBlockByIndex = new Map(
    replacements.map((replacement) => [
      replacement.group.members[0]!.blockIndex,
      replacement.text,
    ]),
  );
  const continuationIndexes = new Set(
    replacements.flatMap((replacement) =>
      replacement.group.members.slice(1).map((member) => member.blockIndex),
    ),
  );
  const normalizedBlocks = parsed.blocks.flatMap((block, blockIndex) => {
    if (continuationIndexes.has(blockIndex)) return [];
    if (nonReferenceBlocks.has(blockIndex)) {
      return [{ ...(block as Record<string, unknown>), type: "text" }];
    }
    const text = firstBlockByIndex.get(blockIndex);
    return text === undefined
      ? [block]
      : [{ ...(block as Record<string, unknown>), text }];
  });

  return {
    fullMarkdown: normalizedMarkdown,
    contentListJson: JSON.stringify(normalizedBlocks),
    edits: replacements
      .filter(
        (replacement) =>
          fullMarkdown.slice(
            replacement.position,
            replacement.position + replacement.removedLength,
          ) !== replacement.text,
      )
      .map(({ position, removedLength, insertedLength }) => ({
        position,
        removedLength,
        insertedLength,
      })),
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

  let searchStart = 0;
  return referenceTexts.map((markdown, ordinal) => {
    const marker = parseCanonicalMarker(markdown);
    const charStart = fullMarkdown.indexOf(markdown, searchStart);
    if (charStart < 0) entryDoesNotMatch();
    searchStart = charStart + markdown.length;
    return {
      ordinal,
      sourceLabel: marker.sourceLabel,
      lookupText: markdown.replace(BRACKET_MARKER, "").trim(),
    };
  });
}

function normalizeReferenceText(value: string): string {
  const normalized = decodeHTML(value)
    .normalize("NFKC")
    .replace(/<\/?(?:sup|sub)>/giu, "")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/\\([\p{P}\p{S}])/gu, "$1")
    .replace(/\b(https?)\s*:\s*\/\s*\/\s*/giu, "$1://")
    .replace(/\b(https?)\s*:\s*\/\s+(?=[\p{L}\p{N}])/giu, "$1://")
    .replace(/\b(10\.\d{4,9}\/)\s+(?=[-._;()/:\p{L}\p{N}])/giu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  return normalizeBrokenUrlWhitespace(normalized);
}

function normalizeBrokenUrlWhitespace(value: string): string {
  return value.replace(
    /\bhttps?:\/\/.*?(?=(?:,\s*(?:accessed|retrieved|19\d{2}|20\d{2})\b|\s+\((?:accessed|retrieved)\b|$))/giu,
    (url) => url.replace(/\s+/gu, ""),
  );
}

function locateReferenceBlocks(
  fullMarkdown: string,
  references: readonly ReferenceBlock[],
): readonly LocatedReferenceBlock[] {
  let searchStart = 0;
  return references.map((reference) => {
    const charStart = fullMarkdown.indexOf(reference.text, searchStart);
    if (charStart < 0) entryDoesNotMatch();
    const charEnd = charStart + reference.text.length;
    searchStart = charEnd;
    return {
      ...reference,
      charStart,
      charEnd,
      marker: tryParseMarker(reference.text),
    };
  });
}

function parseReferenceTexts(contentListJson: string): readonly string[] {
  return parseContentList(contentListJson).references.map(({ text }) => text);
}

function parseContentList(contentListJson: string): Readonly<{
  blocks: readonly unknown[];
  references: readonly ReferenceBlock[];
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

  const references: ReferenceBlock[] = [];
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

function parseCanonicalMarker(referenceText: string): EntryMarker {
  const match = BRACKET_MARKER.exec(referenceText);
  if (!match) return unsupportedMarker();
  return { sourceLabel: match[2]! };
}

function tryParseMarker(referenceText: string): EntryMarker | undefined {
  const bracket = BRACKET_MARKER.exec(referenceText);
  if (bracket) return { sourceLabel: bracket[2]! };
  const numeric = NUMERIC_MARKER.exec(referenceText);
  return numeric ? { sourceLabel: numeric[2]! } : undefined;
}

function removeMarker(referenceText: string): string {
  return referenceText.replace(BRACKET_MARKER, "").replace(NUMERIC_MARKER, "");
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
