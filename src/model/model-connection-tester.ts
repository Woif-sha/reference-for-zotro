import type { RuntimeModel } from "./model-configuration";

export interface ConnectionTestTransports {
  legacy(model: RuntimeModel, signal: AbortSignal): Promise<string>;
  openAICompatible(model: RuntimeModel, signal: AbortSignal): Promise<string>;
}

export interface ConnectionTestTimers {
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}

const defaultTimers: ConnectionTestTimers = {
  schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class ModelConnectionTester {
  private active?: AbortController;
  private disposed = false;

  constructor(
    private readonly transports: ConnectionTestTransports,
    private readonly timers: ConnectionTestTimers = defaultTimers,
  ) {}

  async test(model: RuntimeModel): Promise<string> {
    if (this.disposed) throw new Error("Model connection tester is disposed");
    this.cancel("Previous connection test was cancelled by a new test");
    const controller = new AbortController();
    this.active = controller;
    const timer = this.timers.schedule(
      () => controller.abort(new Error("Model connection test timed out")),
      30_000,
    );
    try {
      return await (model.authMode === "codex_auth"
        ? this.transports.legacy(model, controller.signal)
        : this.transports.openAICompatible(model, controller.signal));
    } finally {
      this.timers.cancel(timer);
      if (this.active === controller) this.active = undefined;
    }
  }

  cancelActiveTests(): void {
    this.cancel("Model connection test was cancelled");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel("Model connection test was cancelled");
  }

  private cancel(message: string): void {
    this.active?.abort(new Error(message));
    this.active = undefined;
  }
}
