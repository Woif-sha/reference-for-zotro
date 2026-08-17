export function findSseFrameBoundary(
  value: string,
): { index: number; length: number } | undefined {
  for (let index = 0; index < value.length; index += 1) {
    const first = lineEndingLength(value, index);
    if (!first) continue;
    const second = lineEndingLength(value, index + first);
    if (second) return { index, length: first + second };
    index += first - 1;
  }
  return undefined;
}

function lineEndingLength(value: string, index: number): number {
  if (value[index] === "\n") return 1;
  if (value[index] !== "\r") return 0;
  return value[index + 1] === "\n" ? 2 : 1;
}
