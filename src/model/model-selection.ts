import {
  flattenRuntimeModels,
  validateProviderConfiguration,
  type ModelProviderConfiguration,
  type RuntimeModel,
} from "./model-configuration";

export interface ModelSelectionDependencies {
  getConfiguration(): ModelProviderConfiguration;
  saveConfiguration(
    configuration: ModelProviderConfiguration,
  ): ModelProviderConfiguration;
  cancelModelTasks(): void;
}

export function selectActiveModel(
  modelId: string,
  dependencies: ModelSelectionDependencies,
): RuntimeModel {
  const current = dependencies.getConfiguration();
  const selected = requireRuntimeModel(current, modelId);
  if (current.activeModelId === modelId) return selected;
  dependencies.cancelModelTasks();
  const saved = dependencies.saveConfiguration({
    ...current,
    activeModelId: modelId,
  });
  return requireRuntimeModel(saved, modelId);
}

export function saveProviderConfiguration(
  configuration: ModelProviderConfiguration,
  dependencies: ModelSelectionDependencies,
): ModelProviderConfiguration {
  const current = dependencies.getConfiguration();
  const validated = validateProviderConfiguration(configuration);
  const previous = requireRuntimeModel(current, current.activeModelId);
  const next = requireRuntimeModel(validated, validated.activeModelId);
  if (runtimeConfigurationKey(previous) !== runtimeConfigurationKey(next)) {
    dependencies.cancelModelTasks();
  }
  return dependencies.saveConfiguration(validated);
}

function requireRuntimeModel(
  configuration: ModelProviderConfiguration,
  modelId: string,
): RuntimeModel {
  const selected = flattenRuntimeModels(configuration).find(
    (model) => model.id === modelId,
  );
  if (!selected) throw new Error(`活动模型不存在：${modelId}`);
  return selected;
}

function runtimeConfigurationKey(model: RuntimeModel): string {
  return JSON.stringify({
    id: model.id,
    providerId: model.providerId,
    authMode: model.authMode,
    apiBase: model.apiBase,
    apiKey: model.apiKey,
    model: model.model,
    effort: model.effort,
  });
}
