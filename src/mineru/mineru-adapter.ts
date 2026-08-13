import {
  MinerUContractError,
  type MinerUIdentity,
  type ReferenceEntry,
} from "../domain/reference";
import {
  normalizeReferenceEntries,
  parseReferenceEntries,
  type ReferenceNormalization,
} from "./reference-parser";

const CACHE_ROOT_NAME = "llm-for-zotero-mineru";
const SOURCE_FILENAME = "_llm_source.json";
const MARKDOWN_FILENAME = "full.md";
const MANIFEST_FILENAME = "manifest.json";
const CONTENT_LIST_FILENAME = "content_list.json";
const REQUIRED_FILENAMES = [
  SOURCE_FILENAME,
  MARKDOWN_FILENAME,
  MANIFEST_FILENAME,
  CONTENT_LIST_FILENAME,
] as const;
const PROVENANCE_KIND = "llm-for-zotero/mineru-cache-source";
const PROVENANCE_VERSION = 2;

export type MinerUItemSnapshot = Readonly<{
  id: number;
  key: string;
  libraryID: number;
  parentItemID: number | null;
  isAttachment: boolean;
}>;

export type MinerUReadResult = Readonly<{
  text: string;
  revision: string;
}>;

export type MinerUPorts = Readonly<{
  dataDirectory: string;
  items: Readonly<{
    get(itemID: number): MinerUItemSnapshot | undefined;
  }>;
  files: Readonly<{
    join(...segments: string[]): string;
    exists(path: string): Promise<boolean>;
    readUtf8(path: string): Promise<MinerUReadResult>;
    writeUtf8(path: string, text: string): Promise<void>;
  }>;
  sha256(text: string): Promise<string>;
}>;

export type LoadedMinerUReferences = Readonly<{
  identity: MinerUIdentity;
  fullMarkdown: string;
  fullMdSha256: string;
  sourceFingerprint: string;
  entries: readonly ReferenceEntry[];
}>;

export async function loadMineruReferences(
  attachmentID: number,
  ports: MinerUPorts,
): Promise<LoadedMinerUReferences> {
  const identity = resolveIdentity(attachmentID, ports.items);
  const cacheDirectory = ports.files.join(
    ports.dataDirectory,
    CACHE_ROOT_NAME,
    String(identity.attachmentID),
  );
  const paths = REQUIRED_FILENAMES.map((filename) =>
    ports.files.join(cacheDirectory, filename),
  );
  let present: readonly boolean[];
  try {
    present = await Promise.all(paths.map((path) => ports.files.exists(path)));
  } catch {
    throw invalidCache("The MinerU cache could not be inspected");
  }
  const missing = REQUIRED_FILENAMES.filter((_, index) => !present[index]);

  if (missing.length === REQUIRED_FILENAMES.length) {
    throw new MinerUContractError(
      "md-not-generated",
      "No MinerU Markdown has been generated for the current attachment",
    );
  }
  if (missing.length > 0) {
    throw new MinerUContractError(
      "md-cache-incomplete",
      "The MinerU Markdown cache is incomplete",
      missing,
    );
  }

  const firstRead = await readRequiredFiles(paths, ports);
  const normalization = normalizeReferenceEntries(
    firstRead[1]!.text,
    firstRead[3]!.text,
  );
  const normalizedManifest = normalizeManifest(
    firstRead[2]!.text,
    normalization,
  );
  const normalizedRead = [
    firstRead[0]!,
    { ...firstRead[1]!, text: normalization.fullMarkdown },
    { ...firstRead[2]!, text: normalizedManifest },
    { ...firstRead[3]!, text: normalization.contentListJson },
  ] as const;
  validateCache(normalizedRead, identity);
  const fullMarkdown = normalization.fullMarkdown;
  const entries = parseReferenceEntries(
    fullMarkdown,
    normalization.contentListJson,
  );
  let fullMdSha256: string;
  let sourceFingerprint: string;
  try {
    [fullMdSha256, sourceFingerprint] = await Promise.all([
      ports.sha256(fullMarkdown),
      ports.sha256(
        [
          firstRead[0]!.text,
          fullMarkdown,
          normalizedManifest,
          normalization.contentListJson,
        ].join("\0"),
      ),
    ]);
  } catch {
    throw invalidCache("The MinerU Markdown fingerprint could not be computed");
  }
  const secondRead = await readRequiredFiles(paths, ports);
  if (
    firstRead.some(
      (file, index) =>
        file.revision !== secondRead[index]!.revision ||
        file.text !== secondRead[index]!.text,
    )
  ) {
    throw invalidCache("The MinerU cache changed while it was being read");
  }
  const currentIdentity = resolveIdentity(attachmentID, ports.items);
  if (!sameIdentity(identity, currentIdentity)) {
    throw invalidCache("The current Reader attachment changed while loading");
  }
  await persistNormalization(paths, firstRead, normalizedRead, ports);

  return {
    identity,
    fullMarkdown,
    fullMdSha256,
    sourceFingerprint,
    entries,
  };
}

