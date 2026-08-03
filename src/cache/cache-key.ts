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
