import type { CacheSettingsController } from "../application/cache-settings";

export interface MountedCachePreferences {
  destroy(): void;
}

export function mountCachePreferences(
  root: Element,
  settings: CacheSettingsController,
): MountedCachePreferences {
  const path = requiredElement(root, "[data-cache-directory-path]");
  const change = requiredElement(root, "[data-change-cache-directory]");
  const reset = requiredElement(root, "[data-reset-cache-directory]");
  const error = requiredElement(root, "[data-cache-directory-error]");
  const owner = root.ownerDocument.defaultView ?? undefined;
  const render = (): void => {
    const state = settings.getState();
    path.textContent = state.cacheRoot;
    path.setAttribute("title", state.cacheRoot);
    reset.toggleAttribute("disabled", state.usingDefaultRoot);
    error.textContent = state.rootError ?? "";
    error.toggleAttribute("hidden", !state.rootError);
  };
  const onChange = (): void => {
    void settings.changeCacheRoot(owner);
  };
  const onReset = (): void => settings.resetCacheRoot();

  change.addEventListener("click", onChange);
  reset.addEventListener("click", onReset);
  const unsubscribe = settings.subscribe(render);
  render();
  let active = true;

  return {
    destroy() {
      if (!active) return;
      active = false;
      change.removeEventListener("click", onChange);
      reset.removeEventListener("click", onReset);
      unsubscribe();
    },
  };
}

function requiredElement(root: Element, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Preferences element is missing: ${selector}`);
  return element;
}
