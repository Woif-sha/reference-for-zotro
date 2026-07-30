import {
  createLiteratureCacheKey,
  type LiteratureCacheIdentity,
} from "./cache-key";

export interface CacheStorage {
  read(key: string): Promise<string | undefined>;
  write(key: string, value: string): Promise<void>;
}

type CacheEnvelope<T> = {
  cacheSchemaVersion: 1;
  value: T;
};

export class LiteratureCacheRepository<T = unknown> {
  constructor(private readonly storage: CacheStorage) {}

  async read(identity: LiteratureCacheIdentity): Promise<T | undefined> {
    const raw = await this.storage.read(createLiteratureCacheKey(identity));
    if (raw === undefined) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isCacheEnvelope<T>(parsed)) {
      throw new Error("Literature cache envelope is invalid");
    }
    return parsed.value;
  }

  async write(identity: LiteratureCacheIdentity, value: T): Promise<void> {
    const envelope: CacheEnvelope<T> = {
      cacheSchemaVersion: 1,
      value,
    };
    await this.storage.write(
      createLiteratureCacheKey(identity),
      JSON.stringify(envelope),
    );
  }
}

function isCacheEnvelope<T>(value: unknown): value is CacheEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "cacheSchemaVersion" in value &&
    value.cacheSchemaVersion === 1 &&
    "value" in value
  );
}
