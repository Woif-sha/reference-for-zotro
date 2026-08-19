import {
  LocalPaperNameSynchronizer,
  type LocalPaperFilePort,
  type LocalPaperNameSyncResult,
  type LocalPdf,
} from "../application/local-paper-name-sync";
import {
  assertExistingRegularDirectory,
  assertExistingRegularFile,
  assertUnchangedNormalizedPath,
} from "./zotero-windows-file-safety";

export const LOCAL_PAPER_ROOT = "E:\\paper";

export interface ZoteroLocalPaperNameSyncHandle {
  shutdown(): void;
}

type NotifyEvent = "add" | "modify" | "refresh" | string;
type NotifyType = "item" | string;

export class ZoteroLocalPaperNameSyncObserver {
  private readonly pendingItemIDs = new Set<number>();
  private draining: Promise<void> | undefined;
  private active = true;

  constructor(
    private readonly resolveStoragePaths: (
      itemIDs: readonly number[],
    ) => Promise<readonly string[]>,
    private readonly synchronize: (
      storagePath: string,
    ) => Promise<LocalPaperNameSyncResult>,
    private readonly report: (
      storagePath: string,
      result: LocalPaperNameSyncResult | Error,
    ) => void,
  ) {}

  notify(
    event: NotifyEvent,
    type: NotifyType,
    ids: readonly (string | number)[],
  ): Promise<void> {
    if (
      !this.active ||
      type !== "item" ||
      !["add", "modify", "refresh"].includes(event)
    ) {
      return Promise.resolve();
    }
    for (const id of ids) {
      const itemID = Number(id);
      if (Number.isInteger(itemID) && itemID > 0) {
        this.pendingItemIDs.add(itemID);
      }
    }
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = undefined;
      });
    }
    return this.draining;
  }

  shutdown(): void {
    this.active = false;
    this.pendingItemIDs.clear();
  }

  private async drain(): Promise<void> {
    while (this.active && this.pendingItemIDs.size > 0) {
      const itemIDs = [...this.pendingItemIDs];
      this.pendingItemIDs.clear();
      const storagePaths = new Set(await this.resolveStoragePaths(itemIDs));
      for (const storagePath of storagePaths) {
        if (!this.active) return;
        try {
          this.report(storagePath, await this.synchronize(storagePath));
        } catch (error) {
          this.report(
            storagePath,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }
  }
}

export function startZoteroLocalPaperNameSync(
  paperRoot = LOCAL_PAPER_ROOT,
): ZoteroLocalPaperNameSyncHandle {
  const synchronizer = new LocalPaperNameSynchronizer(
    paperRoot,
    createZoteroLocalPaperFilePort(paperRoot),
  );
  const observer = new ZoteroLocalPaperNameSyncObserver(
    resolveStoredPdfPaths,
    (storagePath) => synchronizer.sync(storagePath),
    reportSyncResult,
  );
  const observerID = Zotero.Notifier.registerObserver(
    {
      notify(event, type, ids) {
        void observer.notify(event, type, ids);
      },
    },
    ["item"],
    "reference-for-zotero-local-paper-name-sync",
  );

  return {
    shutdown() {
      observer.shutdown();
      Zotero.Notifier.unregisterObserver(observerID);
    },
  };
}

function createZoteroLocalPaperFilePort(paperRoot: string): LocalPaperFilePort {
  return {
    async listPdfs(root) {
      return listPdfsRecursively(root);
    },
    async inspect(path) {
      if (!(await IOUtils.exists(path))) return undefined;
      const info = await IOUtils.stat(path);
      return info.type === "regular" && typeof info.size === "number"
        ? { path, size: info.size }
        : undefined;
    },
    sha256(path) {
      return IOUtils.computeHexDigest(path, "sha256");
    },
    exists(path) {
      return IOUtils.exists(path);
    },
    moveWithoutOverwrite(source, destination) {
      assertSafeLocalRename(paperRoot, source, destination);
      return IOUtils.move(source, destination, { noOverwrite: true });
    },
  };
}

async function listPdfsRecursively(root: string): Promise<readonly LocalPdf[]> {
  const rootDirectory = Zotero.File.pathToFile(root);
  if (!rootDirectory.exists()) return [];
  assertExistingRegularDirectory(rootDirectory, "Local paper root");
  assertUnchangedNormalizedPath(
    rootDirectory,
    root,
    "Local paper root cannot traverse a symbolic link or junction",
  );

  const pdfs: LocalPdf[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const path of await IOUtils.getChildren(directory, {
      ignoreAbsent: true,
    })) {
      const file = Zotero.File.pathToFile(path);
      if (file.isSymlink()) {
        throw new Error(
          `Local paper root cannot contain a symbolic link or junction: ${path}`,
        );
      }
      const info = await IOUtils.stat(path);
      if (info.type === "directory") {
        pending.push(path);
      } else if (
        info.type === "regular" &&
        typeof info.size === "number" &&
        path.toLowerCase().endsWith(".pdf")
      ) {
        pdfs.push({ path, size: info.size });
      }
    }
  }
  return pdfs;
}

function assertSafeLocalRename(
  rootPath: string,
  sourcePath: string,
  destinationPath: string,
): void {
  const root = Zotero.File.pathToFile(rootPath);
  const source = Zotero.File.pathToFile(sourcePath);
  const destinationParentPath = PathUtils.parent(destinationPath);
  if (!destinationParentPath) {
    throw new Error("Local PDF destination has no parent directory");
  }
  const destinationParent = Zotero.File.pathToFile(destinationParentPath);
  assertExistingRegularDirectory(root, "Local paper root");
  assertExistingRegularFile(source, "Local PDF source");
  assertExistingRegularDirectory(
    destinationParent,
    "Local PDF destination parent",
  );

  const traversalMessage =
    "Local PDF path cannot traverse a symbolic link or junction";
  assertUnchangedNormalizedPath(root, rootPath, traversalMessage);
  assertUnchangedNormalizedPath(source, sourcePath, traversalMessage);
  assertUnchangedNormalizedPath(
    destinationParent,
    destinationParentPath,
    traversalMessage,
  );
  if (!root.contains(source) || root.equals(source)) {
    throw new Error("Local PDF source escaped the paper root");
  }
  if (!root.equals(destinationParent) && !root.contains(destinationParent)) {
    throw new Error("Local PDF destination escaped the paper root");
  }
  if (!source.parent.equals(destinationParent)) {
    throw new Error("Local PDF rename must remain in its current directory");
  }
}

async function resolveStoredPdfPaths(
  itemIDs: readonly number[],
): Promise<readonly string[]> {
  const attachmentIDs = new Set<number>();
  for (const itemID of itemIDs) {
    const item = Zotero.Items.get(itemID);
    if (!item) continue;
    if (item.isRegularItem()) {
      item
        .getAttachments()
        .forEach((attachmentID) => attachmentIDs.add(attachmentID));
    } else if (item.isAttachment()) {
      attachmentIDs.add(itemID);
    }
  }

  const paths: string[] = [];
  for (const attachmentID of attachmentIDs) {
    const attachment = Zotero.Items.get(attachmentID);
    if (
      !attachment ||
      !attachment.parentID ||
      !attachment.isPDFAttachment() ||
      !attachment.isStoredFileAttachment()
    ) {
      continue;
    }
    const path = await attachment.getFilePathAsync();
    if (path) paths.push(path);
  }
  return paths;
}

function reportSyncResult(
  storagePath: string,
  result: LocalPaperNameSyncResult | Error,
): void {
  if (result instanceof Error) {
    Zotero.logError(result);
    return;
  }
  if (result.status === "renamed") {
    Zotero.debug(
      `Reference for Zotero renamed local PDF: ${result.sourcePath} -> ${result.destinationPath}`,
    );
    return;
  }
  if (result.status === "ambiguous" || result.status === "conflict") {
    Zotero.logError(
      new Error(
        `Reference for Zotero could not rename the local PDF for ${storagePath}: ${result.status}`,
      ),
    );
  }
}
