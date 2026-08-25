import type { PerformancePlan } from "../types/character";
import { getVoicePlaybackRate, resolveSpeechDurationMs } from "./SpeechPlayback";
import { SpeechApiError } from "./SpeechClient";
import { StreamingSpeechQueue } from "./StreamingSpeechQueue";
import type { SpeechHealth, SpeechStatus, SpeechSynthesisResult, SpeechTiming } from "./types";

export { getVoicePlaybackRate, resolveSpeechDurationMs } from "./SpeechPlayback";

export interface SpeechGateway {
  readonly getHealth: (signal?: AbortSignal) => Promise<SpeechHealth>;
  readonly synthesize: (text: string, signal?: AbortSignal) => Promise<SpeechSynthesisResult>;
}

export interface SpeechAudio {
  currentTime: number;
  playbackRate: number;
  readonly duration: number;
  readonly play: () => Promise<void>;
  readonly pause: () => void;
  readonly addEventListener: (
    type: "ended" | "error",
    listener: () => void,
    options?: AddEventListenerOptions,
  ) => void;
}

export interface SpeechCallbacks {
  readonly onStatusChange: (status: SpeechStatus) => void;
  readonly onPlaybackChange: (event: SpeechPlaybackEvent) => void;
  readonly onWarning: (message: string) => void;
  readonly onLatency?: (latencyMs: number) => void;
}

export type SpeechPlaybackEvent =
  | { readonly type: "started"; readonly durationMs: number; readonly phraseBoundariesMs: readonly number[] }
  | { readonly type: "completed" | "stopped" | "failed" };

export interface LipSyncOutput {
  readonly prepare: (audio: Blob, timing: SpeechTiming | null) => Promise<boolean>;
  readonly start: (audio: SpeechAudio) => boolean;
  readonly stop: () => void;
  readonly dispose: () => void;
}

export type AudioFactory = (url: string) => SpeechAudio;

export interface ObjectUrlApi {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

/** Coordinates health, legacy whole-reply speech, and the independent streaming queue. */
export class SpeechController {
  private operationId = 0;
  private requestController: AbortController | null = null;
  private audio: SpeechAudio | null = null;
  private audioUrl: string | null = null;
  private latestAudio: Blob | null = null;
  private latestTiming: SpeechTiming | null = null;
  private latestText = "";
  private latestPerformance: PerformancePlan | null = null;
  private latestOnStarted: (() => void) | null = null;
  private readonly streamingQueue: StreamingSpeechQueue;
  private disposed = false;

  public constructor(
    private readonly gateway: SpeechGateway,
    private readonly callbacks: SpeechCallbacks,
    private readonly lipSync: LipSyncOutput | null = null,
    private readonly createAudio: AudioFactory = (url) => new Audio(url),
    private readonly objectUrls: ObjectUrlApi = URL,
  ) {
    this.streamingQueue = new StreamingSpeechQueue(
      gateway,
      callbacks,
      lipSync,
      createAudio,
      objectUrls,
    );
  }

