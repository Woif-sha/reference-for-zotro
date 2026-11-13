import type { MinerUPorts, MinerUReadResult } from "../mineru/mineru-adapter";
import type { ProviderPorts } from "../literature/providers/types";
import type {
  CacheStorage,
  LiteratureCacheFileName,
} from "../cache/cache-repository";
import type { RecommendationCacheStorage } from "../cache/recommendation-cache-repository";
import {
  PaperTranslateBridge,
  type PaperTranslateGlobal,
} from "../translation/paper-translate-bridge";

type IOUtilsLike = {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array | ArrayBuffer>;
  write(
    path: string,
    data: Uint8Array,
    options?: { tmpPath?: string },
  ): Promise<unknown>;
  move(
    sourcePath: string,
    destinationPath: string,
    options?: { noOverwrite?: boolean },
  ): Promise<void>;
  copy(
    sourcePath: string,
    destinationPath: string,
    options?: { noOverwrite?: boolean },
  ): Promise<void>;
  remove(path: string, options?: { ignoreAbsent?: boolean }): Promise<void>;
  makeDirectory(
    path: string,
    options?: { createAncestors?: boolean; ignoreExisting?: boolean },
  ): Promise<void>;
};

export function createZoteroMinerUPorts(): MinerUPorts {
  const io = getIOUtils();
  const queue = createDirectoryWriteQueue();
  return {
    dataDirectory: getDataDirectory(),
    items: {
      get(itemID) {
        const item = Zotero.Items.get(itemID);
        if (!item) return undefined;
        return {
          id: item.id,
          key: item.key,
          libraryID: item.libraryID,
          parentItemID:
            typeof item.parentItemID === "number" ? item.parentItemID : null,
          isAttachment: item.isAttachment(),
        };
      },
    },
    files: {
      join: joinPath,
      exists: (path) => io.exists(path),
      async readUtf8(path): Promise<MinerUReadResult> {
        const raw = await io.read(path);
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { text, revision: `${bytes.byteLength}:${await sha256(text)}` };
      },
      async writeUtf8Batch(changes): Promise<void> {
        if (changes.length === 0) return;
        const directory = changes[0]!.path.replace(/[\\/][^\\/]+$/u, "");
        await queue.enqueue(directory, () => replaceUtf8Files(io, changes));
      },
    },
    sha256,
  };
}

export function createProviderPorts(): ProviderPorts {
  const fetchWithBudget = createRateLimitedFetch((input, init) =>
    fetchWithTimeout(input, init, 10_000),
  );
  return {
    fetch: fetchWithBudget,
    clock: { now: () => new Date() },
    scheduler: {
      sleep: abortableDelay,
    },
  };
}

export function createZoteroCacheStorage(): CacheStorage {
  const io = getIOUtils();
  const root = paperCacheRoot();
  const queue = createDirectoryWriteQueue();
  return {
    async read(directory, file) {
      await queue.wait(directory);
      const path = joinPath(root, directory, file);
      if (!(await io.exists(path))) return undefined;
      const raw = await io.read(path);
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    },
    write(directory, files, signal) {
      return queue.enqueue(directory, async () => {
        if (signal?.aborted) throw abortError();
        const paperDirectory = joinPath(root, directory);
        await io.makeDirectory(paperDirectory, {
          createAncestors: true,
          ignoreExisting: true,
        });
        const commitOrder: readonly LiteratureCacheFileName[] = [
          "references.json",
          "citations.json",
          "abstract.json",
          "manifest.json",
        ];
        await replaceUtf8Files(
          io,
          commitOrder.map((file) => ({
            path: joinPath(paperDirectory, file),
            text: files[file],
          })),
          signal,
        );
      });
    },
  };
}

