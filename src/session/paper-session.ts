import type { PaperIdentity, SessionToken } from "../domain/literature";

export type ActivePaperSession = {
  token: SessionToken;
  signal: AbortSignal;
};

export class PaperSessionCoordinator {
  private generation = 0;
  private active?: {
    token: SessionToken;
    controller: AbortController;
  };
  private disposed = false;

  begin(identity: PaperIdentity): ActivePaperSession {
    if (this.disposed) {
      throw new Error("PaperSessionCoordinator has been disposed");
    }
    this.active?.controller.abort();
    const controller = new AbortController();
    const token = { ...identity, generation: ++this.generation };
    this.active = { token, controller };
    return { token, signal: controller.signal };
  }

  canCommit(token: SessionToken): boolean {
    const active = this.active;
    return (
      !this.disposed &&
      Boolean(active) &&
      !active?.controller.signal.aborted &&
      sameToken(active?.token, token)
    );
  }

  dispose(): void {
    this.disposed = true;
    this.active?.controller.abort();
    this.active = undefined;
  }
}

function sameToken(
  left: SessionToken | undefined,
  right: SessionToken,
): boolean {
  return (
    left?.generation === right.generation &&
    left.libraryID === right.libraryID &&
    left.attachmentID === right.attachmentID &&
    left.attachmentKey === right.attachmentKey &&
    left.parentItemKey === right.parentItemKey &&
    left.sourceFingerprint === right.sourceFingerprint
  );
}
