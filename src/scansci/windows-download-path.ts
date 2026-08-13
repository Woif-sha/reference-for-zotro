const MAX_FILENAME_STEM_CHARACTERS = 120;
const WINDOWS_RESERVED_FILENAME =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function canonicalPdfFilename(title: string): string {
  return `${safeWindowsFilenameStem(title)}.pdf`;
}

export function safeWindowsFilenameStem(title: string): string {
  const printable = [...title.normalize("NFKC")]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("");
  const stem = printable
    .replace(/[<>:"/\\|?*]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[ .]+$/u, "")
    .slice(0, MAX_FILENAME_STEM_CHARACTERS)
    .replace(/[ .]+$/u, "");
  if (!stem || WINDOWS_RESERVED_FILENAME.test(stem)) return "paper";
  return stem;
}