export function createZoteroRecommendationCacheStorage(): RecommendationCacheStorage {
  const io = getIOUtils();
  const root = paperCacheRoot();
  const queue = createDirectoryWriteQueue();
  return {
    async read(directory) {
      await queue.wait(directory);
      const path = joinPath(root, directory, "recommendation.json");
      if (!(await io.exists(path))) return undefined;
      const raw = await io.read(path);
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    },
    write(directory, value, signal) {
      return queue.enqueue(directory, async () => {
        if (signal?.aborted) throw abortError();
        const paperDirectory = joinPath(root, directory);
        await io.makeDirectory(paperDirectory, {
          createAncestors: true,
          ignoreExisting: true,
        });
        const path = joinPath(paperDirectory, "recommendation.json");
        await replaceUtf8Files(io, [{ path, text: value }], signal);
      });
    },
  };
}

async function replaceUtf8Files(
  io: IOUtilsLike,
  files: readonly Readonly<{ path: string; text: string }>[],
  signal?: AbortSignal,
): Promise<void> {
  const writeID = crypto.randomUUID();
  const replacements = files.map(({ path, text }) => ({
    path,
    text,
    stagedPath: `${path}.pending-${writeID}`,
    previousPath: `${path}.previous-${writeID}`,
    previousExists: false,
    stagedOwned: false,
    backupOwned: false,
  }));
  const attempted: (typeof replacements)[number][] = [];
  let preserveBackups = false;
  let failed = false;
  let failure: unknown;
  try {
    for (const replacement of replacements) {
      if (signal?.aborted) throw abortError();
      if (await io.exists(replacement.stagedPath)) {
        throw new Error(`File already exists: ${replacement.stagedPath}`);
      }
      replacement.stagedOwned = true;
      await io.write(
        replacement.stagedPath,
        new TextEncoder().encode(replacement.text),
        { tmpPath: `${replacement.stagedPath}.tmp` },
      );
      if (signal?.aborted) throw abortError();
      replacement.previousExists = await io.exists(replacement.path);
      if (replacement.previousExists) {
        await io.copy(replacement.path, replacement.previousPath, {
          noOverwrite: true,
        });
        replacement.backupOwned = true;
      }
    }
    for (const replacement of replacements) {
      if (signal?.aborted) throw abortError();
      // A failed move can have changed its destination; include it in rollback.
      attempted.push(replacement);
      await io.move(replacement.stagedPath, replacement.path, {
        noOverwrite: false,
      });
      if (signal?.aborted) throw abortError();
    }
  } catch (error) {
    failed = true;
    failure = error;
    const rollbackErrors: unknown[] = [];
    for (const replacement of attempted.reverse()) {
      try {
        if (replacement.previousExists) {
          await io.copy(replacement.previousPath, replacement.path, {
            noOverwrite: false,
          });
        } else {
          await io.remove(replacement.path, { ignoreAbsent: true });
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      preserveBackups = true;
      failure = new AggregateError(
        [error, ...rollbackErrors],
        "File replacement and rollback failed; previous files were retained beside their destinations",
        { cause: error },
      );
    }
  }
  const cleanup = await Promise.allSettled(
    replacements.flatMap(
      ({ stagedPath, previousPath, stagedOwned, backupOwned }) => [
        ...(stagedOwned
          ? [
              io.remove(stagedPath, { ignoreAbsent: true }),
              io.remove(`${stagedPath}.tmp`, { ignoreAbsent: true }),
            ]
          : []),
        ...(!preserveBackups && backupOwned
          ? [io.remove(previousPath, { ignoreAbsent: true })]
          : []),
      ],
    ),
  );
  const cleanupErrors = cleanup.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [...(failed ? [failure] : []), ...cleanupErrors],
      "File replacement cleanup failed",
      failed ? { cause: failure } : undefined,
    );
  }
  if (failed) throw failure;
}

export function createPaperTranslateBridge(): PaperTranslateBridge {
  return new PaperTranslateBridge(
    () =>
      (
        Zotero as typeof Zotero & {
          PaperTranslate?: PaperTranslateGlobal;
        }
      ).PaperTranslate,
  );
}

