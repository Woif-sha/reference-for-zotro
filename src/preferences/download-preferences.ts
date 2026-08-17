import type { DownloadSettingsController } from "../application/download-settings";
import type { ModelPreferencesController } from "../application/model-settings";
import { mountModelPreferences } from "./model-preferences";

export const REFERENCE_FOR_ZOTERO_PREFERENCES_ID =
  "reference-for-zotero-preferences";

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
  const cachePath = requiredElement(root, "[data-cache-directory-path]");
  const changeCache = requiredElement(root, "[data-change-cache-directory]");
  const cacheError = requiredElement(root, "[data-cache-directory-error]");
  const owner = root.ownerDocument.defaultView ?? undefined;
  const render = (): void => {
    const state = settings.getState();
    renderPath(path, state.downloadDestination);
    error.textContent = state.destinationError ?? "";
    error.toggleAttribute("hidden", !state.destinationError);
    renderPath(cachePath, state.cacheDirectory);
    cacheError.textContent = state.cacheDirectoryError ?? "";
    cacheError.toggleAttribute("hidden", !state.cacheDirectoryError);
  };
  const onChange = (): void => {
    void settings.changeDownloadDestination(owner);
  };
  const onChangeCache = (): void => {
    void settings.changeCacheDirectory(owner);
  };

  change.addEventListener("click", onChange);
  changeCache.addEventListener("click", onChangeCache);
  const unsubscribe = settings.subscribe(render);
  render();
  let active = true;

  return {
    destroy() {
      if (!active) return;
      active = false;
      change.removeEventListener("click", onChange);
      changeCache.removeEventListener("click", onChangeCache);
      unsubscribe();
    },
  };
}

export async function registerReferenceForZoteroPreferences(options: {
  manager: PreferencePanesPort;
  pluginID: string;
  rootURI: string;
  settings: DownloadSettingsController;
  modelSettings: ModelPreferencesController;
}): Promise<ReferenceForZoteroPreferencesHandle> {
  const paneID = await options.manager.register({
    pluginID: options.pluginID,
    id: REFERENCE_FOR_ZOTERO_PREFERENCES_ID,
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
      const ownerWindow = root.ownerDocument.defaultView;
      const mountedPreferences: MountedDownloadPreferences = {
        destroy() {
          ownerWindow?.removeEventListener("unload", onUnload);
          modelPreferences.destroy();
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

function renderPath(element: Element, value: string | undefined): void {
  element.textContent = value ?? "未配置";
  if (value) element.setAttribute("title", value);
  else element.removeAttribute("title");
}

function requiredElement(root: Element, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Preferences element is missing: ${selector}`);
  return element;
}
