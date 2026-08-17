import type { ReaderPaper } from "./mountReaderSection";

type CaretPointDocument = Document & {
  caretPositionFromPoint?(
    x: number,
    y: number,
  ): { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?(x: number, y: number): Range | null;
};

export function citationNumberAtOffset(
  text: string,
  offset: number,
): number | undefined {
  for (const match of text.matchAll(/[[［]([\d\s,，;；\-–—]+)[\]］]/gu)) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    if (offset < matchStart || offset > matchEnd) continue;
    const content = match[1];
    if (content === undefined) continue;
    const contentStart = matchStart + 1;
    const numbers = [...content.matchAll(/\d+/gu)];
    const nearest = numbers.reduce<
      { value: number; distance: number } | undefined
    >((best, numberMatch) => {
      const value = Number(numberMatch[0]);
      const start = contentStart + numberMatch.index;
      const end = start + numberMatch[0].length;
      const distance =
        offset < start ? start - offset : offset > end ? offset - end : 0;
      return !best || distance < best.distance ? { value, distance } : best;
    }, undefined);
    return nearest?.value;
  }
  return undefined;
}

export function citationNumberAtPoint(
  document: Document,
  clientX: number,
  clientY: number,
): number | undefined {
  const caretDocument = document as CaretPointDocument;
  const position = caretDocument.caretPositionFromPoint?.(clientX, clientY);
  const fallbackRange = position
    ? undefined
    : caretDocument.caretRangeFromPoint?.(clientX, clientY);
  const node = position?.offsetNode ?? fallbackRange?.startContainer;
  const offset = position?.offset ?? fallbackRange?.startOffset;
  if (!node || offset === undefined) return undefined;
  const textLayer = parentElement(node)?.closest(".textLayer");
  if (!textLayer) return undefined;
  const line = textLineAtPoint(textLayer, node, offset, clientY);
  return line ? citationNumberAtOffset(line.text, line.offset) : undefined;
}

export function referenceForCitationNumber(
  references: readonly ReaderPaper[],
  citationNumber: number,
): ReaderPaper | undefined {
  return (
    references.find(
      (reference) =>
        numericSourceLabel(reference.sourceLabel) === citationNumber,
    ) ??
    references.find(
      (reference) =>
        numericSourceLabel(reference.sourceLabel) === undefined &&
        reference.ordinal + 1 === citationNumber,
    )
  );
}

function textLineAtPoint(
  textLayer: Element,
  caretNode: Node,
  caretOffset: number,
  clientY: number,
): { text: string; offset: number } | undefined {
  const ownerDocument = textLayer.ownerDocument;
  const walker = ownerDocument.createTreeWalker(
    textLayer,
    ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4,
  );
  const nodes: Array<{ node: Text; left: number }> = [];
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === 3 && current.textContent) {
      const element = parentElement(current);
      const bounds = element?.getBoundingClientRect();
      if (
        current === caretNode ||
        (bounds && clientY >= bounds.top - 1 && clientY <= bounds.bottom + 1)
      ) {
        nodes.push({ node: current as Text, left: bounds?.left ?? 0 });
      }
    }
    current = walker.nextNode();
  }
  if (!nodes.some(({ node }) => node === caretNode)) return undefined;
  nodes.sort((left, right) => left.left - right.left);
  let text = "";
  let pointOffset = 0;
  for (const entry of nodes) {
    if (entry.node === caretNode) {
      pointOffset = text.length + Math.min(caretOffset, entry.node.data.length);
    }
    text += entry.node.data;
  }
  return { text, offset: pointOffset };
}

function parentElement(node: Node): Element | null {
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function numericSourceLabel(label: string | undefined): number | undefined {
  if (!label) return undefined;
  const match = label.match(/^\s*[[［(（]?\s*(\d+)\s*[\]］)）.]?\s*$/u);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
