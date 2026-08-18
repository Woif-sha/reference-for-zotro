import {
  CACHE_DIRECTORY_REQUIRED_ERROR,
  DOWNLOAD_DESTINATION_REQUIRED_ERROR,
  type DownloadSettingsController,
} from "../application/download-settings";
import type { ModelPreferencesController } from "../application/model-settings";
import type { OpenAlexSettingsController } from "../application/openalex-settings";
import type { OpenAlexConnectionResult } from "../literature/providers/openalex";
import { mountModelPreferences } from "./model-preferences";

export const REFERENCE_FOR_ZOTERO_PREFERENCES_ID =
  "reference-for-zotero-preferences";
export const OPENALEX_SETTINGS_URL = "https://openalex.org/settings/api";

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

export type OpenAlexConnectionTest = (
  apiKey: string,
  signal?: AbortSignal,
) => Promise<OpenAlexConnectionResult>;

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
    renderError(
      error,
      state.destinationError === DOWNLOAD_DESTINATION_REQUIRED_ERROR
        ? undefined
        : state.destinationError,
    );
    renderPath(cachePath, state.cacheDirectory);
    renderError(
      cacheError,
      state.cacheDirectoryError === CACHE_DIRECTORY_REQUIRED_ERROR
        ? undefined
        : state.cacheDirectoryError,
    );
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

export function mountOpenAlexPreferences(
  root: Element,
  settings: OpenAlexSettingsController,
  openExternalURL: (url: string) => void,
  testConnection: OpenAlexConnectionTest,
): MountedDownloadPreferences {
  const input = requiredElement<HTMLInputElement>(
    root,
    "[data-openalex-api-key]",
  );
  const registrationLink = requiredElement<HTMLAnchorElement>(
    root,
    "[data-openalex-api-registration]",
  );
  const testButton = requiredElement<HTMLButtonElement>(
    root,
    "[data-test-openalex-connection]",
  );
  const status = requiredElement<HTMLElement>(
    root,
    "[data-openalex-connection-status]",
  );
  input.value = settings.getApiKey() ?? "";
  let activeTest: AbortController | undefined;

  const onChange = (): void => settings.setApiKey(input.value);
  const onInput = (): void => {
    activeTest?.abort();
    activeTest = undefined;
    testButton.disabled = false;
    renderOpenAlexConnectionStatus(status);
  };
  const onOpenRegistration = (event: Event): void => {
    event.preventDefault();
    openExternalURL(OPENALEX_SETTINGS_URL);
  };
  const onTestConnection = (): void => {
    activeTest?.abort();
    const controller = new AbortController();
    activeTest = controller;
    settings.setApiKey(input.value);
    testButton.disabled = true;
    renderOpenAlexConnectionStatus(status, "正在测试…", "testing");
    void testConnection(input.value.trim(), controller.signal)
      .then(({ dailyRemainingUsd }) => {
        if (controller.signal.aborted) return;
        renderOpenAlexConnectionStatus(
          status,
          `✓ 连接成功，剩余可用余额：$${formatUsd(dailyRemainingUsd)}`,
          "success",
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        renderOpenAlexConnectionStatus(
          status,
          `✕ 连接失败：${errorMessage(error)}`,
          "error",
        );
      })
      .finally(() => {
        if (activeTest !== controller) return;
        activeTest = undefined;
        testButton.disabled = false;
      });
  };

  input.addEventListener("input", onInput);
  input.addEventListener("change", onChange);
  registrationLink.addEventListener("click", onOpenRegistration);
  testButton.addEventListener("click", onTestConnection);
  let active = true;
  return {
    destroy() {
      if (!active) return;
      active = false;
      activeTest?.abort();
      activeTest = undefined;
      input.removeEventListener("input", onInput);
      input.removeEventListener("change", onChange);
      registrationLink.removeEventListener("click", onOpenRegistration);
      testButton.removeEventListener("click", onTestConnection);
    },
  };
}

export async function registerReferenceForZoteroPreferences(options: {
  manager: PreferencePanesPort;
  pluginID: string;
  rootURI: string;
  settings: DownloadSettingsController;
  openAlexSettings: OpenAlexSettingsController;
  testOpenAlexConnection: OpenAlexConnectionTest;
  openExternalURL(url: string): void;
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
      const openAlexPreferences = mountOpenAlexPreferences(
        root,
        options.openAlexSettings,
        options.openExternalURL,
        options.testOpenAlexConnection,
      );
      const ownerWindow = root.ownerDocument.defaultView;
      const mountedPreferences: MountedDownloadPreferences = {
        destroy() {
          ownerWindow?.removeEventListener("unload", onUnload);
          modelPreferences.destroy();
          openAlexPreferences.destroy();
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
  element.classList.toggle("reference-for-zotero-path-unconfigured", !value);
  if (value) element.setAttribute("title", value);
  else element.removeAttribute("title");
}

function renderError(element: Element, value: string | undefined): void {
  element.textContent = value ?? "";
  element.toggleAttribute("hidden", !value);
}

function renderOpenAlexConnectionStatus(
  element: HTMLElement,
  message?: string,
  state?: "testing" | "success" | "error",
): void {
  element.textContent = message ?? "";
  element.hidden = !message;
  if (state) element.dataset.state = state;
  else delete element.dataset.state;
}

function formatUsd(value: number): string {
  return value.toFixed(4);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredElement<T extends Element = Element>(
  root: Element,
  selector: string,
): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Preferences element is missing: ${selector}`);
  return element as T;
}
