import type { LegacyCodexRequest } from "./legacy-codex-transport";
import {
  flattenRuntimeModels,
  type ModelAuthMode,
  type ModelProviderConfiguration,
  type RuntimeModel,
} from "./model-configuration";
import type { OpenAICompatibleRequest } from "./openai-compatible-transport";
import type { TextModelResult } from "./model-transport";

export type RecommendationModelIdentity = Readonly<{
  authMode: ModelAuthMode;
  providerId: string;
  providerName: string;
  modelId: string;
  model: string;
  apiBase: string;
  effort: string;
}>;

export type RecommendationModelRequest = Readonly<{
  instructions: string;
  prompt: string;
  signal?: AbortSignal;
}>;

export type RecommendationModelResult = Readonly<{
  text: string;
  identity: RecommendationModelIdentity;
}>;

export interface RecommendationModelPort {
  identity?(): RecommendationModelIdentity;
  subscribeIdentityChange?(listener: () => void): () => void;
  generate(
    request: RecommendationModelRequest,
  ): Promise<RecommendationModelResult>;
}

export interface RecommendationModelTransports {
  legacy(request: LegacyCodexRequest): Promise<TextModelResult>;
  openAICompatible(request: OpenAICompatibleRequest): Promise<TextModelResult>;
}

export class ConfiguredRecommendationModel implements RecommendationModelPort {
  private readonly active = new Set<AbortController>();
  private stopped = false;

  constructor(
    private readonly getConfiguration: () => ModelProviderConfiguration,
    private readonly transports: RecommendationModelTransports,
    private readonly subscribeToConfigurationChanges?: (
      listener: () => void,
    ) => () => void,
  ) {}

  identity(): RecommendationModelIdentity {
    return modelIdentity(activeModel(this.getConfiguration()));
  }

  subscribeIdentityChange(listener: () => void): () => void {
    return (
      this.subscribeToConfigurationChanges?.(listener) ?? (() => undefined)
    );
  }

  async generate(
    request: RecommendationModelRequest,
  ): Promise<RecommendationModelResult> {
    if (this.stopped) {
      throw new Error("Configured recommendation model is shut down");
    }
    const model = activeModel(this.getConfiguration());
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) onExternalAbort();
    else
      request.signal?.addEventListener("abort", onExternalAbort, {
        once: true,
      });
    this.active.add(controller);
    try {
      const result = await this.runSelected(model, request, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      return { text: result.text, identity: modelIdentity(model) };
    } finally {
      request.signal?.removeEventListener("abort", onExternalAbort);
      this.active.delete(controller);
    }
  }

  cancelActiveRequests(): void {
    for (const controller of this.active) {
      controller.abort(new Error("Active model configuration changed"));
    }
    this.active.clear();
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelActiveRequests();
  }

  private runSelected(
    model: RuntimeModel,
    request: RecommendationModelRequest,
    signal: AbortSignal,
  ): Promise<TextModelResult> {
    if (model.authMode === "codex_auth") {
      return this.transports.legacy({
        model: model.model,
        effort: model.effort,
        instructions: request.instructions,
        prompt: request.prompt,
        responseFormat: "json_object",
        signal,
      });
    }
    return this.transports.openAICompatible({
      endpoint: model.apiBase,
      apiKey: model.apiKey,
      model: model.model,
      instructions: request.instructions,
      prompt: request.prompt,
      responseFormat: "json_object",
      signal,
    });
  }
}

function activeModel(configuration: ModelProviderConfiguration): RuntimeModel {
  const model = flattenRuntimeModels(configuration).find(
    (entry) => entry.active,
  );
  if (!model) throw new Error("没有已保存的活动推荐模型");
  return model;
}

function modelIdentity(model: RuntimeModel): RecommendationModelIdentity {
  return {
    authMode: model.authMode,
    providerId: model.providerId,
    providerName: model.providerName,
    modelId: model.id,
    model: model.model,
    apiBase: model.apiBase,
    effort: model.effort,
  };
}
