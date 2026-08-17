export const OPENALEX_API_KEY_PREFERENCE =
  "extensions.referenceforzotero.openAlexApiKey";

export interface OpenAlexSettingsPreferences {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface OpenAlexSettingsController {
  getApiKey(): string | undefined;
  setApiKey(value: string): void;
}

export class OpenAlexSettingsStore implements OpenAlexSettingsController {
  constructor(private readonly preferences: OpenAlexSettingsPreferences) {}

  getApiKey(): string | undefined {
    const value = this.preferences.get(OPENALEX_API_KEY_PREFERENCE)?.trim();
    return value || undefined;
  }

  setApiKey(value: string): void {
    this.preferences.set(OPENALEX_API_KEY_PREFERENCE, value.trim());
  }
}
