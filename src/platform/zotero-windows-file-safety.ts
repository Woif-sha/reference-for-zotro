export function assertExistingRegularDirectory(
  file: nsIFile,
  label: string,
): void {
  assertExistingNonLink(file, label);
  if (!file.isDirectory()) throw new Error(`${label} is not a directory`);
}

export function assertExistingRegularFile(file: nsIFile, label: string): void {
  assertExistingNonLink(file, label);
  if (!file.isFile()) throw new Error(`${label} is not a regular file`);
}

export function assertUnchangedNormalizedPath(
  file: nsIFile,
  requestedPath: string,
  message: string,
): void {
  file.normalize();
  if (!sameWindowsPath(file.path, requestedPath)) throw new Error(message);
}

export function sameWindowsPath(left: string, right: string): boolean {
  return (
    left.replace(/\//gu, "\\").toLowerCase() ===
    right.replace(/\//gu, "\\").toLowerCase()
  );
}

function assertExistingNonLink(file: nsIFile, label: string): void {
  if (!file.exists()) throw new Error(`${label} does not exist`);
  if (file.isSymlink()) {
    throw new Error(`${label} cannot be a symbolic link or junction`);
  }
}
