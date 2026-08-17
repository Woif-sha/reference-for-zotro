import {
  createLiteratureCacheDirectory,
  createLiteratureCacheKey,
  type LiteratureCacheIdentity,
} from "./cache-key";
import type { CachedRelatedPapers } from "../application/related-papers-controller";
import type { ReaderPaper } from "../reader/mountReaderSection";
import { normalizeDoi } from "../literature/identifiers";

export type LiteratureCacheFileName =
  "manifest.json" | "references.json" | "citations.json" | "abstract.json";

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

type CachedAbstractRecord = {
  doi: string;
  text: string;
  source: "openalex";
  sourceRecordID: string;
  retrievedAt: string;
};

type CachedAbstractFile = {
  schemaVersion: 1;
  updatedAt: string;
  abstracts: readonly CachedAbstractRecord[];
};

const CACHE_SCHEMA_VERSION = 2;
const ABSTRACT_CACHE_SCHEMA_VERSION = 1;

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

    const [rawReferences, rawCitations, rawAbstracts] = await Promise.all([
      this.storage.read(directory, "references.json"),
      this.storage.read(directory, "citations.json"),
      this.storage.read(directory, "abstract.json"),
    ]);
    if (rawReferences === undefined || rawCitations === undefined) {
      throw new Error("Literature cache is incomplete");
    }
    const references = parsePaperFile(rawReferences, "references.json");
    const citations = parseCitationsFile(rawCitations);
    const abstracts =
      rawAbstracts === undefined ? undefined : parseAbstractFile(rawAbstracts);
    if (
      references.updatedAt !== manifest.updatedAt ||
      citations.updatedAt !== manifest.updatedAt ||
      (abstracts && abstracts.updatedAt !== manifest.updatedAt)
    ) {
      throw new Error("Literature cache files belong to different revisions");
    }
    const abstractsByDoi = new Map(
      abstracts?.abstracts.map((record) => [record.doi, record]),
    );
    return {
      references: references.papers.map((record) =>
        restorePaper(record, abstractsByDoi),
      ),
      citingPapers: citations.papers.map((record) =>
        restorePaper(record, abstractsByDoi),
      ),
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
    const abstracts: CachedAbstractFile = {
      schemaVersion: ABSTRACT_CACHE_SCHEMA_VERSION,
      updatedAt,
      abstracts: cacheAbstracts(results),
    };
    await this.storage.write(
      createLiteratureCacheDirectory(identity),
      {
        "manifest.json": serialize(manifest),
        "references.json": serialize(references),
        "citations.json": serialize(citations),
        "abstract.json": serialize(abstracts),
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

function parseAbstractFile(raw: string): CachedAbstractFile {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    value.schemaVersion !== ABSTRACT_CACHE_SCHEMA_VERSION ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.abstracts) ||
    !value.abstracts.every(isCachedAbstract)
  ) {
    throw new Error("Literature cache abstract.json is invalid");
  }
  return value as CachedAbstractFile;
}

function isCachedAbstract(value: unknown): value is CachedAbstractRecord {
  if (!isRecord(value) || typeof value.doi !== "string") return false;
  const doi = normalizeDoi(value.doi);
  return (
    doi === value.doi &&
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    value.source === "openalex" &&
    typeof value.sourceRecordID === "string" &&
    value.sourceRecordID.length > 0 &&
    typeof value.retrievedAt === "string" &&
    Number.isFinite(Date.parse(value.retrievedAt))
  );
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
    "abstractSourceRecordID" in value ||
    "abstractRetrievedAt" in value ||
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
  delete record.abstractSourceRecordID;
  delete record.abstractRetrievedAt;
  delete record.abstractLoading;
  delete record.abstractError;
  if (paper.status === "resolved") {
    record.landingURL = paper.primaryResultURL;
  }
  delete record.primaryResultURL;
  return record as CachedPaperRecord;
}

function cacheAbstracts(
  results: CachedRelatedPapers,
): readonly CachedAbstractRecord[] {
  const records = new Map<string, CachedAbstractRecord>();
  for (const paper of [...results.references, ...results.citingPapers]) {
    if (!paper.abstract || paper.abstractSource !== "openalex") continue;
    const doi = normalizeDoi(paper.doi);
    if (!doi) continue;
    if (!paper.abstractSourceRecordID || !paper.abstractRetrievedAt) {
      throw new Error("OpenAlex Abstract cache metadata is incomplete");
    }
    records.set(doi, {
      doi,
      text: paper.abstract,
      source: "openalex",
      sourceRecordID: paper.abstractSourceRecordID,
      retrievedAt: paper.abstractRetrievedAt,
    });
  }
  return [...records.values()].sort((left, right) =>
    left.doi.localeCompare(right.doi),
  );
}

function restorePaper(
  record: CachedPaperRecord,
  abstractsByDoi: ReadonlyMap<string, CachedAbstractRecord>,
): ReaderPaper {
  const { landingURL, ...paper } = record;
  const restored = (
    record.status === "resolved"
      ? { ...paper, status: "resolved", primaryResultURL: landingURL }
      : paper
  ) as ReaderPaper;
  const doi = normalizeDoi(restored.doi);
  const abstract = doi ? abstractsByDoi.get(doi) : undefined;
  return abstract
    ? {
        ...restored,
        abstract: abstract.text,
        abstractSource: abstract.source,
        abstractSourceRecordID: abstract.sourceRecordID,
        abstractRetrievedAt: abstract.retrievedAt,
      }
    : restored;
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
