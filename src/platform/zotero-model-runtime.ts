import { RecommendationModelSettingsCoordinator } from "../application/model-settings";
import { ConfiguredRecommendationModel } from "../model/configured-recommendation-model";
import {
  LegacyCodexTransport,
  type LegacyCodexRuntime,
} from "../model/legacy-codex-transport";
import { ModelSettingsStore } from "../model/model-configuration";
import { ModelConnectionTester } from "../model/model-connection-tester";
import {
  runOpenAICompatibleRequest,
  testOpenAICompatibleConnection,
} from "../model/openai-compatible-transport";

export type ZoteroModelSubsystem = Readonly<{
  settings: RecommendationModelSettingsCoordinator;
  recommendationModel: ConfiguredRecommendationModel;
  shutdown(): void;
}>;

export function createZoteroModelSubsystem(): ZoteroModelSubsystem {
  const runtime = legacyRuntime();
  const store = new ModelSettingsStore({
    get(key) {
      const value = Zotero.Prefs.get(key, true);
      return typeof value === "string" && value.trim() ? value : undefined;
    },
    set(key, value) {
      Zotero.Prefs.set(key, value, true);
    },
  });
  const legacy = new LegacyCodexTransport(runtime);
  const recommendationModel = new ConfiguredRecommendationModel(
    () => store.getConfiguration(),
    {
      legacy: (request) => legacy.run(request),
      openAICompatible: (request) =>
        runOpenAICompatibleRequest({ ...request, fetch: runtime.fetch }),
    },
  );
  const connectionTester = new ModelConnectionTester({
    legacy: (model, signal) =>
      legacy.testConnection(model.model, model.effort, signal),
    openAICompatible: (model, signal) =>
      testOpenAICompatibleConnection({
        endpoint: model.apiBase,
        apiKey: model.apiKey,
        model: model.model,
        signal,
        fetch: runtime.fetch,
      }),
  });
  const settings = new RecommendationModelSettingsCoordinator(
    store,
    connectionTester,
    () => recommendationModel.cancelActiveRequests(),
  );
  let active = true;
  return {
    settings,
    recommendationModel,
    shutdown() {
      if (!active) return;
      active = false;
      settings.dispose();
      recommendationModel.shutdown();
      legacy.shutdown();
    },
  };
}

function legacyRuntime(): LegacyCodexRuntime {
  const globals = globalThis as typeof globalThis & {
    IOUtils?: LegacyCodexRuntime["io"];
    PathUtils?: { homeDir?: string };
    Services?: {
      env?: { get(name: string): string | undefined };
      dirsvc?: { get(name: string, type: unknown): { path?: string } };
    };
    Ci?: { nsIFile?: unknown };
    Components?: { interfaces?: { nsIFile?: unknown } };
  };
  if (!globals.IOUtils) throw new Error("IOUtils is unavailable");
  const runtimeFetch = globals.fetch;
  if (!runtimeFetch) throw new Error("fetch is unavailable");
  return {
    environment(name) {
      return globals.Services?.env?.get(name);
    },
    pathUtilsHome: globals.PathUtils?.homeDir,
    zoteroHome: resolveZoteroHome(globals),
    io: globals.IOUtils,
    fetch: runtimeFetch.bind(globalThis),
  };
}

function resolveZoteroHome(globals: {
  Services?: {
    dirsvc?: { get(name: string, type: unknown): { path?: string } };
  };
  Ci?: { nsIFile?: unknown };
  Components?: { interfaces?: { nsIFile?: unknown } };
}): string | undefined {
  const nsIFile =
    globals.Ci?.nsIFile ?? globals.Components?.interfaces?.nsIFile;
  if (!nsIFile || !globals.Services?.dirsvc) return undefined;
  return globals.Services.dirsvc.get("Home", nsIFile).path;
}