function normalizeManifest(
  manifestJson: string,
  normalization: ReferenceNormalization,
): string {
  const manifest = parseObject(manifestJson);
  if (manifest.totalChars === normalization.fullMarkdown.length) {
    return manifestJson;
  }
  const inferredMarker = normalization.inferredMarker;
  if (
    !inferredMarker ||
    manifest.totalChars !==
      normalization.fullMarkdown.length - inferredMarker.length ||
    !Array.isArray(manifest.sections)
  ) {
    return manifestJson;
  }

  const sections = manifest.sections.map((section) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return section;
    }
    let charStart = (section as Record<string, unknown>).charStart;
    let charEnd = (section as Record<string, unknown>).charEnd;
    if (!Number.isInteger(charStart) || !Number.isInteger(charEnd)) {
      return section;
    }
    if ((charStart as number) > inferredMarker.position) {
      charStart = (charStart as number) + inferredMarker.length;
      charEnd = (charEnd as number) + inferredMarker.length;
    } else if ((charEnd as number) > inferredMarker.position) {
      charEnd = (charEnd as number) + inferredMarker.length;
    }
    return { ...section, charStart, charEnd };
  });

  return JSON.stringify({
    ...manifest,
    totalChars: normalization.fullMarkdown.length,
    sections,
  });
}

async function persistNormalization(
  paths: readonly string[],
  original: readonly MinerUReadResult[],
  normalized: readonly MinerUReadResult[],
  ports: MinerUPorts,
): Promise<void> {
  const writeOrder = [1, 2, 3] as const;
  try {
    for (const index of writeOrder) {
      if (original[index]!.text === normalized[index]!.text) continue;
      await ports.files.writeUtf8(paths[index]!, normalized[index]!.text);
    }
  } catch {
    throw invalidCache("The MinerU Reference cache could not be normalized");
  }
}

function resolveIdentity(
  attachmentID: number,
  items: MinerUPorts["items"],
): MinerUIdentity {
  if (!Number.isInteger(attachmentID)) {
    throw unsupportedReaderItem();
  }
  const attachment = items.get(attachmentID);
  if (
    !attachment ||
    !attachment.isAttachment ||
    attachment.id !== attachmentID ||
    !Number.isInteger(attachment.parentItemID)
  ) {
    throw unsupportedReaderItem();
  }
  const parent = items.get(attachment.parentItemID!);
  if (!parent || parent.isAttachment) {
    throw unsupportedReaderItem();
  }
  return {
    libraryID: attachment.libraryID,
    parentItemKey: parent.key,
    attachmentID: attachment.id,
    attachmentKey: attachment.key,
  };
}

async function readRequiredFiles(
  paths: readonly string[],
  ports: MinerUPorts,
): Promise<readonly MinerUReadResult[]> {
  try {
    return await Promise.all(paths.map((path) => ports.files.readUtf8(path)));
  } catch {
    throw invalidCache("A required MinerU cache file is not valid UTF-8");
  }
}

function validateCache(
  files: readonly MinerUReadResult[],
  identity: MinerUIdentity,
): void {
  const [source, markdown, manifest] = files;
  if (!markdown?.text.trim()) {
    throw invalidCache("The MinerU full.md file is empty");
  }

  const provenance = parseObject(source?.text);
  if (
    provenance.kind !== PROVENANCE_KIND ||
    provenance.version !== PROVENANCE_VERSION ||
    provenance.attachmentId !== identity.attachmentID ||
    provenance.attachmentKey !== identity.attachmentKey ||
    provenance.parentItemKey !== identity.parentItemKey ||
    (provenance.origin !== "parsed" && provenance.origin !== "restored") ||
    typeof provenance.recordedAt !== "string" ||
    !Number.isFinite(Date.parse(provenance.recordedAt))
  ) {
    throw invalidCache(
      "MinerU provenance does not match the current attachment",
    );
  }

  const parsedManifest = parseObject(manifest?.text);
  if (
    !Number.isInteger(parsedManifest.totalChars) ||
    parsedManifest.totalChars !== markdown.text.length
  ) {
    throw invalidCache("MinerU manifest length does not match full.md");
  }
  validateRanges(parsedManifest.sections, markdown.text.length);
}

function parseObject(text: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text ?? "");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw invalidCache("A MinerU metadata file is not a JSON object");
  }
}

function validateRanges(sections: unknown, fullLength: number): void {
  if (!Array.isArray(sections)) {
    throw invalidCache("MinerU manifest sections are invalid");
  }

  let previousEnd = 0;
  for (const section of sections) {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw invalidCache("MinerU manifest section is invalid");
    }
    const range = section as Record<string, unknown>;
    const start = range.charStart;
    const end = range.charEnd;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      (start as number) < previousEnd ||
      (start as number) < 0 ||
      (end as number) < (start as number) ||
      (end as number) > fullLength
    ) {
      throw invalidCache("MinerU manifest section ranges are invalid");
    }
    previousEnd = end as number;
  }
}

function sameIdentity(left: MinerUIdentity, right: MinerUIdentity): boolean {
  return (
    left.libraryID === right.libraryID &&
    left.parentItemKey === right.parentItemKey &&
    left.attachmentID === right.attachmentID &&
    left.attachmentKey === right.attachmentKey
  );
}

function unsupportedReaderItem(): MinerUContractError {
  return new MinerUContractError(
    "unsupported-reader-item",
    "The current Reader item is not an attachment with a parent item",
  );
}

function invalidCache(message: string): MinerUContractError {
  return new MinerUContractError("md-cache-invalid", message);
}
