import { BasicTool } from "zotero-plugin-toolkit";
import { config } from "../package.json";
import {
  startReferenceForZotero,
  type ReferenceForZoteroHandle,
} from "./addon";
import { createReaderControllerFactory } from "./composition-root";
import { DownloadSettingsCoordinator } from "./application/download-settings";
import { createScanSciDownloadPapers } from "./application/scan-sci-download";
import {
  createZoteroDownloadSettingsPorts,
  createZoteroOpenAlexSettings,
  zoteroSidecarDataRoot,
} from "./platform/zotero-download-settings";
import { createZoteroScanSciPort } from "./platform/zotero-scansci-runtime";
import {
  createZoteroModelSubsystem,
  type ZoteroModelSubsystem,
} from "./platform/zotero-model-runtime";
import {
  registerReferenceForZoteroPreferences,
  type PreferencePanesPort,
  type ReferenceForZoteroPreferencesHandle,
} from "./preferences/download-preferences";
import { testOpenAlexConnection } from "./literature/providers/openalex";
import { createProviderPorts } from "./platform/zotero-runtime";

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
    "PathUtils",
    "Services",
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
  let preferences: ReferenceForZoteroPreferencesHandle | undefined;
  let modelSubsystem: ZoteroModelSubsystem | undefined;

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
          sidecarDataRoot: zoteroSidecarDataRoot(),
        });
        const downloadSetup = new DownloadSettingsCoordinator(
          createZoteroDownloadSettingsPorts({
            runtime: scanSci,
          }),
        );
        const openAlexSettings = createZoteroOpenAlexSettings();
        const openAlexConnectionPorts = createProviderPorts();
        modelSubsystem = createZoteroModelSubsystem();
        preferences = await registerReferenceForZoteroPreferences({
          manager: Zotero.PreferencePanes as unknown as PreferencePanesPort,
          pluginID: config.addonID,
          rootURI: packagedRootURI,
          settings: downloadSetup,
          openAlexSettings,
          testOpenAlexConnection: (apiKey, signal) =>
            testOpenAlexConnection(apiKey, openAlexConnectionPorts, signal),
          openExternalURL: (url) => Zotero.launchURL(url),
          modelSettings: modelSubsystem.settings,
        });
        handle = startReferenceForZotero({
          factory: createReaderControllerFactory({
            downloadPapers: createScanSciDownloadPapers({
              runtime: scanSci,
              setup: downloadSetup,
            }),
            recommendationModel: modelSubsystem.recommendationModel,
            openAlexApiKey: () => openAlexSettings.getApiKey(),
          }),
          downloadSetup,
        });
      },
      onMainWindowLoad,
      onMainWindowUnload,
      onPreferencesLoad(root: Element): void {
        preferences?.mount(root);
      },
      onShutdown(): void {
        preferences?.unregister();
        preferences = undefined;
        handle?.shutdown();
        handle = undefined;
        modelSubsystem?.shutdown();
        modelSubsystem = undefined;
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
