export type LiteratureCacheIdentity = {
  libraryID: number;
  attachmentID: number;
  attachmentKey: string;
  sourceFingerprint: string;
  providerSchemaVersion: number;
  provider: string;
  providerQueryVersion: number;
  normalizedRequestKey: string;
};

export function createLiteratureCacheKey(
  identity: LiteratureCacheIdentity,
): string {
  if (!Number.isInteger(identity.providerSchemaVersion)) {
    throw new Error("providerSchemaVersion must be an integer");
  }
  if (!Number.isInteger(identity.providerQueryVersion)) {
    throw new Error("providerQueryVersion must be an integer");
  }
  return [
    `v${identity.providerSchemaVersion}`,
    identity.libraryID,
    identity.attachmentID,
    identity.attachmentKey,
    identity.sourceFingerprint,
    identity.provider,
    `qv${identity.providerQueryVersion}`,
    identity.normalizedRequestKey,
  ].join(":");
}

export function createLiteratureCacheDirectory(
  identity: Pick<LiteratureCacheIdentity, "libraryID" | "attachmentKey">,
): string {
  if (!Number.isInteger(identity.libraryID) || identity.libraryID < 0) {
    throw new Error("libraryID must be a non-negative integer");
  }
  if (!/^[A-Z0-9]+$/iu.test(identity.attachmentKey)) {
    throw new Error("attachmentKey must contain only letters and numbers");
  }
  return `${identity.libraryID}-${identity.attachmentKey}`;
}
