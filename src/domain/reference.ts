export type ReferenceEntry = Readonly<{
  ordinal: number;
  sourceLabel: string;
  rawMarkdown: string;
  lookupText: string;
  charStart: number;
  charEnd: number;
}>;

export type MinerUIdentity = Readonly<{
  libraryID: number;
  parentItemKey: string;
  attachmentID: number;
  attachmentKey: string;
}>;

export type MinerUErrorCode =
  | "md-not-generated"
  | "md-cache-incomplete"
  | "md-cache-invalid"
  | "unsupported-reader-item"
  | "references-section-empty"
  | "references-marker-mixed"
  | "references-entry-structure-unsupported";

export class MinerUContractError extends Error {
  constructor(
    readonly code: MinerUErrorCode,
    message: string,
    readonly filenames: readonly string[] = [],
  ) {
    super(message);
    this.name = "MinerUContractError";
  }
}
