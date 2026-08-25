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
  EmotionalContinuity,
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
  readonly streamMessage?: (
    message: string,
    sessionId: string,
    responseStyle: ResponseStyle,
    onTextDelta: (delta: string) => void,
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
  readonly speak: (text: string, performance?: PerformancePlan, onStarted?: () => void) => void;
  readonly beginStreaming?: (onStarted?: () => void) => void;
  readonly appendStreamingText?: (delta: string) => void;
  readonly completeStreaming?: (finalText: string, performance?: PerformancePlan) => void;
  readonly toggle: () => void;
  readonly stop: () => void;
  readonly discard?: () => void;
  readonly dispose: () => void;
}

export interface DialogueCallbacks {
  readonly onConnectionChange: (health: DialogueHealth | null, errorMessage?: string) => void;
  readonly onMessage: (role: DialogueRole, text: string) => void;
  readonly onPartialAssistantMessage?: (text: string) => void;
  readonly onCompleteAssistantMessage?: (text: string) => void;
  readonly onDiscardPartialAssistantMessage?: () => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onCharacterState: (state: CharacterState) => void;
  readonly onPerformancePlan?: (performance: PerformancePlan) => void;
  readonly onContinuityChange?: (continuity: EmotionalContinuity) => void;
  readonly onError: (message: string) => void;
  readonly onClearError: () => void;
  readonly onLatency?: (latencyMs: number) => void;
  readonly onResponseTiming?: (stage: ResponseTimingStage, latencyMs: number) => void;
  readonly onMemoryChange?: (turns: number, maxTurns: number) => void;
  readonly onSummaryChange?: (available: boolean) => void;
  readonly onPersistentMemoriesChange?: (items: readonly PersistentMemoryItem[]) => void;
  readonly onPersistentMemoryBusyChange?: (busy: boolean) => void;
  readonly onMemoryNotice?: (message: string) => void;
  readonly onCancelled?: () => void;
  readonly onConversationReset?: () => void;
}

