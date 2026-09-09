import { ExperienceApiError, type ExperienceGateway } from "./ExperienceClient";
import type { ExperienceAction, ExperienceSnapshot } from "./types";

export interface ExperienceSessionState {
  readonly snapshot: ExperienceSnapshot | null;
  readonly busy: boolean;
  readonly error: string;
  readonly needsRefresh: boolean;
  readonly expired: boolean;
  readonly hasSession: boolean;
}

export interface ExperienceSessionCallbacks {
  readonly onChange: (state: ExperienceSessionState) => void;
  readonly onReply: (snapshot: ExperienceSnapshot) => void;
}

/** RAM-only state boundary. Reads reconcile ambiguous writes; mutations are never retried. */
export class ExperienceSession {
  private sessionId: string | null = null;
  private snapshot: ExperienceSnapshot | null = null;
  private active = false;
  private disposed = false;
  private busy = false;
  private epoch = 0;
  private pending: AbortController | null = null;
  private pendingMessage = false;
  private cancellation: Promise<void> = Promise.resolve();
  private cancellationUncertain = false;
  private cancellationTarget: string | null = null;
  private error = "";
  private needsRefresh = false;
  private expired = false;

  public constructor(
    private readonly gateway: ExperienceGateway,
    private readonly callbacks: ExperienceSessionCallbacks,
    private readonly newId = (): string => `experience-${crypto.randomUUID()}`,
  ) {}

  public get state(): ExperienceSessionState {
    return { snapshot: this.snapshot, busy: this.busy, error: this.error, needsRefresh: this.needsRefresh,
      expired: this.expired, hasSession: this.sessionId !== null };
  }

  public enter(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    if (this.sessionId) void this.refresh();
    else this.emit();
  }

  public leave(): void {
    this.active = false;
    this.stop();
  }

  public dispose(): void {
    this.leave();
    this.disposed = true;
  }

  public async start(restart = false): Promise<boolean> {
    if (!this.canRequest()) return false;
    if (restart) {
      this.sessionId = null;
      this.snapshot = null;
      this.expired = false;
    }
    this.sessionId ??= this.newId();
    return this.run((signal) => this.gateway.create(this.sessionId!, signal), true);
  }

  public async refresh(): Promise<boolean> {
    if (!this.canRequest() || !this.sessionId) return false;
    return this.run((signal) => this.gateway.get(this.sessionId!, signal), false);
  }

  public async action(action: ExperienceAction): Promise<boolean> {
    if (!this.canRequest() || !this.snapshot || this.needsRefresh || this.expired) return false;
    const { session_id, revision } = this.snapshot;
    this.pendingMessage = action.action === "message";
    return this.run((signal) => this.gateway.action(session_id, revision, action, signal), true);
  }

  public stop(): void {
    const shouldCancel = this.pendingMessage;
    const hadRequest = this.pending !== null;
    this.epoch += 1;
    this.pending?.abort();
    this.pending = null;
    this.pendingMessage = false;
    this.busy = false;
    if (hadRequest) {
      this.needsRefresh = true;
      this.error = "処理を停止しました。続ける前に状態を確認してください。下書きは残っています。";
    }
    if (shouldCancel && this.sessionId) {
      const sessionId = this.sessionId;
      this.queueCancellation(sessionId);
    }
    this.emit();
  }

  private canRequest(): boolean {
    return this.active && !this.disposed && !this.busy;
  }

  private async run(operation: (signal: AbortSignal) => Promise<ExperienceSnapshot>, narrate: boolean): Promise<boolean> {
    const epoch = ++this.epoch;
    const controller = new AbortController();
    this.pending = controller;
    this.busy = true;
    this.error = "";
    this.emit();
    try {
      await this.cancellation;
      if (!this.isCurrent(epoch)) return false;
      if (this.cancellationUncertain && this.cancellationTarget) {
        await this.cancelIfPresent(this.cancellationTarget);
        this.cancellationUncertain = false;
        this.cancellationTarget = null;
        if (!this.isCurrent(epoch)) return false;
      }
      const snapshot = await operation(controller.signal);
      if (!this.isCurrent(epoch)) return false;
      this.snapshot = snapshot;
      this.needsRefresh = false;
      this.expired = false;
      this.error = "";
      this.busy = false;
      this.pending = null;
      this.pendingMessage = false;
      this.emit();
      if (narrate) this.callbacks.onReply(snapshot);
      return true;
    } catch (error: unknown) {
      if (!this.isCurrent(epoch)) return false;
      this.error = error instanceof Error ? error.message : "体験の状態を確認できませんでした。";
      this.needsRefresh = true;
      this.expired = error instanceof ExperienceApiError && error.status === 404;
      if (this.pendingMessage && this.sessionId && !this.expired) {
        this.queueCancellation(this.sessionId);
        await this.cancellation;
        if (!this.isCurrent(epoch)) return false;
      }
      if (error instanceof ExperienceApiError && error.status === 409 && this.sessionId && !this.cancellationUncertain) {
        try {
          const refreshed = await this.gateway.get(this.sessionId, controller.signal);
          if (!this.isCurrent(epoch)) return false;
          this.snapshot = refreshed;
          this.needsRefresh = false;
          this.error = "最新の進行に合わせました。直前の操作は再送していません。盤面を見て続けてください。";
        } catch (refreshError: unknown) {
          if (this.isCurrent(epoch)) {
            this.expired = refreshError instanceof ExperienceApiError && refreshError.status === 404;
            this.error = this.expired ? "この体験の進行は見つかりません。最初から始めるかどうかを選んでください。" :
              "最新の進行を取得できませんでした。状態を確認してから続けてください。";
          }
        }
      }
      return false;
    } finally {
      if (this.isCurrent(epoch)) {
        this.busy = false;
        this.pending = null;
        this.pendingMessage = false;
        this.emit();
      }
    }
  }

  private isCurrent(epoch: number): boolean {
    return this.active && !this.disposed && epoch === this.epoch;
  }

  private queueCancellation(sessionId: string): void {
    this.cancellationTarget = sessionId;
    this.cancellation = this.cancellation.then(async () => {
      await this.cancelIfPresent(sessionId);
      this.cancellationUncertain = false;
      if (this.cancellationTarget === sessionId) this.cancellationTarget = null;
    }).catch(() => {
      this.cancellationUncertain = true;
      this.needsRefresh = true;
      this.error = "相談の停止を確認できませんでした。Backendの状態を確認してから続けてください。";
      this.emit();
    });
  }

  private async cancelIfPresent(sessionId: string): Promise<void> {
    try {
      await this.gateway.cancel(sessionId);
    } catch (error: unknown) {
      // An expired session cannot have a pending narration to cancel.
      if (!(error instanceof ExperienceApiError && error.status === 404)) throw error;
    }
  }

  private emit(): void {
    if (!this.disposed) this.callbacks.onChange(this.state);
  }
}
