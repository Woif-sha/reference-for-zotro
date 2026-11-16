import assert from "node:assert/strict";
import test from "node:test";

import { createReaderControllerFactory } from "../../src/composition-root";
import type { RelatedPapersController } from "../../src/application/related-papers-controller";

for (const scheme of ["doi", "pmid"] as const) {
  test(`changing the parent ${scheme.toUpperCase()} cannot restore or relabel old Citations`, async (t) => {
    const runtime = installRuntime(t, scheme);
    const factory = createReaderControllerFactory();
    const first = factory.create({
      attachmentItemID: 42,
      body: {} as HTMLElement,
    }) as RelatedPapersController;
    t.after(() => first.dispose());
    await runtime.firstQuery;
    // The first query is still in flight when the user corrects the parent item.
    runtime.changeIdentifier();
    runtime.releaseFirstQuery();
    await waitForCitations(first);
    first.dispose();

    const second = factory.create({
      attachmentItemID: 42,
      body: {} as HTMLElement,
    }) as RelatedPapersController;
    t.after(() => second.dispose());
    await waitForCitations(second);

    assert.deepEqual(runtime.queries, [
      scheme === "doi" ? "doi:10.1000/current-a" : "pmid:111",
      scheme === "doi" ? "doi:10.1000/current-b" : "pmid:222",
    ]);
    assert.equal(second.getState().citingPapers[0]?.title, "Paper citing B");

    second.dispose();
    const restored = factory.create({
      attachmentItemID: 42,
      body: {} as HTMLElement,
    }) as RelatedPapersController;
    t.after(() => restored.dispose());
    await waitForCitations(restored);
    assert.equal(runtime.queries.length, 2);
    assert.equal(restored.getState().citingPapers[0]?.title, "Paper citing B");
  });
}

function installRuntime(t: test.TestContext, scheme: "doi" | "pmid") {
  const files = mineruFiles();
  const previousZotero = globalThis.Zotero;
  const previousIOUtils = globalThis.IOUtils;
  const previousFetch = globalThis.fetch;
  let changed = false;
  let announceFirstQuery!: () => void;
  let releaseFirstQuery!: () => void;
  const firstQuery = new Promise<void>((resolve) => {
    announceFirstQuery = resolve;
  });
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirstQuery = resolve;
  });
  const queries: string[] = [];
  const parent = {
    id: 24,
    key: "PARENT01",
    libraryID: 1,
    isAttachment: (): boolean => false,
    getField(field: string) {
      if (scheme === "doi" && field === "DOI") {
        return changed ? "10.1000/current-b" : "10.1000/current-a";
      }
      if (scheme === "pmid" && field === "extra") {
        return changed ? "PMID: 222" : "PMID: 111";
      }
      return "";
    },
  };
  Object.assign(globalThis, {
    Zotero: {
      DataDirectory: { dir: "C:\\Zotero" },
      Items: {
        get: (id: number) =>
          id === 42
            ? {
                id,
                key: "ATTACH01",
                libraryID: 1,
                parentItemID: 24,
                isAttachment: (): boolean => true,
              }
            : parent,
        getByLibraryAndKey: () => parent,
      },
    },
    IOUtils: {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => {
        const value = files.get(path);
        if (!value) throw new Error(`Missing test file: ${path}`);
        return value;
      },
      async write(path: string, value: Uint8Array) {
        files.set(path, value);
      },
      async copy(source: string, destination: string) {
        files.set(destination, files.get(source)!.slice());
      },
      async move(source: string, destination: string) {
        files.set(destination, files.get(source)!);
        files.delete(source);
      },
      async remove(path: string) {
        files.delete(path);
      },
      async makeDirectory() {},
    },
    async fetch(input: string) {
      const url = new URL(input);
      if (url.pathname.includes("/index/v2/citations/")) {
        const key = decodeURIComponent(url.pathname.split("/citations/")[1]!);
        queries.push(key);
        if (queries.length === 1) {
          announceFirstQuery();
          await firstResponse;
        }
        const label =
          key.endsWith("current-a") || key.endsWith(":111") ? "a" : "b";
        return Response.json([
          {
            oci: `123-${label}`,
            citing: `doi:10.1000/cites-${label}`,
            cited: key,
            creation: "2026-01-01",
          },
        ]);
      }
      if (url.pathname.includes("/meta/v1/metadata/")) {
        const label = input.includes("cites-a") ? "a" : "b";
        return Response.json([
          {
            id: `doi:10.1000/cites-${label}`,
            title: `Paper citing ${label.toUpperCase()}`,
            pub_date: "2026",
          },
        ]);
      }
      if (url.hostname === "doi.org") {
        const response = new Response("HTML", {
          headers: { "Content-Type": "text/html" },
        });
        Object.defineProperty(response, "url", {
          value: `https://example.test${url.pathname}`,
        });
        return response;
      }
      return new Response(null, { status: 404 });
    },
  });
  t.after(() => {
    releaseFirstQuery();
    Object.assign(globalThis, {
      Zotero: previousZotero,
      IOUtils: previousIOUtils,
      fetch: previousFetch,
    });
  });
  return {
    queries,
    firstQuery,
    releaseFirstQuery,
    changeIdentifier: () => {
      changed = true;
    },
  };
}

function mineruFiles(): Map<string, Uint8Array> {
  const directory = "C:\\Zotero\\llm-for-zotero-mineru\\42";
  const markdown = "## References\n[1] doi:10.1000/reference";
  const values = {
    "_llm_source.json": JSON.stringify({
      kind: "llm-for-zotero/mineru-cache-source",
      version: 2,
      attachmentId: 42,
      attachmentKey: "ATTACH01",
      parentItemKey: "PARENT01",
      origin: "parsed",
      recordedAt: "2026-07-30T00:00:00.000Z",
    }),
    "full.md": markdown,
    "manifest.json": JSON.stringify({
      totalChars: markdown.length,
      sections: [{ charStart: 0, charEnd: markdown.length }],
    }),
    "content_list.json": JSON.stringify([
      { type: "ref_text", text: "[1] doi:10.1000/reference" },
    ]),
  };
  return new Map(
    Object.entries(values).map(([name, text]) => [
      `${directory}\\${name}`,
      new TextEncoder().encode(text),
    ]),
  );
}

async function waitForCitations(controller: RelatedPapersController) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (controller.getState().citingPapersLoaded === 10) {
      // Cache persistence follows the state notification in the same load.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(
    `Citations did not load: ${JSON.stringify(controller.getState())}`,
  );
}
