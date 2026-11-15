import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

// Read the actual Win32 contract rather than teaching an isSymlink stub to
// recognize junctions: Gecko's Windows nsIFile reports false for those paths.
export function nativeWindowsAttributes(
  paths: readonly string[],
): Record<string, number> {
  const ancestors = new Set<string>();
  for (const requested of paths) {
    let current = requested;
    while (!ancestors.has(current)) {
      ancestors.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class RfzAttributes {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetFileAttributesW(string path);
}
'@
$result = @{}
foreach ($path in (ConvertFrom-Json $env:RFZ_ATTRIBUTE_PATHS)) {
  $result[$path] = [RfzAttributes]::GetFileAttributesW($path)
}
ConvertTo-Json -Compress $result
`,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          RFZ_ATTRIBUTE_PATHS: JSON.stringify([...ancestors]),
        },
      },
    ),
  ) as Record<string, number>;
}

export function installNativeWindowsAttributes(
  attributes: Record<string, number>,
): string[] {
  const nativeCalls: string[] = [];
  Object.assign(globalThis, {
    ChromeUtils: {
      importESModule(uri: string) {
        assert.equal(uri, "resource://gre/modules/ctypes.sys.mjs");
        return {
          ctypes: {
            winapi_abi: "winapi_abi",
            uint32_t: "uint32_t",
            char16_t: { ptr: "char16_t.ptr" },
            winLastError: 0,
            open(name: string) {
              assert.equal(name.toLowerCase(), "kernel32.dll");
              return {
                declare(...declaration: unknown[]) {
                  assert.deepEqual(declaration, [
                    "GetFileAttributesW",
                    "winapi_abi",
                    "uint32_t",
                    "char16_t.ptr",
                  ]);
                  return (value: string) => {
                    nativeCalls.push(value);
                    assert.ok(
                      Object.hasOwn(attributes, value),
                      `Unmeasured native path: ${value}`,
                    );
                    return attributes[value];
                  };
                },
                close() {},
              };
            },
          },
        };
      },
    },
  });
  return nativeCalls;
}

export function geckoWindowsFile(value: string): object {
  // Gecko InitWithPath removes a trailing backslash, including at drive roots.
  const filePath = value.replace(/\\$/u, "");
  return {
    path: filePath,
    get parent() {
      if (/^[A-Za-z]:$/u.test(filePath)) return null;
      const parent = path.win32.dirname(filePath);
      return parent === filePath ? null : geckoWindowsFile(parent);
    },
    exists: () => existsSync(value),
    isDirectory: () => statSync(value).isDirectory(),
    isFile: () => statSync(value).isFile(),
    isSymlink: () => false,
    normalize() {},
    contains: (other: { path: string }) =>
      other.path.toLowerCase().startsWith(`${value.toLowerCase()}\\`),
    equals: (other: { path: string }) =>
      value.toLowerCase() === other.path.toLowerCase(),
  };
}
