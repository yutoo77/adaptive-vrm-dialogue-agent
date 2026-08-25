import {
  performanceEmotionToState,
  type CharacterState,
  type PerformancePlan,
} from "../types/character";
import { DialogueApiError } from "./DialogueClient";
import type {
  DialogueCancellationResponse,
  DialogueHealth,
  DialogueResponse,
  DialogueRole,
  PersistentMemoryClearResponse,
  PersistentMemoryDeleteResponse,
  PersistentMemoryItem,
  PersistentMemoryListResponse,
  PersistentMemoryMutationResponse,
  ResponseStyle,
  SessionResetResponse,
} from "./types";

export interface DialogueGateway {
  readonly getHealth: (signal?: AbortSignal) => Promise<DialogueHealth>;
  readonly sendMessage: (
    message: string,
    sessionId: string,
    responseStyle: ResponseStyle,
    signal?: AbortSignal,
  ) => Promise<DialogueResponse>;
  readonly cancelActiveDialogue: (sessionId: string) => Promise<DialogueCancellationResponse>;
  readonly resetSession: (sessionId: string, signal?: AbortSignal) => Promise<SessionResetResponse>;
  readonly listMemories: (signal?: AbortSignal) => Promise<PersistentMemoryListResponse>;
  readonly createMemory: (content: string, signal?: AbortSignal) => Promise<PersistentMemoryMutationResponse>;
  readonly updateMemory: (
    memoryId: string,
    content: string,
    signal?: AbortSignal,
  ) => Promise<PersistentMemoryMutationResponse>;
  readonly deleteMemory: (memoryId: string, signal?: AbortSignal) => Promise<PersistentMemoryDeleteResponse>;
  readonly clearMemories: (signal?: AbortSignal) => Promise<PersistentMemoryClearResponse>;
}

export interface SpeechOutput {
  readonly speak: (text: string, performance?: PerformancePlan) => void;
  readonly toggle: () => void;
  readonly stop: () => void;
  readonly dispose: () => void;
}

export interface DialogueCallbacks {
  readonly onConnectionChange: (health: DialogueHealth | null, errorMessage?: string) => void;
  readonly onMessage: (role: DialogueRole, text: string) => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCharacterState: (state: CharacterState) => void;
  readonly onPerformancePlan?: (performance: PerformancePlan) => void;
  readonly onError: (message: string) => void;
  readonly onClearError: () => void;
  readonly onLatency?: (latencyMs: number) => void;
  readonly onMemoryChange?: (turns: number, maxTurns: number) => void;
  readonly onSummaryChange?: (available: boolean) => void;
  readonly onPersistentMemoriesChange?: (items: readonly PersistentMemoryItem[]) => void;
  readonly onPersistentMemoryBusyChange?: (busy: boolean) => void;
  readonly onMemoryNotice?: (message: string) => void;
  readonly onCancelled?: () => void;
  readonly onConversationReset?: () => void;
}

type SessionIdFactory = () => string;

export class DialogueController {
  private health: DialogueHealth | null = null;
  private requestController: AbortController | null = null;
  private idleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private busy = false;
  private memoryBusy = false;
  private disposed = false;
  private cancelRequested = false;
  private cancellationRequest: Promise<DialogueCancellationResponse> | null = null;
  private sessionId: string;
  private responseStyle: ResponseStyle = "balanced";

  public constructor(
    private readonly gateway: DialogueGateway,
    private readonly callbacks: DialogueCallbacks,
    private readonly speechOutput: SpeechOutput | null = null,
    private readonly createSessionId: SessionIdFactory = defaultSessionIdFactory,
  ) {
    this.sessionId = this.createSessionId();
  }

