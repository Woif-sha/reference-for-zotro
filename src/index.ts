import { BasicTool } from "zotero-plugin-toolkit";
import { config } from "../package.json";
import {
  startReferenceForZotero,
  type ReferenceForZoteroHandle,
} from "./addon";
import { createReaderControllerFactory } from "./composition-root";

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
        handle = startReferenceForZotero(createReaderControllerFactory());
      },
      onMainWindowLoad,
      onMainWindowUnload,
      onShutdown(): void {
        handle?.shutdown();
        handle = undefined;
        Zotero.getMainWindows().forEach((window) => {
          void onMainWindowUnload(window);
        });
        delete zotero[config.addonInstance];
      },
    },
  };
}
