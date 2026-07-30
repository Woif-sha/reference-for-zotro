export type StableIdentifiers = {
  doi?: string;
  arxiv?: string;
  ieeeArticleNumber?: string;
  trustedSourceUrl?: string;
};

export type DeterministicMatch =
  | {
      status: "confirmed";
      matchedBy: "doi" | "arxiv" | "ieee-article-number" | "trusted-source-url";
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
