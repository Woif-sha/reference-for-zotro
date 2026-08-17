import type { DownloadSettingsController } from "../application/download-settings";
import type { CacheSettingsController } from "../application/cache-settings";
import type { ModelPreferencesController } from "../application/model-settings";
import { mountCachePreferences } from "./cache-preferences";
import { mountModelPreferences } from "./model-preferences";

export type PreferencePaneOptions = Readonly<{
  pluginID: string;
  id: string;
  label: string;
  src: string;
  stylesheets: readonly string[];
}>;

export interface PreferencePanesPort {
  register(options: PreferencePaneOptions): Promise<string>;
  unregister(id: string): void;
}

export interface MountedDownloadPreferences {
  destroy(): void;
}

export interface ReferenceForZoteroPreferencesHandle {
  mount(root: Element): void;
  unregister(): void;
}

export function mountDownloadPreferences(
  root: Element,
  settings: DownloadSettingsController,
): MountedDownloadPreferences {
  const path = requiredElement(root, "[data-download-directory-path]");
  const change = requiredElement(root, "[data-change-download-directory]");
  const error = requiredElement(root, "[data-download-directory-error]");
  const owner = root.ownerDocument.defaultView ?? undefined;
  const render = (): void => {
    const state = settings.getState();
    path.textContent = state.downloadDestination;
    path.setAttribute("title", state.downloadDestination);
    error.textContent = state.destinationError ?? "";
    error.toggleAttribute("hidden", !state.destinationError);
  };
  const onChange = (): void => {
    void settings.changeDownloadDestination(owner);
  };

  change.addEventListener("click", onChange);
  const unsubscribe = settings.subscribe(render);
  render();
  let active = true;

  return {
    destroy() {
      if (!active) return;
      active = false;
      change.removeEventListener("click", onChange);
      unsubscribe();
    },
  };
}

export async function registerReferenceForZoteroPreferences(options: {
  manager: PreferencePanesPort;
  pluginID: string;
  rootURI: string;
  settings: DownloadSettingsController;
  cacheSettings: CacheSettingsController;
  modelSettings: ModelPreferencesController;
}): Promise<ReferenceForZoteroPreferencesHandle> {
  const paneID = await options.manager.register({
    pluginID: options.pluginID,
    id: "reference-for-zotero-preferences",
    label: "Reference for Zotero",
    src: `${options.rootURI}chrome/content/preferences.xhtml`,
    stylesheets: [`${options.rootURI}chrome/content/preferences.css`],
  });
  const mounted = new Map<Element, MountedDownloadPreferences>();
  let active = true;

  return {
    mount(root) {
      if (!active) return;
      mounted.get(root)?.destroy();
      const downloadPreferences = mountDownloadPreferences(
        root,
        options.settings,
      );
      const modelPreferences = mountModelPreferences(
        root,
        options.modelSettings,
      );
      const cachePreferences = mountCachePreferences(
        root,
        options.cacheSettings,
      );
      const ownerWindow = root.ownerDocument.defaultView;
      const mountedPreferences: MountedDownloadPreferences = {
        destroy() {
          ownerWindow?.removeEventListener("unload", onUnload);
          modelPreferences.destroy();
          cachePreferences.destroy();
          downloadPreferences.destroy();
          if (mounted.get(root) === mountedPreferences) mounted.delete(root);
        },
      };
      const onUnload = (): void => mountedPreferences.destroy();
      mounted.set(root, mountedPreferences);
      ownerWindow?.addEventListener("unload", onUnload, { once: true });
    },
    unregister() {
      if (!active) return;
      active = false;
      for (const preferences of [...mounted.values()]) preferences.destroy();
      mounted.clear();
      options.manager.unregister(paneID);
    },
  };
}

function requiredElement(root: Element, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Preferences element is missing: ${selector}`);
  return element;
}
