import type { MinerUPorts, MinerUReadResult } from "../mineru/mineru-adapter";
import type { ProviderPorts } from "../literature/providers/types";
import type { CacheStorage } from "../cache/cache-repository";
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
  remove(path: string, options?: { ignoreAbsent?: boolean }): Promise<void>;
  makeDirectory(
    path: string,
    options?: { createAncestors?: boolean; ignoreExisting?: boolean },
  ): Promise<void>;
};

export function createZoteroMinerUPorts(): MinerUPorts {
  const io = getIOUtils();
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
  const root = joinPath(getDataDirectory(), "reference-for-zotero-cache", "v1");
  const writes = new Map<string, Promise<void>>();
  const enqueue = (key: string, task: () => Promise<void>): Promise<void> => {
    const previous = writes.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    writes.set(key, operation);
    return operation.finally(() => {
      if (writes.get(key) === operation) {
        writes.delete(key);
      }
    });
  };
  return {
    async read(key) {
      const path = joinPath(root, `${await sha256(key)}.json`);
      if (!(await io.exists(path))) return undefined;
      const raw = await io.read(path);
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    },
    write(key, value, signal) {
      return enqueue(key, async () => {
        if (signal?.aborted) throw abortError();
        await io.makeDirectory(root, {
          createAncestors: true,
          ignoreExisting: true,
        });
        const path = joinPath(root, `${await sha256(key)}.json`);
        const stagedPath = `${path}.pending-${nextCacheWriteID++}`;
        let committed = false;
        try {
          await io.write(stagedPath, new TextEncoder().encode(value), {
            tmpPath: `${stagedPath}.tmp`,
          });
          if (signal?.aborted) throw abortError();
          await io.move(stagedPath, path, { noOverwrite: false });
          if (signal?.aborted) {
            await io.remove(path, { ignoreAbsent: true });
            throw abortError();
          }
          committed = true;
        } finally {
          if (!committed) {
            await io.remove(stagedPath, { ignoreAbsent: true });
          }
        }
      });
    },
    remove(key, signal) {
      return enqueue(key, async () => {
        if (signal?.aborted) throw abortError();
        const path = joinPath(root, `${await sha256(key)}.json`);
        await io.remove(path, { ignoreAbsent: true });
        if (signal?.aborted) throw abortError();
      });
    },
  };
}

let nextCacheWriteID = 1;

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
  init?.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMilliseconds);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}
