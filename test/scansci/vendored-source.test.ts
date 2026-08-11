import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const moduleRoot = path.resolve("addon/python/reference_for_zotero_scansci");

test("vendored source manifest pins the audited upstream fragments and local derivative", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(moduleRoot, "VENDORED-SOURCE.json"), "utf8"),
  ) as {
    upstream: {
      repository: string;
      commit: string;
      license: string;
      licensePath: string;
      licenseSha256: string;
      localLicenseSha256: string;
    };
    vendoredFiles: Array<{
      localPath: string;
      localSha256: string;
      fragments: Array<{
        upstreamPath: string;
        upstreamSha256: string;
        upstreamLines: string;
        modifications: string;
        dependencyReason: string;
      }>;
    }>;
    projectNamespaceFiles: string[];
  };

  assert.deepEqual(
    {
      repository: manifest.upstream.repository,
      commit: manifest.upstream.commit,
      license: manifest.upstream.license,
      licenseSha256: manifest.upstream.licenseSha256,
    },
    {
      repository: "Rimagination/scansci-pdf",
      commit: "5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5",
      license: "Apache-2.0",
      licenseSha256:
        "157476a42a347e0bf9f98e5b505b096f65d3d3261de985c633e9f81fc61281c4",
    },
  );
  assert.deepEqual(
    Object.fromEntries(
      manifest.vendoredFiles.flatMap((file) =>
        file.fragments.map((fragment) => [
          fragment.upstreamPath,
          fragment.upstreamSha256,
        ]),
      ),
    ),
    {
      "src/scansci_pdf/identifiers.py":
        "9f6af3f57e6c6b54d51cb7d5cd75a40d95f60bc957b2b669f5259bcaa3feba68",
      "src/scansci_pdf/sources/arxiv.py":
        "618a9fcb7c8bc200b9ea2480425f93ccc32fc382b2ad5c4d6d7bbac9b7fc96ab",
      "src/scansci_pdf/sources/europepmc.py":
        "e1bf0b237c4cc6e0cbcc212271c4e1f1b88459349e89fbddd98d1a0b58b387ee",
    },
  );
  for (const file of manifest.vendoredFiles) {
    assert.ok(file.fragments.length > 0);
    for (const fragment of file.fragments) {
      assert.ok(fragment.upstreamLines);
      assert.ok(fragment.modifications);
      assert.ok(fragment.dependencyReason);
    }
    assert.equal(
      await sha256(path.join(moduleRoot, file.localPath)),
      file.localSha256,
    );
  }
  assert.equal(
    await sha256(path.join(moduleRoot, manifest.upstream.licensePath)),
    manifest.upstream.localLicenseSha256,
  );
});

test("compatibility module contains no unregistered vendored or forbidden assets", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(moduleRoot, "VENDORED-SOURCE.json"), "utf8"),
  ) as {
    vendoredFiles: Array<{ localPath: string }>;
    projectNamespaceFiles: string[];
  };
  const actualVendored = (await filesBelow(path.join(moduleRoot, "vendored")))
    .map((file) => path.relative(moduleRoot, file).replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(
    actualVendored,
    [
      ...manifest.vendoredFiles.map((file) => file.localPath),
      ...manifest.projectNamespaceFiles,
    ].sort(),
  );

  const policy = JSON.parse(
    await readFile("test/xpi/package-policy.json", "utf8"),
  ) as {
    forbiddenPathSegments: string[];
    forbiddenNameFragments: string[];
    forbiddenSuffixes: string[];
  };
  const allFiles = await filesBelow(moduleRoot);
  for (const file of allFiles) {
    const relative = path.relative(moduleRoot, file).replaceAll("\\", "/");
    const normalized = relative.toLowerCase();
    const segments = new Set(normalized.split("/"));
    assert.equal(
      policy.forbiddenPathSegments.some((part) =>
        segments.has(part.toLowerCase()),
      ) ||
        policy.forbiddenNameFragments.some((fragment) =>
          normalized.includes(fragment.toLowerCase()),
        ) ||
        policy.forbiddenSuffixes.some((suffix) =>
          normalized.endsWith(suffix.toLowerCase()),
        ),
      false,
      `forbidden compatibility asset: ${relative}`,
    );
    if (file.endsWith(".py")) {
      assert.doesNotMatch(
        await readFile(file, "utf8"),
        /(?:from|import)\s+scansci_pdf\b/u,
      );
    }
  }
});

test("source-rules v3 enables only fixed open-access routes and forces legal-only", async () => {
  const rules = JSON.parse(
    await readFile(path.join(moduleRoot, "source-rules-v3.json"), "utf8"),
  ) as {
    schemaVersion: number;
    sourceRulesVersion: number;
    routes: Array<{ id: string; enabled: boolean; allowedHosts: string[] }>;
    prohibitedSources: string[];
    forcedPolicy: Record<string, unknown>;
  };

  assert.equal(rules.schemaVersion, 3);
  assert.equal(rules.sourceRulesVersion, 3);
  assert.deepEqual(
    rules.routes.filter((route) => route.enabled),
    [
      {
        id: "arxiv",
        enabled: true,
        kind: "open-access",
        allowedHosts: ["arxiv.org", "export.arxiv.org"],
      },
      {
        id: "pmc",
        enabled: true,
        kind: "open-access",
        allowedHosts: ["www.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov"],
      },
    ],
  );
  assert.deepEqual(rules.forcedPolicy, {
    strategy: "legal_only",
    scihubEnabled: false,
    useTor: false,
    useVpnsci: false,
  });
  assert.deepEqual(rules.prohibitedSources, [
    "scihub",
    "libgen",
    "scibban",
    "tor",
    "proxy-pool",
    "vpnsci",
    "unknown",
  ]);
});

test("runtime lock is compatibility-only and no institution deployment assets remain", async () => {
  const openAccessLock = await readFile(
    path.join(moduleRoot, "requirements.lock"),
    "utf8",
  );
  assert.deepEqual(pinnedPackages(openAccessLock), [
    "requests==2.34.2",
    "certifi==2026.7.22",
    "charset-normalizer==3.4.9",
    "idna==3.18",
    "urllib3==2.7.0",
  ]);
  assert.doesNotMatch(openAccessLock, /trusted-host|index-url|https?:\/\//iu);
  assert.match(openAccessLock, /--hash=sha256:[0-9a-f]{64}/u);

  const manifest = JSON.parse(
    await readFile(path.join(moduleRoot, "VENDORED-SOURCE.json"), "utf8"),
  ) as {
    runtimeDependencies: { installPolicy: string };
    institutionBrowserDependencyGovernance: {
      status: string;
      routeId: string;
    };
  };
  assert.match(manifest.runtimeDependencies.installPolicy, /never.*install/iu);
  assert.deepEqual(manifest.institutionBrowserDependencyGovernance, {
    status: "candidate",
    routeId: "institution-webvpn/ieee/one-click-single",
    reason:
      "Unavailable until complete real-world audit; no browser runtime, profile, credential or login command is exposed.",
  });
  const files = (await filesBelow(moduleRoot)).map((file) =>
    path.basename(file),
  );
  assert.equal(files.includes("institution-requirements.lock"), false);
  assert.equal(files.includes("browser-runtime-policy-v3.json"), false);
});

async function sha256(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

function pinnedPackages(lock: string): string[] {
  return lock
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[a-z][a-z0-9-]*==[^\s\\]+/u.test(line))
    .map((line) => line.split(/\s+/u)[0] ?? "");
}

async function filesBelow(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await filesBelow(absolute)));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}
