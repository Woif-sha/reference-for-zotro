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

type WindowsFileAttributesModule = Readonly<{
  winapi_abi: unknown;
  uint32_t: unknown;
  char16_t: Readonly<{ ptr: unknown }>;
  winLastError: number;
  open(name: string): {
    declare(
      name: string,
      abi: unknown,
      resultType: unknown,
      argumentType: unknown,
    ): (path: string) => number;
    close(): void;
  };
}>;

export function assertNoWindowsReparsePoints(
  file: nsIFile,
  message: string,
): void {
  // Windows nsIFile.isSymlink() is always false in Gecko 140, and normalize()
  // does not resolve junctions. Read each path component's native attributes.
  const { ctypes } = ChromeUtils.importESModule(
    "resource://gre/modules/ctypes.sys.mjs",
  ) as { ctypes: WindowsFileAttributesModule };
  const library = ctypes.open("kernel32.dll");
  try {
    const getFileAttributes = library.declare(
      "GetFileAttributesW",
      ctypes.winapi_abi,
      ctypes.uint32_t,
      ctypes.char16_t.ptr,
    );
    for (
      let ancestor: nsIFile | null = file;
      ancestor;
      ancestor = ancestor.parent
    ) {
      // A UNC share is the namespace root, not a traversable directory node;
      // GetFileAttributesW cannot query it. Every path below it is checked.
      if (/^\\\\[^\\]+\\[^\\]+\\?$/u.test(ancestor.path)) break;
      // Gecko stores drive roots as "E:", which Win32 otherwise treats as
      // the current directory on that drive rather than its absolute root.
      const path = /^[A-Za-z]:$/u.test(ancestor.path)
        ? `${ancestor.path}\\`
        : ancestor.path;
      const attributes = getFileAttributes(path);
      if (attributes === 0xffffffff) {
        throw new Error(
          `Cannot inspect Windows path attributes (${ctypes.winLastError}): ${ancestor.path}`,
        );
      }
      if (attributes & 0x400) throw new Error(`${message}: ${ancestor.path}`);
    }
  } finally {
    library.close();
  }
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