  public async initialize(): Promise<void> {
    const operationId = ++this.operationId;
    const controller = new AbortController();
    this.requestController = controller;
    this.setStatus("checking", "VOICEVOXへの接続を確認しています。", "none");
    try {
      const health = await this.gateway.getHealth(controller.signal);
      if (!this.isCurrent(operationId)) return;
      if (health.status === "ready") {
        const version = health.engine_version ? ` v${health.engine_version}` : "";
        const speaker = health.credit ?? `VOICEVOX / 話者ID ${health.speaker_id}`;
        const style = health.style_name ? ` / ${health.style_name}` : "";
        this.setStatus("available", `${speaker}${style}${version} / ID ${health.speaker_id}`, "none");
      } else {
        this.setStatus("unavailable", health.message, "none");
      }
    } catch (error: unknown) {
      if (!this.isCurrent(operationId)) return;
      this.setStatus("unavailable", this.publicMessage(error), "none");
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  public speak(text: string, performancePlan?: PerformancePlan, onStarted?: () => void): void {
    this.streamingQueue.discard();
    this.cancelLegacy(false);
    this.latestAudio = null;
    this.latestTiming = null;
    this.latestText = text;
    this.latestPerformance = performancePlan ?? null;
    this.latestOnStarted = onStarted ?? null;
    const operationId = ++this.operationId;
    const controller = new AbortController();
    const startedAt = performance.now();
    this.requestController = controller;
    this.setStatus("generating", "VOICEVOXで音声を生成しています。", "stop");
    void this.generateAndPlay(text, operationId, controller, startedAt);
  }

  public beginStreaming(onStarted?: () => void): void {
    this.cancelLegacy(false);
    this.latestAudio = null;
    this.latestTiming = null;
    this.latestText = "";
    this.latestPerformance = null;
    this.latestOnStarted = null;
    this.streamingQueue.begin(onStarted);
  }

  public appendStreamingText(delta: string): void {
    this.streamingQueue.append(delta);
  }

  public completeStreaming(finalText: string, performancePlan?: PerformancePlan): void {
    const completion = this.streamingQueue.complete(finalText, performancePlan);
    if (!completion.handled) this.speak(finalText, performancePlan, completion.onStarted);
  }

  public toggle(): void {
    if (this.cancelLegacy(true)) return;
    if (this.streamingQueue.toggle() || !this.latestAudio || this.disposed) return;
    const operationId = ++this.operationId;
    void this.playLatest(operationId, false);
  }

  public stop(): void {
    if (!this.cancelLegacy(true)) this.streamingQueue.stop(true);
  }

  public discard(): void {
    this.cancelLegacy(false);
    this.streamingQueue.discard();
    this.latestAudio = null;
    this.latestTiming = null;
    this.latestText = "";
    this.latestPerformance = null;
    this.latestOnStarted = null;
  }

  public dispose(): void {
    this.disposed = true;
    this.cancelLegacy(false);
    this.streamingQueue.dispose();
    this.lipSync?.dispose();
    this.latestAudio = null;
    this.latestTiming = null;
    this.latestText = "";
    this.latestPerformance = null;
    this.latestOnStarted = null;
  }

  private async generateAndPlay(
    text: string,
    operationId: number,
    controller: AbortController,
    startedAt: number,
  ): Promise<void> {
    try {
      const synthesis = await this.gateway.synthesize(text, controller.signal);
      if (!this.isCurrent(operationId)) return;
      this.requestController = null;
      this.latestAudio = synthesis.audio;
      this.latestTiming = synthesis.timing;
      await this.prepareLipSync(synthesis.audio, synthesis.timing, operationId);
      if (!this.isCurrent(operationId)) return;
      this.callbacks.onLatency?.(Math.max(0, Math.round(performance.now() - startedAt)));
      await this.playLatest(operationId, true);
    } catch (error: unknown) {
      if (!this.isCurrent(operationId) || controller.signal.aborted) return;
      this.requestController = null;
      const message = this.publicMessage(error);
      this.setStatus("error", `${message} Text回答はそのまま確認できます。`, "none");
      this.callbacks.onPlaybackChange({ type: "failed" });
      this.callbacks.onWarning(message);
    }
  }

  private async playLatest(operationId: number, automatic: boolean): Promise<void> {
    const blob = this.latestAudio;
    if (!blob || !this.isCurrent(operationId)) return;
    const url = this.objectUrls.createObjectURL(blob);
    const audio = this.createAudio(url);
    audio.playbackRate = getVoicePlaybackRate(this.latestPerformance);
    this.audioUrl = url;
    this.audio = audio;

    audio.addEventListener("ended", () => this.finishPlayback(operationId, false), { once: true });
    audio.addEventListener("error", () => this.finishPlayback(operationId, true), { once: true });
    try {
      await audio.play();
      if (!this.isCurrent(operationId) || this.audio !== audio) {
        audio.pause();
        return;
      }
      if (automatic) {
        const onStarted = this.latestOnStarted;
        this.latestOnStarted = null;
        onStarted?.();
      }
      const lipSyncLabel = this.latestTiming?.visemes.length ? "（VOICEVOX母音同期）" : "";
      this.setStatus("playing", `音声を再生しています${lipSyncLabel}。`, "stop");
      this.lipSync?.start(audio);
      const playbackRate = audio.playbackRate;
      const durationMs = resolveSpeechDurationMs(
        audio.duration,
        this.latestText,
        playbackRate,
        this.latestTiming?.durationMs ?? null,
      );
      this.callbacks.onPlaybackChange({
        type: "started",
        durationMs,
        phraseBoundariesMs: (this.latestTiming?.phraseBoundariesMs ?? [])
          .map((boundary) => Math.round(boundary / playbackRate))
          .filter((boundary) => boundary > 0 && boundary < durationMs),
      });
    } catch {
      if (!this.isCurrent(operationId)) return;
      this.cleanupAudio();
      const message = automatic
        ? "自動再生できませんでした。再生ボタンを押してください。"
        : "音声を再生できませんでした。ブラウザの音声設定を確認してください。";
      this.setStatus(automatic ? "ready" : "error", message, "replay");
      this.callbacks.onPlaybackChange({ type: "failed" });
      if (!automatic) this.callbacks.onWarning(message);
    }
  }

  private finishPlayback(operationId: number, failed: boolean): void {
    if (!this.isCurrent(operationId)) return;
    this.cleanupAudio();
    if (failed) {
      const message = "音声の再生中にエラーが発生しました。";
      this.setStatus("error", message, "replay");
      this.callbacks.onWarning(message);
    } else {
      const timingLabel = this.latestTiming?.visemes.length ? "（VOICEVOX母音同期）" : "";
      this.setStatus("ready", `音声の再生が完了しました${timingLabel}。`, "replay");
    }
    this.callbacks.onPlaybackChange({ type: failed ? "failed" : "completed" });
  }

  private cancelLegacy(announce: boolean): boolean {
    const wasActive = this.requestController !== null || this.audio !== null;
    if (!wasActive) return false;
    this.operationId += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.latestOnStarted = null;
    this.audio?.pause();
    if (this.audio) this.audio.currentTime = 0;
    this.cleanupAudio();
    if (announce && !this.disposed) {
      this.setStatus("stopped", "音声を停止しました。", this.latestAudio ? "replay" : "none");
      this.callbacks.onPlaybackChange({ type: "stopped" });
    }
    return true;
  }

  private cleanupAudio(): void {
    this.lipSync?.stop();
    this.audio = null;
    if (this.audioUrl) this.objectUrls.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
  }

  private async prepareLipSync(
    audio: Blob,
    timing: SpeechTiming | null,
    operationId: number,
  ): Promise<void> {
    if (!this.lipSync) return;
    try {
      const ready = await this.lipSync.prepare(audio, timing);
      if (this.isCurrent(operationId) && !ready) {
        this.callbacks.onWarning("WAV振幅を解析できないため、Lip Syncなしで再生します。");
      }
    } catch {
      if (this.isCurrent(operationId)) {
        this.callbacks.onWarning("Lip Syncの準備に失敗したため、音声だけ再生します。");
      }
    }
  }

  private isCurrent(operationId: number): boolean {
    return !this.disposed && operationId === this.operationId;
  }

  private setStatus(state: SpeechStatus["state"], message: string, action: SpeechStatus["action"]): void {
    if (!this.disposed) this.callbacks.onStatusChange({ state, message, action });
  }

  private publicMessage(error: unknown): string {
    if (error instanceof SpeechApiError) {
      return error.requestId ? `${error.message}（Request ID: ${error.requestId}）` : error.message;
    }
    return "音声処理で予期しないエラーが発生しました。";
  }
}
