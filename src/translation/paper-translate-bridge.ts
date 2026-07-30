export type TranslationContext = {
  pluginID: string;
  itemID: number;
};

export type PaperTranslateGlobal = {
  api?: {
    getVersion?: () => string;
    translate?: (
      text: string,
      context: TranslationContext,
    ) => Promise<{ result?: unknown }> | { result?: unknown };
  };
};

export type TranslationCapability =
  | { available: true }
  | {
      available: false;
      reason: "not-installed" | "incompatible-version" | "incompatible-api";
    };

const MINIMUM_VERSION = [1, 4, 0] as const;

export class PaperTranslateBridge {
  constructor(
    private readonly getPlugin: () => PaperTranslateGlobal | undefined,
  ) {}

  capability(): TranslationCapability {
    const plugin = this.getPlugin();
    if (!plugin) return { available: false, reason: "not-installed" };
    if (
      typeof plugin.api?.getVersion !== "function" ||
      !versionAtLeast(plugin.api.getVersion(), MINIMUM_VERSION)
    ) {
      return { available: false, reason: "incompatible-version" };
    }
    if (typeof plugin.api?.translate !== "function") {
      return { available: false, reason: "incompatible-api" };
    }
    return { available: true };
  }

  async translate(text: string, context: TranslationContext): Promise<string> {
    const capability = this.capability();
    if (!capability.available) {
      throw new Error(`UI translation unavailable: ${capability.reason}`);
    }
    const translate = this.getPlugin()?.api?.translate;
    if (!translate) {
      throw new Error("UI translation unavailable: incompatible-api");
    }
    const task = await translate(text, context);
    if (typeof task?.result !== "string") {
      throw new Error("UI translation failed: invalid Paper Translate result");
    }
    return task.result;
  }
}

function versionAtLeast(
  version: string | undefined,
  minimum: readonly [number, number, number],
): boolean {
  const match = version?.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return false;
  const current = match.slice(1).map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}
