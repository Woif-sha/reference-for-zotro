import {
  ModelSettingsStore,
  resolveRuntimeModel,
  type ModelProvider,
  type ModelProviderConfiguration,
  type ProviderModel,
  type RuntimeModel,
} from "../model/model-configuration";
import { ModelConnectionTester } from "../model/model-connection-tester";
import type { DiscoveredModel } from "../model/model-catalog";
import {
  saveProviderConfiguration,
  selectActiveModel,
} from "../model/model-selection";

export interface ModelPreferencesController {
  getConfiguration(): ModelProviderConfiguration;
  subscribe(listener: () => void): () => void;
  saveConfiguration(
    configuration: ModelProviderConfiguration,
  ): ModelProviderConfiguration;
  selectActiveModel(modelId: string): RuntimeModel;
  testDraftModel(
    provider: ModelProvider,
    model: ProviderModel,
  ): Promise<string>;
  loadModels(
    provider: ModelProvider,
    signal: AbortSignal,
  ): Promise<DiscoveredModel[]>;
  cancelConnectionTests(): void;
}

export class RecommendationModelSettingsCoordinator implements ModelPreferencesController {
  constructor(
    private readonly store: ModelSettingsStore,
    private readonly connectionTester: ModelConnectionTester,
    private readonly cancelModelTasks: () => void,
    private readonly loadProviderModels: (
      provider: ModelProvider,
      signal: AbortSignal,
    ) => Promise<DiscoveredModel[]>,
  ) {}

  getConfiguration(): ModelProviderConfiguration {
    return this.store.getConfiguration();
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener);
  }

  saveConfiguration(
    configuration: ModelProviderConfiguration,
  ): ModelProviderConfiguration {
    return saveProviderConfiguration(
      configuration,
      this.selectionDependencies(),
    );
  }

  selectActiveModel(modelId: string): RuntimeModel {
    return selectActiveModel(modelId, this.selectionDependencies());
  }

  testDraftModel(
    provider: ModelProvider,
    model: ProviderModel,
  ): Promise<string> {
    return this.connectionTester.test(resolveRuntimeModel(provider, model));
  }

  cancelConnectionTests(): void {
    this.connectionTester.cancelActiveTests();
  }

  loadModels(
    provider: ModelProvider,
    signal: AbortSignal,
  ): Promise<DiscoveredModel[]> {
    return this.loadProviderModels(provider, signal);
  }

  dispose(): void {
    this.connectionTester.dispose();
  }

  private selectionDependencies() {
    return {
      getConfiguration: () => this.store.getConfiguration(),
      saveConfiguration: (configuration: ModelProviderConfiguration) =>
        this.store.saveConfiguration(configuration),
      cancelModelTasks: this.cancelModelTasks,
    };
  }
}
