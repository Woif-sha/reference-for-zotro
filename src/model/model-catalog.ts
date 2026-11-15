import {
  LEGACY_CODEX_RESPONSES_ENDPOINT,
  normalizeChatCompletionsEndpoint,
  type ModelProvider,
} from "./model-configuration";
import { redactError } from "./openai-compatible-transport";
import { modelCreationTime, sortDiscoveredModels } from "./model-catalog-sort";

export type DiscoveredModel = {
  id: string;
  name: string;
  outputModalities?: string[];
  createdAt?: number;
};

const MAX_MODELS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;

/** API-key catalogs stay on the configured origin and never use Codex tokens. */
export function resolveModelCatalog(provider: ModelProvider): string {
  if (provider.authMode !== "openai_compatible") {
    throw new Error("API Key authentication is required for this catalog");
  }
  if (!provider.apiKey.trim()) {
    throw new Error("请先填写 API 密钥 / API key required");
  }
  const endpoint = new URL(normalizeChatCompletionsEndpoint(provider.apiBase));
  endpoint.pathname = endpoint.pathname.replace(
    /\/chat\/completions$/iu,
    "/models",
  );
  return endpoint.href;
}

export async function fetchProviderModels(
  provider: ModelProvider,
  options: {
    fetch: typeof fetch;
    fetchCodexModels?: (signal: AbortSignal) => Promise<Response>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<DiscoveredModel[]> {
  try {
    const catalog =
      provider.authMode === "codex_auth" ? null : resolveModelCatalog(provider);
    if (
      !catalog &&
      provider.apiBase.trim() !== LEGACY_CODEX_RESPONSES_ENDPOINT
    ) {
      throw new Error("Unsupported Codex legacy API URL");
    }
    return await withRequestDeadline(
      async (signal) => {
        if (!catalog) {
          if (!options.fetchCodexModels) {
            throw new Error("Codex model catalog transport is unavailable");
          }
          const response = await options.fetchCodexModels(signal);
          if (signal.aborted) throw signal.reason;
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(
              `获取 Codex 模型列表失败（HTTP ${response.status}），请检查登录状态和权限，可继续手动添加 / Codex model listing failed; manual entry remains available`,
            );
          }
          const payload = await readCatalogResponse(response);
          if (signal.aborted) throw signal.reason;
          return parseCodexCatalog(payload);
        }
        const response = await options.fetch(catalog, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${provider.apiKey.trim()}`,
            Accept: "application/json",
          },
          redirect: "error",
          signal,
        });
        if (signal.aborted) throw signal.reason;
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(
            `获取模型失败（HTTP ${response.status}）。请检查密钥和权限；服务商可能未开放模型列表，可继续手动添加。 / Model listing failed; manual entry remains available`,
          );
        }
        const payload = (await readCatalogResponse(response)) as Record<
          string,
          unknown
        > | null;
        if (signal.aborted) throw signal.reason;
        if (!payload || !Array.isArray(payload.data)) {
          throw new Error(
            "模型列表格式无效（缺少 data 数组） / Invalid model list",
          );
        }
        const models = new Map<string, DiscoveredModel>();
        for (const value of payload.data) {
          const entry = value as Record<string, unknown>;
          const id = catalogModelId(entry?.id);
          const label = entry.display_name ?? entry.name;
          const createdAt = modelCreationTime(entry);
          if (!models.has(id)) {
            models.set(id, {
              id,
              name: typeof label === "string" ? label.slice(0, 160) : "",
              ...(createdAt === undefined ? {} : { createdAt }),
              ...(Array.isArray(entry.output_modalities) &&
              entry.output_modalities.length > 0 &&
              entry.output_modalities.length <= 16 &&
              entry.output_modalities.every(
                (value: unknown) =>
                  typeof value === "string" &&
                  value.trim() &&
                  value.length <= 32,
              )
                ? {
                    outputModalities: entry.output_modalities.map(
                      (value: string) => value.trim().toLowerCase(),
                    ),
                  }
                : {}),
            });
          }
          if (models.size > MAX_MODELS) {
            throw new Error("模型数量超过上限 / Model list is too large");
          }
        }
        if (
          payload.has_more !== undefined &&
          typeof payload.has_more !== "boolean"
        ) {
          throw new Error("模型列表分页格式无效 / Invalid model pagination");
        }
        if (payload.has_more) {
          throw new Error(
            "模型列表分页异常，请手动添加 / Invalid model pagination",
          );
        }
        if (!models.size) {
          throw new Error(
            "服务商返回的模型列表为空，可手动添加 / Empty model list",
          );
        }
        return sortDiscoveredModels([...models.values()]);
      },
      options.timeoutMs ?? 30_000,
      options.signal,
    );
  } catch (error) {
    throw redactError(error, provider.apiKey);
  }
}

function catalogModelId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 256 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error("模型列表包含无效 ID / Invalid model ID");
  }
  return value.trim();
}

function parseCodexCatalog(payload: unknown): DiscoveredModel[] {
  const record = payload as Record<string, unknown> | null;
  const entries = Array.isArray(record?.models)
    ? record.models
    : Array.isArray(record?.data)
      ? record.data
      : null;
  if (!entries) {
    throw new Error("Codex 模型列表格式无效 / Invalid Codex model list");
  }
  const models: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const value of entries) {
    const entry = value as Record<string, unknown> | null;
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.visibility !== "string" ||
      entry.visibility.trim().toLowerCase() !== "list" ||
      typeof entry.slug !== "string" ||
      !entry.slug.trim()
    ) {
      continue;
    }
    const id = catalogModelId(entry.slug);
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name =
      typeof entry.display_name === "string" ? entry.display_name.trim() : "";
    const createdAt = modelCreationTime(entry);
    models.push({
      id,
      name: name ? name.slice(0, 160) : id,
      ...(createdAt === undefined ? {} : { createdAt }),
    });
    if (models.length > MAX_MODELS) {
      throw new Error("模型数量超过上限 / Model list is too large");
    }
  }
  if (!models.length) {
    throw new Error("Codex 返回的可选模型列表为空 / Empty Codex model list");
  }
  return sortDiscoveredModels(models);
}

async function readCatalogResponse(response: Response): Promise<unknown> {
  if (!response.body)
    throw new Error("模型列表响应为空 / Empty model response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        throw new Error(
          "模型列表响应超过大小上限 / Model response is too large",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("模型列表响应不是有效 JSON / Invalid model JSON");
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch (cancelError) {
      // eslint-disable-next-line preserve-caught-error -- Both failures are retained in AggregateError.errors.
      throw new AggregateError(
        [error, cancelError],
        "Model catalog reading and cancellation failed",
      );
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** A deadline must reject even when a transport ignores abort, and abort its work. */
async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectLifetime: (reason: unknown) => void = () => undefined;
  const cancel = (reason: unknown) => {
    controller.abort(reason);
    rejectLifetime(reason);
  };
  const onAbort = () =>
    cancel(parent?.reason ?? new Error("Model request cancelled / 请求已取消"));
  try {
    return await new Promise<T>((resolve, reject) => {
      rejectLifetime = reject;
      if (parent?.aborted) {
        onAbort();
        return;
      }
      parent?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(
        () =>
          cancel(
            new Error(
              `Model request timed out after ${timeoutMs / 1000}s / 请求超时，已取消`,
            ),
          ),
        timeoutMs,
      );
      void Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return operation(controller.signal);
        })
        .then(resolve, reject);
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}
