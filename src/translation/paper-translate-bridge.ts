export type TranslationContext = {
  pluginID: string;
  itemID: number;
};

export type PaperTranslateGlobal = {
  api?: {
    getVersion?: () => unknown;
    translate?: (
      text: string,
      context: TranslationContext,
    ) => Promise<unknown> | unknown;
  };
};

export type TranslationCapability =
  | { available: true }
  | {
      available: false;
      reason: "not-installed" | "incompatible-version" | "incompatible-api";
    };

const MINIMUM_VERSION = [1, 4, 0] as const;

type CompatiblePaperTranslateAPI = {
  translate: NonNullable<NonNullable<PaperTranslateGlobal["api"]>["translate"]>;
};

export class PaperTranslateBridge {
  constructor(
    private readonly getPlugin: () => PaperTranslateGlobal | undefined,
  ) {}

  capability(): TranslationCapability {
    return this.resolveAPI().capability;
  }

  async translate(text: string, context: TranslationContext): Promise<string> {
    const resolved = this.resolveAPI();
    if (!("api" in resolved)) {
      throw new Error(
        `UI translation unavailable: ${resolved.capability.reason}`,
      );
    }
    const task = await resolved.api.translate(text, context);
    if (
      typeof task !== "object" ||
      task === null ||
      !("result" in task) ||
      typeof task.result !== "string"
    ) {
      throw new Error("UI translation failed: invalid Paper Translate result");
    }
    return task.result;
  }

  private resolveAPI():
    | {
        capability: { available: true };
        api: CompatiblePaperTranslateAPI;
      }
    | {
        capability: Exclude<TranslationCapability, { available: true }>;
      } {
    const plugin = this.getPlugin();
    if (!plugin) {
      return {
        capability: { available: false, reason: "not-installed" },
      };
    }
    if (typeof plugin.api?.getVersion !== "function") {
      return {
        capability: { available: false, reason: "incompatible-version" },
      };
    }
    let version: unknown;
    try {
      version = plugin.api.getVersion();
    } catch {
      return {
        capability: { available: false, reason: "incompatible-version" },
      };
    }
    if (
      typeof version !== "string" ||
      !versionAtLeast(version, MINIMUM_VERSION)
    ) {
      return {
        capability: { available: false, reason: "incompatible-version" },
      };
    }
    if (typeof plugin.api?.translate !== "function") {
      return {
        capability: { available: false, reason: "incompatible-api" },
      };
    }
    return {
      capability: { available: true },
      api: { translate: plugin.api.translate.bind(plugin.api) },
    };
  }
}

function versionAtLeast(
  version: string | undefined,
  minimum: readonly [number, number, number],
): boolean {
  const match = version?.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return false;
  const current = match.slice(1).map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return match[4] === undefined;
}