export type ResponseTimingStage = "first-text" | "text-complete" | "speech-start";

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
    this.callbacks.onDiscardPartialAssistantMessage?.();
    this.callbacks.onClearError();
    this.callbacks.onCharacterState("idle");

    const activeRequest = this.requestController;
    const cancellation = this.gateway.cancelActiveDialogue(this.sessionId);
    this.cancellationRequest = cancellation;
    void cancellation
      .then((response) => {
        if (response.cancelled) {
          activeRequest?.abort(new DOMException("Response cancelled by the user.", "AbortError"));
        }
      })
      .catch(() => activeRequest?.abort(new DOMException("Cancellation status is unknown.", "AbortError")));
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
    this.callbacks.onDiscardPartialAssistantMessage?.();
    this.callbacks.onMessage("user", message);
    this.callbacks.onBusyChange(true);
    this.callbacks.onCharacterState("thinking");

    const controller = new AbortController();
    this.requestController = controller;
    let partialReply = "";
    let firstTextObserved = false;
    let responseFinalized = false;
    const streamingSpeech = resolveStreamingSpeech(this.gateway, this.speechOutput);
    const reportSpeechStarted = (): void => {
      if (this.disposed) return;
      this.callbacks.onResponseTiming?.(
        "speech-start",
        Math.max(0, Math.round(performance.now() - startedAt)),
      );
      if (!responseFinalized) this.callbacks.onCharacterState("speaking");
    };
    streamingSpeech?.beginStreaming(reportSpeechStarted);
    const receiveTextDelta = (delta: string): void => {
      if (!delta || this.disposed || this.cancelRequested) return;
      partialReply += delta;
      if (!firstTextObserved) {
        firstTextObserved = true;
        this.callbacks.onResponseTiming?.(
          "first-text",
          Math.max(0, Math.round(performance.now() - startedAt)),
        );
      }
      this.callbacks.onPartialAssistantMessage?.(partialReply);
      streamingSpeech?.appendStreamingText(delta);
    };
    try {
      const response = this.gateway.streamMessage
        ? await this.gateway.streamMessage(
            message,
            this.sessionId,
            responseStyle,
            receiveTextDelta,
            controller.signal,
          )
        : await this.gateway.sendMessage(
            message,
            this.sessionId,
            responseStyle,
            controller.signal,
      );
      if (this.disposed) return;
      if (this.cancelRequested && await this.finishCancellation()) return;
      if (!firstTextObserved) receiveTextDelta(response.reply);
      responseFinalized = true;
      const textCompleteMs = Math.max(0, Math.round(performance.now() - startedAt));
      this.callbacks.onLatency?.(textCompleteMs);
      this.callbacks.onResponseTiming?.("text-complete", textCompleteMs);
      this.callbacks.onMemoryChange?.(response.memory_turns, response.memory_max_turns);
      this.callbacks.onSummaryChange?.(response.session_summary_available);
      if (this.callbacks.onCompleteAssistantMessage) {
        this.callbacks.onCompleteAssistantMessage(response.reply);
      } else {
        this.callbacks.onMessage("assistant", response.reply);
      }
      if (response.saved_memory) {
        try {
          await this.loadPersistentMemories(controller.signal);
          this.callbacks.onMemoryNotice?.("明示された内容を、この端末の長期記憶へ保存しました。");
        } catch (error: unknown) {
          this.callbacks.onError(`長期記憶は保存されましたが、一覧を更新できませんでした。${this.getPublicError(error)}`);
        }
      }
      if (this.cancelRequested && await this.finishCancellation()) return;
      this.callbacks.onContinuityChange?.(response.continuity);
      this.callbacks.onCharacterState(performanceEmotionToState(response.performance.emotion));
      this.callbacks.onPerformancePlan?.(response.performance);
      if (this.speechOutput) {
        if (streamingSpeech) {
          streamingSpeech.completeStreaming(response.reply, response.performance);
        } else {
          this.speechOutput.speak(response.reply, response.performance, reportSpeechStarted);
        }
      } else {
        const displayMs = Math.min(7000, Math.max(2800, response.reply.length * 55));
        this.idleTimer = globalThis.setTimeout(() => {
          if (!this.disposed && !this.busy) this.callbacks.onCharacterState("idle");
        }, displayMs);
      }
    } catch (error: unknown) {
      if (this.disposed) return;
      if (this.cancelRequested) {
        const cancelled = await this.finishCancellation();
        if (cancelled) return;
      }
      streamingSpeech?.discard();
      this.callbacks.onDiscardPartialAssistantMessage?.();
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

  private async finishCancellation(): Promise<boolean> {
    try {
      const response = await this.cancellationRequest;
      if (this.disposed) return true;
      if (response?.cancelled) {
        this.callbacks.onCancelled?.();
        this.resetAfterCancellation();
        return true;
      }
      this.cancelRequested = false;
      this.callbacks.onMemoryNotice?.("応答は既に完了していたため、停止せず表示します。");
      this.callbacks.onCharacterState("thinking");
      return false;
    } catch (error: unknown) {
      if (!this.disposed) {
        this.callbacks.onError(`Backendへ停止を通知できませんでした。${this.getPublicError(error)}`);
        this.resetAfterCancellation();
      }
      return true;
    }
  }

  private resetAfterCancellation(): void {
    if (this.speechOutput?.discard) {
      this.speechOutput.discard();
    } else {
      this.speechOutput?.stop();
    }
    this.clearIdleTimer();
    this.callbacks.onDiscardPartialAssistantMessage?.();
    this.callbacks.onCharacterState("idle");
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

interface StreamingSpeechOutput {
  readonly beginStreaming: (onStarted?: () => void) => void;
  readonly appendStreamingText: (delta: string) => void;
  readonly completeStreaming: (finalText: string, performance?: PerformancePlan) => void;
  readonly discard: () => void;
}

function resolveStreamingSpeech(
  gateway: DialogueGateway,
  speechOutput: SpeechOutput | null,
): StreamingSpeechOutput | null {
  if (
    !gateway.streamMessage ||
    !speechOutput?.beginStreaming ||
    !speechOutput.appendStreamingText ||
    !speechOutput.completeStreaming ||
    !speechOutput.discard
  ) {
    return null;
  }
  return {
    beginStreaming: (onStarted) => speechOutput.beginStreaming?.(onStarted),
    appendStreamingText: (delta) => speechOutput.appendStreamingText?.(delta),
    completeStreaming: (finalText, performance) => speechOutput.completeStreaming?.(finalText, performance),
    discard: () => speechOutput.discard?.(),
  };
}

function defaultSessionIdFactory(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}

function isMemoryId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}
