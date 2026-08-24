export type LocalPdf = Readonly<{
  path: string;
  size: number;
}>;

export interface LocalPaperFilePort {
  listPdfs(root: string): Promise<readonly LocalPdf[]>;
  inspect(path: string): Promise<LocalPdf | undefined>;
  sha256(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  moveWithoutOverwrite(source: string, destination: string): Promise<void>;
}

export type LocalPaperNameSyncResult =
  | Readonly<{ status: "renamed"; sourcePath: string; destinationPath: string }>
  | Readonly<{ status: "unchanged"; path: string }>
  | Readonly<{ status: "not-found"; storagePath: string }>
  | Readonly<{
      status: "ambiguous";
      storagePath: string;
      matchingPaths: readonly string[];
    }>
  | Readonly<{
      status: "conflict";
      sourcePath: string;
      destinationPath: string;
    }>;

export class LocalPaperNameSynchronizer {
  constructor(
    private readonly paperRoot: string,
    private readonly files: LocalPaperFilePort,
  ) {}

  async sync(storagePath: string): Promise<LocalPaperNameSyncResult> {
    const storage = await this.files.inspect(storagePath);
    if (!storage) return { status: "not-found", storagePath };

    const storageHash = normalizedHash(await this.files.sha256(storagePath));
    const candidates = (await this.files.listPdfs(this.paperRoot)).filter(
      (candidate) => candidate.size === storage.size,
    );
    const matchingPaths: string[] = [];
    for (const candidate of candidates) {
      if (
        normalizedHash(await this.files.sha256(candidate.path)) === storageHash
      ) {
        matchingPaths.push(candidate.path);
      }
    }

    if (matchingPaths.length === 0) {
      return { status: "not-found", storagePath };
    }
    if (matchingPaths.length > 1) {
      return { status: "ambiguous", storagePath, matchingPaths };
    }

    const sourcePath = matchingPaths[0];
    const destinationPath = replaceWindowsFilename(
      sourcePath,
      windowsFilename(storagePath),
    );
    if (sameWindowsPath(sourcePath, destinationPath)) {
      return { status: "unchanged", path: sourcePath };
    }
    if (await this.files.exists(destinationPath)) {
      return { status: "conflict", sourcePath, destinationPath };
    }

    await this.files.moveWithoutOverwrite(sourcePath, destinationPath);
    const [sourceStillExists, destinationExists, destinationHash] =
      await Promise.all([
        this.files.exists(sourcePath),
        this.files.exists(destinationPath),
        this.files.sha256(destinationPath),
      ]);
    if (
      sourceStillExists ||
      !destinationExists ||
      normalizedHash(destinationHash) !== storageHash
    ) {
      throw new Error(
        `Local PDF rename did not preserve the matched file: ${sourcePath}`,
      );
    }

    return { status: "renamed", sourcePath, destinationPath };
  }
}

function normalizedHash(value: string): string {
  return value.trim().toLowerCase();
}

function windowsFilename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/u, "")
      .split(/[\\/]/u)
      .at(-1) ?? ""
  );
}

function replaceWindowsFilename(path: string, filename: string): string {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separator < 0
    ? filename
    : `${path.slice(0, separator + 1)}${filename}`;
}

function sameWindowsPath(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
