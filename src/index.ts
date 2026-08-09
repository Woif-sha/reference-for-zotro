import { BasicTool } from "zotero-plugin-toolkit";
import { config } from "../package.json";
import {
  startReferenceForZotero,
  type ReferenceForZoteroHandle,
} from "./addon";
import { createReaderControllerFactory } from "./composition-root";
import { DownloadFirstUseCoordinator } from "./application/download-first-use";
import { createScanSciDownloadDependencies } from "./application/scan-sci-download";
import {
  createZoteroDownloadFirstUsePorts,
  zoteroPrivateRuntimeRoot,
} from "./platform/zotero-download-first-use";
import { createZoteroScanSciPort } from "./platform/zotero-scansci-runtime";

const basicTool = new BasicTool();
const zotero = basicTool.getGlobal("Zotero") as typeof Zotero & {
  [key: string]: unknown;
};

if (!zotero[config.addonInstance]) {
  _globalThis.Zotero = zotero;
  for (const name of [
    "AbortController",
    "AbortSignal",
    "crypto",
    "DOMException",
    "fetch",
    "IOUtils",
    "TextDecoder",
    "TextEncoder",
  ]) {
    defineRuntimeGlobal(name);
  }
  const runtime = createRuntime();
  zotero[config.addonInstance] = runtime;
  void runtime.hooks.onStartup().catch((error) => {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  });
}

function defineRuntimeGlobal(name: string): void {
  Object.defineProperty(_globalThis, name, {
    configurable: true,
    get() {
      return basicTool.getGlobal(name as Parameters<BasicTool["getGlobal"]>[0]);
    },
  });
}

function createRuntime() {
  let handle: ReferenceForZoteroHandle | undefined;
  let downloadSetup: DownloadFirstUseCoordinator | undefined;

  const onMainWindowLoad = async (window: Window): Promise<void> => {
    (
      window as Window & {
        MozXULElement?: {
          insertFTLIfNeeded(resource: string): void;
        };
      }
    ).MozXULElement?.insertFTLIfNeeded(`${config.addonRef}-addon.ftl`);
  };

  const onMainWindowUnload = async (window: Window): Promise<void> => {
    window.document
      .querySelector(`[href="${config.addonRef}-addon.ftl"]`)
      ?.remove();
  };

  return {
    hooks: {
      async onStartup(): Promise<void> {
        await Promise.all([
          Zotero.initializationPromise,
          Zotero.unlockPromise,
          Zotero.uiReadyPromise,
        ]);
        await Promise.all(
          Zotero.getMainWindows().map((window) => onMainWindowLoad(window)),
        );
        const packagedRootURI = resolvePackagedRootURI();
        const scanSci = createZoteroScanSciPort({
          packagedRootURI,
          privateRuntimeRoot: zoteroPrivateRuntimeRoot(),
        });
        downloadSetup = new DownloadFirstUseCoordinator(
          createZoteroDownloadFirstUsePorts({
            runtime: scanSci,
            packagedRootURI,
          }),
        );
        handle = startReferenceForZotero(
          createReaderControllerFactory(
            createScanSciDownloadDependencies({
              runtime: scanSci,
              setup: downloadSetup,
            }),
          ),
        );
      },
      onMainWindowLoad,
      onMainWindowUnload,
      onShutdown(): void {
        handle?.shutdown();
        handle = undefined;
        downloadSetup?.dispose();
        downloadSetup = undefined;
        Zotero.getMainWindows().forEach((window) => {
          void onMainWindowUnload(window);
        });
        delete zotero[config.addonInstance];
      },
    },
  };
}

function resolvePackagedRootURI(): string {
  const value = (_globalThis as typeof _globalThis & { rootURI?: unknown })
    .rootURI;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Cannot resolve the packaged add-on root URI");
  }
  return value;
}