function getIOUtils(): IOUtilsLike {
  const io = (globalThis as typeof globalThis & { IOUtils?: IOUtilsLike })
    .IOUtils;
  if (!io) throw new Error("IOUtils is unavailable in this Zotero runtime");
  return io;
}

function getDataDirectory(): string {
  const value = (Zotero as typeof Zotero & { DataDirectory?: { dir?: string } })
    .DataDirectory?.dir;
  if (!value?.trim()) throw new Error("Cannot resolve Zotero data directory");
  return value.trim();
}

function paperCacheRoot(): string {
  return joinPath(
    getDataDirectory(),
    "reference-for-zotero-cache",
    "v2",
    "papers",
  );
}

function createDirectoryWriteQueue(): Readonly<{
  wait(key: string): Promise<void> | undefined;
  enqueue(key: string, task: () => Promise<void>): Promise<void>;
}> {
  const writes = new Map<string, Promise<void>>();
  return {
    wait: (key) => writes.get(key),
    enqueue(key, task) {
      const previous = writes.get(key) ?? Promise.resolve();
      const operation = previous.catch(() => undefined).then(task);
      writes.set(key, operation);
      return operation.finally(() => {
        if (writes.get(key) === operation) writes.delete(key);
      });
    },
  };
}

function joinPath(...parts: string[]): string {
  const separator = parts[0]?.includes("\\") ? "\\" : "/";
  return parts
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/u, "")
        : part.replace(/^[\\/]+|[\\/]+$/gu, ""),
    )
    .filter(Boolean)
    .join(separator);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

function createRateLimitedFetch(
  rawFetch: ProviderPorts["fetch"],
): ProviderPorts["fetch"] {
  const queues = new Map<string, Promise<void>>();
  const lastStartedAt = new Map<string, number>();

  return async (input, init) => {
    const budget = requestBudget(input);
    if (!budget) return rawFetch(input, init);
    const previous = (queues.get(budget.key) ?? Promise.resolve()).catch(
      () => undefined,
    );
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    queues.set(
      budget.key,
      previous.then(() => current),
    );
    await previous;
    try {
      if (init?.signal?.aborted) throw abortError();
      const elapsed = Date.now() - (lastStartedAt.get(budget.key) ?? 0);
      if (elapsed < budget.minimumInterval) {
        await abortableDelay(budget.minimumInterval - elapsed, init?.signal);
      }
      lastStartedAt.set(budget.key, Date.now());
      return await rawFetch(input, init);
    } finally {
      release();
    }
  };
}

function requestBudget(
  input: string,
): { key: string; minimumInterval: number } | undefined {
  const url = new URL(input);
  if (url.hostname === "api.crossref.org") {
    return {
      key: url.pathname === "/v1/works" ? "crossref-list" : "crossref-single",
      minimumInterval: url.pathname === "/v1/works" ? 1000 : 200,
    };
  }
  if (url.hostname === "api.datacite.org") {
    return { key: "datacite", minimumInterval: 750 };
  }
  if (url.hostname === "api.opencitations.net") {
    return { key: "opencitations", minimumInterval: 500 };
  }
  if (url.hostname === "api.openalex.org") {
    return { key: "openalex", minimumInterval: 1000 };
  }
  if (url.hostname === "api.semanticscholar.org") {
    return { key: "semantic-scholar", minimumInterval: 1000 };
  }
  if (url.hostname === "doi.org") {
    return { key: "doi-proxy", minimumInterval: 500 };
  }
  return undefined;
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit | undefined,
  timeoutMilliseconds: number,
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMilliseconds);
  const cleanup = () => {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  };
  controller.signal.addEventListener("abort", cleanup, { once: true });
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.body) {
      cleanup();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            cleanup();
            stream.close();
          } else {
            stream.enqueue(value);
          }
        } catch (error) {
          cleanup();
          stream.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          cleanup();
        }
      },
    });
    const result = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperties(result, {
      url: { value: response.url },
      redirected: { value: response.redirected },
      type: { value: response.type },
    });
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}
