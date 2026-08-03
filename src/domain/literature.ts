export type StableIdentifiers = {
  doi?: string;
  arxiv?: string;
  ieeeArticleNumber?: string;
  trustedSourceUrl?: string;
};

export type StableIdentifierKind =
  "doi" | "arxiv" | "ieee-article-number" | "trusted-source-url";

export type ReferenceMatchBasis =
  StableIdentifierKind | "pmid" | "pmcid" | "omid" | "metadata";

export type DeterministicMatch =
  | {
      status: "confirmed";
      matchedBy: StableIdentifierKind;
      url: string;
    }
  | {
      status: "unresolved";
      reason: "no-stable-identifier";
    };

export type PaperIdentity = {
  libraryID: number;
  attachmentID: number;
  attachmentKey: string;
  parentItemKey: string;
  sourceFingerprint: string;
};

export type SessionToken = PaperIdentity & {
  generation: number;
};
