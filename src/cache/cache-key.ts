export type LiteratureCacheIdentity = {
  libraryID: number;
  attachmentID: number;
  attachmentKey: string;
  sourceFingerprint: string;
  providerSchemaVersion: number;
};

export function createLiteratureCacheKey(
  identity: LiteratureCacheIdentity,
): string {
  if (!Number.isInteger(identity.providerSchemaVersion)) {
    throw new Error("providerSchemaVersion must be an integer");
  }
  return [
    `v${identity.providerSchemaVersion}`,
    identity.libraryID,
    identity.attachmentID,
    identity.attachmentKey,
    identity.sourceFingerprint,
  ].join(":");
}
