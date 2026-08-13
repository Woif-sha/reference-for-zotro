import {
  createLiteratureCacheDirectory,
  createLiteratureCacheKey,
  type LiteratureCacheIdentity,
} from "./cache-key";
import type { CachedRelatedPapers } from "../application/related-papers-controller";
import type { ReaderPaper } from "../reader/mountReaderSection";

export type LiteratureCacheFileName =
  "manifest.json" | "references.json" | "citations.json";

export type LiteratureCacheFiles = Readonly<
  Record<LiteratureCacheFileName, string>
>;

export interface CacheStorage {
  read(
    directory: string,
    file: LiteratureCacheFileName,
  ): Promise<string | undefined>;
  write(
    directory: string,
    files: LiteratureCacheFiles,
    signal?: AbortSignal,
  ): Promise<void>;
}

type CacheManifest = LiteratureCacheIdentity & {
  schemaVersion: 2;
  updatedAt: string;
};

type CachedPaperRecord = Record<string, unknown> & {
  id: string;
  ordinal: number;
  title: string;
  status: ReaderPaper["status"];
  landingURL?: string;
};

type CachedPaperFile = {
  schemaVersion: 2;
  updatedAt: string;
  papers: readonly CachedPaperRecord[];
};

type CachedCitationsFile = CachedPaperFile & {
  loadedLimit: number;
};

const CACHE_SCHEMA_VERSION = 2;

export class LiteratureCacheRepository {
  constructor(private readonly storage: CacheStorage) {}

  async read(
    identity: LiteratureCacheIdentity,
  ): Promise<CachedRelatedPapers | undefined> {
    const directory = createLiteratureCacheDirectory(identity);
    const rawManifest = await this.storage.read(directory, "manifest.json");
    if (rawManifest === undefined) return undefined;
    const manifest = parseManifest(rawManifest);
    if (
      createLiteratureCacheKey(manifest) !== createLiteratureCacheKey(identity)
    ) {
      return undefined;
    }

    const [rawReferences, rawCitations] = await Promise.all([
      this.storage.read(directory, "references.json"),
      this.storage.read(directory, "citations.json"),
    ]);
    if (rawReferences === undefined || rawCitations === undefined) {
      throw new Error("Literature cache is incomplete");
    }
    const references = parsePaperFile(rawReferences, "references.json");
    const citations = parseCitationsFile(rawCitations);
    if (
      references.updatedAt !== manifest.updatedAt ||
      citations.updatedAt !== manifest.updatedAt
    ) {
      throw new Error("Literature cache files belong to different revisions");
    }
    return {
      references: references.papers.map(restorePaper),
      citingPapers: citations.papers.map(restorePaper),
      citingPapersLoaded: citations.loadedLimit,
    };
  }

  async write(
    identity: LiteratureCacheIdentity,
    results: CachedRelatedPapers,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const updatedAt = new Date().toISOString();
    const manifest: CacheManifest = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      ...identity,
      updatedAt,
    };
    const references: CachedPaperFile = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      updatedAt,
      papers: results.references.map(cachePaper),
    };
    const citations: CachedCitationsFile = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      updatedAt,
      loadedLimit: results.citingPapersLoaded,
      papers: results.citingPapers.map(cachePaper),
    };
    await this.storage.write(
      createLiteratureCacheDirectory(identity),
      {
        "manifest.json": serialize(manifest),
        "references.json": serialize(references),
        "citations.json": serialize(citations),
      },
      signal,
    );
    throwIfAborted(signal);
  }
}

function parseManifest(raw: string): CacheManifest {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.schemaVersion !== CACHE_SCHEMA_VERSION) {
    throw new Error("Literature cache manifest is invalid");
  }
  const manifest = value as Partial<CacheManifest>;
  if (
    !Number.isInteger(manifest.libraryID) ||
    !Number.isInteger(manifest.attachmentID) ||
    typeof manifest.attachmentKey !== "string" ||
    typeof manifest.sourceFingerprint !== "string" ||
    !Number.isInteger(manifest.providerSchemaVersion) ||
    typeof manifest.provider !== "string" ||
    !Number.isInteger(manifest.providerQueryVersion) ||
    typeof manifest.normalizedRequestKey !== "string" ||
    typeof manifest.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.updatedAt))
  ) {
    throw new Error("Literature cache manifest is invalid");
  }
  return manifest as CacheManifest;
}

function parsePaperFile(raw: string, name: string): CachedPaperFile {
  const value: unknown = JSON.parse(raw);
  if (!isPaperFile(value)) {
    throw new Error(`Literature cache ${name} is invalid`);
  }
  return value;
}

function parseCitationsFile(raw: string): CachedCitationsFile {
  const value: unknown = JSON.parse(raw);
  if (
    !isPaperFile(value) ||
    !("loadedLimit" in value) ||
    typeof value.loadedLimit !== "number" ||
    ![0, 10, 30, 50].includes(value.loadedLimit)
  ) {
    throw new Error("Literature cache citations.json is invalid");
  }
  return value as CachedCitationsFile;
}

function isPaperFile(value: unknown): value is CachedPaperFile {
  return (
    isRecord(value) &&
    value.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    Array.isArray(value.papers) &&
    value.papers.every(isCachedPaper)
  );
}

function isCachedPaper(value: unknown): value is CachedPaperRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isInteger(value.ordinal) ||
    typeof value.title !== "string" ||
    typeof value.status !== "string" ||
    !PAPER_STATUSES.has(value.status as ReaderPaper["status"]) ||
    "abstract" in value ||
    "abstractSource" in value ||
    "abstractLoading" in value ||
    "abstractError" in value ||
    "primaryResultURL" in value
  ) {
    return false;
  }
  return value.status === "resolved"
    ? typeof value.landingURL === "string" && value.landingURL.length > 0
    : !("landingURL" in value);
}

const PAPER_STATUSES = new Set<ReaderPaper["status"]>([
  "matching",
  "resolved",
  "unresolved",
  "ambiguous",
  "invalid-identifier",
  "unreachable",
  "failed",
]);

function cachePaper(paper: ReaderPaper): CachedPaperRecord {
  const record: Record<string, unknown> = { ...paper };
  delete record.abstract;
  delete record.abstractSource;
  delete record.abstractLoading;
  delete record.abstractError;
  if (paper.status === "resolved") {
    record.landingURL = paper.primaryResultURL;
  }
  delete record.primaryResultURL;
  return record as CachedPaperRecord;
}

function restorePaper(record: CachedPaperRecord): ReaderPaper {
  const { landingURL, ...paper } = record;
  return (
    record.status === "resolved"
      ? { ...paper, status: "resolved", primaryResultURL: landingURL }
      : paper
  ) as ReaderPaper;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}