  public async initialize(): Promise<void> {
    const controller = new AbortController();
    this.requestController = controller;
    try {
      this.health = await this.gateway.getHealth(controller.signal);
      if (!this.disposed) {
        this.callbacks.onConnectionChange(this.health);
        this.callbacks.onMemoryChange?.(0, this.health.session_memory_max_turns);
        this.callbacks.onSummaryChange?.(false);
        try {
          await this.loadPersistentMemories(controller.signal);
        } catch (error: unknown) {
          this.callbacks.onError(this.getPublicError(error));
        }
      }
    } catch (error: unknown) {
      if (this.disposed) return;
      this.health = null;
      this.callbacks.onConnectionChange(null, this.getPublicError(error));
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  public send(rawMessage: string): boolean {
    const message = rawMessage.trim();
    if (!message || message.length > 1000 || this.busy || this.disposed) return false;
    if (this.health?.status !== "ready") {
      this.callbacks.onError("Backendへ接続できていません。起動状態またはAPI設定を確認してください。");
      return false;
    }

    void this.performSend(message, this.responseStyle);
    return true;
  }

  public cancelResponse(): boolean {
    if (!this.busy || this.disposed || this.cancelRequested) return false;
    this.cancelRequested = true;
    this.speechOutput?.stop();
    this.clearIdleTimer();
    this.callbacks.onClearError();
    this.callbacks.onCharacterState("idle");

    const activeRequest = this.requestController;
    const cancellation = this.gateway.cancelActiveDialogue(this.sessionId);
    this.cancellationRequest = cancellation;
    void cancellation
      .finally(() => activeRequest?.abort(new DOMException("Response cancelled by the user.", "AbortError")))
      .catch(() => undefined);
    return true;
  }

  public toggleSpeech(): void {
    if (!this.disposed && !this.busy) this.speechOutput?.toggle();
  }

  public setResponseStyle(style: ResponseStyle): boolean {
    if (this.busy || this.disposed) return false;
    this.responseStyle = style;
    return true;
  }

  public resetConversation(): boolean {
    if (this.busy || this.disposed) return false;
    if (this.health?.status !== "ready") {
      this.callbacks.onError("Backendへ接続できていないため、新しい会話を開始できません。");
      return false;
    }
    void this.performReset();
    return true;
  }

  public addPersistentMemory(rawContent: string): boolean {
    const content = rawContent.trim();
    if (!content || content.length > 500 || !this.canMutateMemory()) return false;
    void this.performMemoryMutation(
      (signal) => this.gateway.createMemory(content, signal),
      "長期記憶へ追加しました。",
    );
    return true;
  }

  public updatePersistentMemory(memoryId: string, rawContent: string): boolean {
    const content = rawContent.trim();
    if (!isMemoryId(memoryId) || !content || content.length > 500 || !this.canMutateMemory()) return false;
    void this.performMemoryMutation(
      (signal) => this.gateway.updateMemory(memoryId, content, signal),
      "長期記憶を更新しました。",
    );
    return true;
  }

  public deletePersistentMemory(memoryId: string): boolean {
    if (!isMemoryId(memoryId) || !this.canMutateMemory()) return false;
    void this.performMemoryMutation(
      (signal) => this.gateway.deleteMemory(memoryId, signal),
      "長期記憶を1件削除しました。",
    );
    return true;
  }

  public clearPersistentMemories(): boolean {
    if (!this.canMutateMemory()) return false;
    void this.performMemoryMutation(
      (signal) => this.gateway.clearMemories(signal),
      "長期記憶をすべて削除しました。",
    );
    return true;
  }

  public refreshPersistentMemories(): boolean {
    if (!this.canMutateMemory()) return false;
    void this.performMemoryMutation(async (signal) => this.gateway.listMemories(signal), null);
    return true;
  }

  public dispose(): void {
    this.disposed = true;
    this.requestController?.abort();
    this.requestController = null;
    this.speechOutput?.dispose();
    this.clearIdleTimer();
  }

  private async performSend(message: string, responseStyle: ResponseStyle): Promise<void> {
    const startedAt = performance.now();
    this.busy = true;
    this.speechOutput?.stop();
    this.clearIdleTimer();
    this.callbacks.onClearError();
    this.callbacks.onMessage("user", message);
    this.callbacks.onBusyChange(true);
    this.callbacks.onCharacterState("thinking");

    const controller = new AbortController();
    this.requestController = controller;
    try {
      const response = await this.gateway.sendMessage(
        message,
        this.sessionId,
        responseStyle,
        controller.signal,
      );
      if (this.disposed) return;
      if (this.cancelRequested) {
        await this.finishCancellation();
        return;
      }
      this.callbacks.onLatency?.(Math.max(0, Math.round(performance.now() - startedAt)));
      this.callbacks.onMemoryChange?.(response.memory_turns, response.memory_max_turns);
      this.callbacks.onSummaryChange?.(response.session_summary_available);
      this.callbacks.onMessage("assistant", response.reply);
      if (response.saved_memory) {
        try {
          await this.loadPersistentMemories(controller.signal);
          this.callbacks.onMemoryNotice?.("明示された内容を、この端末の長期記憶へ保存しました。");
        } catch (error: unknown) {
          this.callbacks.onError(`長期記憶は保存されましたが、一覧を更新できませんでした。${this.getPublicError(error)}`);
        }
      }
      if (this.cancelRequested) {
        await this.finishCancellation();
        return;
      }
      this.callbacks.onCharacterState(performanceEmotionToState(response.performance.emotion));
      this.callbacks.onPerformancePlan?.(response.performance);
      if (this.speechOutput) {
        this.speechOutput.speak(response.reply, response.performance);
      } else {
        const displayMs = Math.min(7000, Math.max(2800, response.reply.length * 55));
        this.idleTimer = globalThis.setTimeout(() => {
          if (!this.disposed && !this.busy) this.callbacks.onCharacterState("idle");
        }, displayMs);
      }
    } catch (error: unknown) {
      if (this.disposed) return;
      if (this.cancelRequested) {
        await this.finishCancellation();
        return;
      }
      this.callbacks.onError(this.getPublicError(error));
      this.callbacks.onCharacterState("error");
      this.idleTimer = globalThis.setTimeout(() => {
        if (!this.disposed && !this.busy) this.callbacks.onCharacterState("idle");
      }, 5000);
    } finally {
      if (this.requestController === controller) this.requestController = null;
      this.busy = false;
      this.cancelRequested = false;
      this.cancellationRequest = null;
      if (!this.disposed) this.callbacks.onBusyChange(false);
    }
  }

  private async finishCancellation(): Promise<void> {
    try {
      const response = await this.cancellationRequest;
      if (this.disposed) return;
      if (response?.cancelled) {
        this.callbacks.onCancelled?.();
      } else {
        this.callbacks.onError("応答は既に完了していたか、Backendで停止対象を確認できませんでした。");
      }
    } catch (error: unknown) {
      if (!this.disposed) {
        this.callbacks.onError(`Backendへ停止を通知できませんでした。${this.getPublicError(error)}`);
      }
    } finally {
      if (!this.disposed) {
        this.speechOutput?.stop();
        this.clearIdleTimer();
        this.callbacks.onCharacterState("idle");
      }
    }
  }

  private async performReset(): Promise<void> {
    this.busy = true;
    this.speechOutput?.stop();
    this.clearIdleTimer();
    this.callbacks.onClearError();
    this.callbacks.onBusyChange(true);

    const controller = new AbortController();
    const previousSessionId = this.sessionId;
    this.requestController = controller;
    try {
      await this.gateway.resetSession(previousSessionId, controller.signal);
      if (this.disposed) return;
      this.sessionId = this.createSessionId();
      this.callbacks.onConversationReset?.();
      this.callbacks.onMemoryChange?.(0, this.health?.session_memory_max_turns ?? 10);
      this.callbacks.onSummaryChange?.(false);
      this.callbacks.onCharacterState("idle");
    } catch (error: unknown) {
      if (this.disposed) return;
      this.callbacks.onError(this.getPublicError(error));
      this.callbacks.onCharacterState("error");
    } finally {
      if (this.requestController === controller) this.requestController = null;
      this.busy = false;
      if (!this.disposed) this.callbacks.onBusyChange(false);
    }
  }

  private canMutateMemory(): boolean {
    if (this.busy || this.memoryBusy || this.disposed) return false;
    if (this.health?.status !== "ready") {
      this.callbacks.onError("Backendへ接続できていないため、長期記憶を変更できません。");
      return false;
    }
    return true;
  }

  private async performMemoryMutation(
    mutation: (signal: AbortSignal) => Promise<unknown>,
    notice: string | null,
  ): Promise<void> {
    this.memoryBusy = true;
    this.callbacks.onPersistentMemoryBusyChange?.(true);
    this.callbacks.onClearError();
    const controller = new AbortController();
    try {
      await mutation(controller.signal);
      if (this.disposed) return;
      await this.loadPersistentMemories(controller.signal);
      if (notice) this.callbacks.onMemoryNotice?.(notice);
    } catch (error: unknown) {
      if (!this.disposed) this.callbacks.onError(this.getPublicError(error));
    } finally {
      this.memoryBusy = false;
      if (!this.disposed) this.callbacks.onPersistentMemoryBusyChange?.(false);
    }
  }

  private async loadPersistentMemories(signal?: AbortSignal): Promise<void> {
    const response = await this.gateway.listMemories(signal);
    if (!this.disposed) this.callbacks.onPersistentMemoriesChange?.(response.items);
  }

  private getPublicError(error: unknown): string {
    if (error instanceof DialogueApiError) {
      return error.requestId ? `${error.message}（Request ID: ${error.requestId}）` : error.message;
    }
    return "対話処理で予期しないエラーが発生しました。";
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) globalThis.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

function defaultSessionIdFactory(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}

function isMemoryId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}
