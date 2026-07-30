import { MinerUContractError, type ReferenceEntry } from "../domain/reference";

type SourceLine = Readonly<{
  text: string;
  start: number;
  end: number;
}>;

type EntryMarker = Readonly<{
  style: "bracket" | "numeric";
  sourceLabel: string;
  markerStart: number;
}>;

const REFERENCE_HEADING =
  /^(#{1,6})[ \t]+(references|reference|bibliography|literature cited)[ \t]*$/iu;
const ANY_HEADING = /^(#{1,6})[ \t]+/u;
const BRACKET_MARKER = /^(\s*)\[(\d+)\]\s*/u;
const NUMERIC_MARKER = /^(\s*)(\d+)[.)]\s+/u;

export function parseReferenceEntries(
  fullMarkdown: string,
): readonly ReferenceEntry[] {
  const lines = splitSourceLines(fullMarkdown);
  const headings = lines.flatMap((line) => {
    const match = REFERENCE_HEADING.exec(line.text.trim());
    return match ? [{ line, level: match[1]?.length ?? 0 }] : [];
  });

  if (headings.length === 0) {
    throw new MinerUContractError(
      "references-heading-missing",
      "MinerU Markdown has no exact References heading",
    );
  }
  if (headings.length > 1) {
    throw new MinerUContractError(
      "references-heading-ambiguous",
      "MinerU Markdown has multiple exact References headings",
    );
  }

  const heading = headings[0]!;
  const sectionStart = heading.line.end;
  const sectionEnd =
    lines.find((line) => {
      if (line.start < sectionStart) return false;
      const match = ANY_HEADING.exec(line.text.trim());
      return Boolean(match && (match[1]?.length ?? 7) <= heading.level);
    })?.start ?? fullMarkdown.length;
  const section = fullMarkdown.slice(sectionStart, sectionEnd);

  if (!section.trim()) {
    throw new MinerUContractError(
      "references-section-empty",
      "The References section is empty",
    );
  }

  const markers = collectMarkers(
    splitSourceLines(section).map((line) => ({
      ...line,
      start: line.start + sectionStart,
      end: line.end + sectionStart,
    })),
  );
  if (markers.length === 0) {
    throw new MinerUContractError(
      "references-entry-structure-unsupported",
      "The References section has no supported entry markers",
    );
  }
  const style = markers[0]!.style;
  if (markers.some((marker) => marker.style !== style)) {
    throw new MinerUContractError(
      "references-marker-mixed",
      "The References section mixes marker styles",
    );
  }
  if (fullMarkdown.slice(sectionStart, markers[0]!.markerStart).trim()) {
    throw new MinerUContractError(
      "references-prefix-unparsed",
      "The References section has content before its first entry marker",
    );
  }

  return markers.map((marker, ordinal) => {
    const nextStart = markers[ordinal + 1]?.markerStart ?? sectionEnd;
    const rawMarkdown = fullMarkdown
      .slice(marker.markerStart, nextStart)
      .trimEnd();
    const markerPattern =
      marker.style === "bracket" ? BRACKET_MARKER : NUMERIC_MARKER;
    const lookupText = rawMarkdown.replace(markerPattern, "").trim();

    return {
      ordinal,
      sourceLabel: marker.sourceLabel,
      rawMarkdown,
      lookupText,
      charStart: marker.markerStart,
      charEnd: marker.markerStart + rawMarkdown.length,
    };
  });
}

function collectMarkers(lines: readonly SourceLine[]): EntryMarker[] {
  const markers: EntryMarker[] = [];
  for (const line of lines) {
    const bracket = BRACKET_MARKER.exec(line.text);
    if (bracket) {
      markers.push({
        style: "bracket",
        sourceLabel: bracket[2]!,
        markerStart: line.start + bracket[1]!.length,
      });
      continue;
    }
    const numeric = NUMERIC_MARKER.exec(line.text);
    if (numeric) {
      markers.push({
        style: "numeric",
        sourceLabel: numeric[2]!,
        markerStart: line.start + numeric[1]!.length,
      });
    }
  }
  return markers;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  while (start < source.length) {
    const carriageReturn = source.indexOf("\r", start);
    const lineFeed = source.indexOf("\n", start);
    const newline =
      carriageReturn < 0
        ? lineFeed
        : lineFeed < 0
          ? carriageReturn
          : Math.min(carriageReturn, lineFeed);
    if (newline < 0) {
      lines.push({ text: source.slice(start), start, end: source.length });
      break;
    }
    const newlineLength =
      source[newline] === "\r" && source[newline + 1] === "\n" ? 2 : 1;
    lines.push({
      text: source.slice(start, newline),
      start,
      end: newline + newlineLength,
    });
    start = newline + newlineLength;
  }

  return lines;
}
