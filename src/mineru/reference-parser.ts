import { MinerUContractError, type ReferenceEntry } from "../domain/reference";

type EntryMarker = Readonly<{
  style: "bracket" | "numeric";
  sourceLabel: string;
}>;

const BRACKET_MARKER = /^(\s*)\[(\d+)\]\s*/u;
const NUMERIC_MARKER = /^(\s*)(\d+)[.)]\s+/u;

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
  let contentList: unknown;
  try {
    contentList = JSON.parse(contentListJson);
  } catch {
    throw invalidCache("The MinerU content list is not valid JSON");
  }
  if (!Array.isArray(contentList)) {
    throw invalidCache("The MinerU content list is not a JSON array");
  }

  const referenceTexts: string[] = [];
  for (const block of contentList) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw invalidCache("The MinerU content list contains an invalid block");
    }
    const record = block as Record<string, unknown>;
    if (record.type !== "ref_text") continue;
    if (typeof record.text !== "string" || !record.text.trim()) {
      throw invalidCache("A MinerU Reference block has invalid text");
    }
    referenceTexts.push(record.text);
  }
  return referenceTexts;
}

function parseMarker(referenceText: string): EntryMarker {
  const bracket = BRACKET_MARKER.exec(referenceText);
  if (bracket) {
    return { style: "bracket", sourceLabel: bracket[2]! };
  }
  const numeric = NUMERIC_MARKER.exec(referenceText);
  if (numeric) {
    return { style: "numeric", sourceLabel: numeric[2]! };
  }
  throw new MinerUContractError(
    "references-entry-structure-unsupported",
    "A MinerU Reference entry has no supported marker",
  );
}

function invalidCache(message: string): MinerUContractError {
  return new MinerUContractError("md-cache-invalid", message);
}
