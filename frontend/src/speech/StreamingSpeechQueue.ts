import type { PerformancePlan } from "../types/character";
import { getVoicePlaybackRate, resolveSpeechDurationMs } from "./SpeechPlayback";
import { SpeechApiError } from "./SpeechClient";
import type {
  AudioFactory,
  LipSyncOutput,
  ObjectUrlApi,
  SpeechAudio,
  SpeechCallbacks,
  SpeechGateway,
} from "./SpeechController";
import { StreamingSpeechSegmenter } from "./StreamingSpeechSegmenter";
import type { SpeechStatus, SpeechTiming } from "./types";

interface PreparedSpeechSegment {
  readonly text: string;
  readonly audio: Blob;
  readonly timing: SpeechTiming | null;
}

interface StreamingSpeechSession {
  readonly operationId: number;
  readonly segmenter: StreamingSpeechSegmenter;
  readonly startedAt: number;
  receivedText: string;
  finalText: string | null;
  performance: PerformancePlan | null;
  onStarted: (() => void) | null;
  synthesisTail: Promise<void>;
  playbackTail: Promise<void>;
  scheduledSegments: number;
  playedSegments: number;
  playedCharacters: number;
  finalized: boolean;
  failed: boolean;
  playbackStarted: boolean;
  timelineStarted: boolean;
}

export type StreamingSpeechCompletion =
  | { readonly handled: true }
  | { readonly handled: false; readonly onStarted?: () => void };

export class StreamingSpeechQueue {
  private operationId = 0;
  private requestController: AbortController | null = null;
  private audio: SpeechAudio | null = null;
  private audioUrl: string | null = null;
  private activePlaybackResolve: (() => void) | null = null;
  private session: StreamingSpeechSession | null = null;
  private replaySegments: PreparedSpeechSegment[] = [];
  private latestText = "";
  private latestPerformance: PerformancePlan | null = null;
  private disposed = false;

  public constructor(
    private readonly gateway: SpeechGateway,
    private readonly callbacks: SpeechCallbacks,
    private readonly lipSync: LipSyncOutput | null,
    private readonly createAudio: AudioFactory,
    private readonly objectUrls: ObjectUrlApi,
  ) {}

  public begin(onStarted?: () => void): void {
    this.cancelActive(false);
    this.replaySegments = [];
    this.latestText = "";
    this.latestPerformance = null;
    const operationId = ++this.operationId;
    this.session = {
      operationId,
      segmenter: new StreamingSpeechSegmenter(),
      startedAt: performance.now(),
      receivedText: "",
      finalText: null,
      performance: null,
      onStarted: onStarted ?? null,
      synthesisTail: Promise.resolve(),
      playbackTail: Promise.resolve(),
      scheduledSegments: 0,
      playedSegments: 0,
      playedCharacters: 0,
      finalized: false,
      failed: false,
      playbackStarted: false,
      timelineStarted: false,
    };
    this.setStatus("generating", "最初の文を待っています。", "stop");
  }

  public append(delta: string): void {
    const session = this.session;
    if (!session || !this.isCurrent(session) || session.finalized || session.failed || !delta) return;
    session.receivedText += delta;
    for (const segment of session.segmenter.push(delta)) this.queueSegment(session, segment);
  }

  public complete(finalText: string, performancePlan?: PerformancePlan): StreamingSpeechCompletion {
    const session = this.session;
    if (!session || !this.isCurrent(session) || session.failed) return { handled: true };
    if (session.receivedText !== finalText) {
      const onStarted = session.onStarted ?? undefined;
      this.callbacks.onWarning(
        "途中表示と確定した本文が一致しなかったため、先行音声を破棄して確定本文を再生成します。",
      );
      this.discard();
      return onStarted ? { handled: false, onStarted } : { handled: false };
    }

    session.finalized = true;
    session.finalText = finalText;
    session.performance = performancePlan ?? null;
    this.latestText = finalText;
    this.latestPerformance = performancePlan ?? null;
    for (const segment of session.segmenter.complete()) this.queueSegment(session, segment);
    if (this.audio && session.playbackStarted) this.emitTimelineStarted(session);
    this.maybeFinish(session);
    return { handled: true };
  }

  public toggle(): boolean {
    if (this.cancelActive(true)) return true;
    if (this.disposed || !this.replaySegments.length) return false;
    const operationId = ++this.operationId;
    void this.playReplay(operationId);
    return true;
  }

  public stop(announce: boolean): boolean {
    return this.cancelActive(announce);
  }

  public discard(): void {
    this.cancelActive(false);
    this.replaySegments = [];
    this.latestText = "";
    this.latestPerformance = null;
  }

  public dispose(): void {
    this.disposed = true;
    this.discard();
  }

  private queueSegment(session: StreamingSpeechSession, text: string): void {
    if (!text || !this.isCurrent(session) || session.failed) return;
    session.scheduledSegments += 1;
    const synthesis = session.synthesisTail.then(async (): Promise<PreparedSpeechSegment | null> => {
      if (!this.isCurrent(session) || session.failed) return null;
      const controller = new AbortController();
      this.requestController = controller;
      try {
        const result = await this.gateway.synthesize(text, controller.signal);
        if (!this.isCurrent(session) || controller.signal.aborted) return null;
        const prepared = { text, audio: result.audio, timing: result.timing };
        this.replaySegments.push(prepared);
        return prepared;
      } catch (error: unknown) {
        if (this.isCurrent(session) && !controller.signal.aborted) this.fail(session, error);
        return null;
      } finally {
        if (this.requestController === controller) this.requestController = null;
      }
    });
    session.synthesisTail = synthesis.then(() => undefined);
    const playback = session.playbackTail.then(async () => {
      const prepared = await synthesis;
      if (prepared && this.isCurrent(session) && !session.failed) {
        await this.playSegment(session, prepared);
      }
    });
    session.playbackTail = playback.catch((error: unknown) => {
      if (this.isCurrent(session) && !session.failed) this.fail(session, error);
    });
  }

  private async playSegment(session: StreamingSpeechSession, segment: PreparedSpeechSegment): Promise<void> {
    await this.prepareLipSync(segment.audio, segment.timing, session.operationId);
    if (!this.isCurrent(session) || session.failed) return;

    const url = this.objectUrls.createObjectURL(segment.audio);
    const audio = this.createAudio(url);
    audio.playbackRate = getVoicePlaybackRate(session.performance);
    this.audioUrl = url;
    this.audio = audio;

    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (failed: boolean): void => {
        if (settled) return;
        settled = true;
        if (this.activePlaybackResolve === cancelPlayback) this.activePlaybackResolve = null;
        if (!this.isCurrent(session) || this.audio !== audio) {
          resolve();
          return;
        }
        this.cleanupAudio();
        if (failed) {
          this.fail(session, new Error("audio_playback_failed"));
        } else {
          session.playedSegments += 1;
          session.playedCharacters += segment.text.length;
          this.maybeFinish(session);
          if (this.isCurrent(session) && !session.finalized) {
            this.setStatus("generating", "続きの文を待っています。", "stop");
          }
        }
        resolve();
      };
      const cancelPlayback = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.activePlaybackResolve = cancelPlayback;
      audio.addEventListener("ended", () => settle(false), { once: true });
      audio.addEventListener("error", () => settle(true), { once: true });

      void audio.play().then(
        () => {
          if (!this.isCurrent(session) || this.audio !== audio) {
            audio.pause();
            settle(false);
            return;
          }
          if (!session.playbackStarted) {
            session.playbackStarted = true;
            const onStarted = session.onStarted;
            session.onStarted = null;
            onStarted?.();
            this.callbacks.onLatency?.(Math.max(0, Math.round(performance.now() - session.startedAt)));
          }
          if (session.finalized) this.emitTimelineStarted(session);
          const lipSyncLabel = segment.timing?.visemes.length ? "（VOICEVOX母音同期）" : "";
          this.setStatus("playing", `音声を順番に再生しています${lipSyncLabel}。`, "stop");
          this.lipSync?.start(audio);
        },
        () => {
          if (!this.isCurrent(session)) {
            settle(false);
            return;
          }
          session.failed = true;
          this.cancelActive(false);
          this.setStatus("ready", "自動再生できませんでした。再生ボタンを押してください。", "replay");
          this.callbacks.onPlaybackChange({ type: "failed" });
          settle(false);
        },
      );
    });
  }

  private emitTimelineStarted(session: StreamingSpeechSession): void {
    if (session.timelineStarted || !session.finalized || !session.finalText) return;
    session.timelineStarted = true;
    const remainingText = session.finalText.slice(Math.min(session.playedCharacters, session.finalText.length));
    this.callbacks.onPlaybackChange({
      type: "started",
      durationMs: resolveSpeechDurationMs(
        Number.NaN,
        remainingText || session.finalText,
        getVoicePlaybackRate(session.performance),
      ),
      phraseBoundariesMs: [],
    });
  }

  private maybeFinish(session: StreamingSpeechSession): void {
    if (
      !this.isCurrent(session) ||
      session.failed ||
      !session.finalized ||
      this.audio ||
      session.playedSegments < session.scheduledSegments
    ) {
      return;
    }
    this.session = null;
    const timingLabel = this.replaySegments.some((segment) => segment.timing?.visemes.length)
      ? "（VOICEVOX母音同期）"
      : "";
    this.setStatus("ready", `音声の再生が完了しました${timingLabel}。`, "replay");
    if (session.playbackStarted) this.callbacks.onPlaybackChange({ type: "completed" });
  }

  private fail(session: StreamingSpeechSession, error: unknown): void {
    if (session.failed || !this.isCurrent(session)) return;
    session.failed = true;
    const message = this.publicMessage(error);
    this.cancelActive(false);
    this.replaySegments = [];
    this.setStatus("error", `${message} Text回答はそのまま確認できます。`, "none");
    this.callbacks.onPlaybackChange({ type: "failed" });
    this.callbacks.onWarning(message);
  }

  private async playReplay(operationId: number): Promise<void> {
    const segments = [...this.replaySegments];
    if (!segments.length || !this.isOperationCurrent(operationId)) return;
    let started = false;
    for (const segment of segments) {
      await this.prepareLipSync(segment.audio, segment.timing, operationId);
      if (!this.isOperationCurrent(operationId)) return;
      const completed = await this.playReplaySegment(segment, operationId, () => {
        if (started) return;
        started = true;
        this.callbacks.onPlaybackChange({
          type: "started",
          durationMs: resolveSpeechDurationMs(
            Number.NaN,
            this.latestText,
            getVoicePlaybackRate(this.latestPerformance),
          ),
          phraseBoundariesMs: [],
        });
      });
      if (!completed) return;
    }
    if (!this.isOperationCurrent(operationId)) return;
    this.setStatus("ready", "音声の再生が完了しました。", "replay");
    if (started) this.callbacks.onPlaybackChange({ type: "completed" });
  }

  private async playReplaySegment(
    segment: PreparedSpeechSegment,
    operationId: number,
    onStarted: () => void,
  ): Promise<boolean> {
    const url = this.objectUrls.createObjectURL(segment.audio);
    const audio = this.createAudio(url);
    audio.playbackRate = getVoicePlaybackRate(this.latestPerformance);
    this.audioUrl = url;
    this.audio = audio;
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (completed: boolean): void => {
        if (settled) return;
        settled = true;
        if (this.activePlaybackResolve === cancelPlayback) this.activePlaybackResolve = null;
        if (this.audio === audio) this.cleanupAudio();
        resolve(completed);
      };
      const cancelPlayback = (): void => settle(false);
      this.activePlaybackResolve = cancelPlayback;
      audio.addEventListener("ended", () => settle(true), { once: true });
      audio.addEventListener("error", () => settle(false), { once: true });
      void audio.play().then(
        () => {
          if (!this.isOperationCurrent(operationId) || this.audio !== audio) {
            audio.pause();
            settle(false);
            return;
          }
          onStarted();
          this.setStatus("playing", "音声を再生しています。", "stop");
          this.lipSync?.start(audio);
        },
        () => {
          if (this.isOperationCurrent(operationId)) {
            const message = "音声を再生できませんでした。ブラウザの音声設定を確認してください。";
            this.setStatus("error", message, "replay");
            this.callbacks.onPlaybackChange({ type: "failed" });
            this.callbacks.onWarning(message);
          }
          settle(false);
        },
      );
    });
  }

  private cancelActive(announce: boolean): boolean {
    const wasActive =
      this.requestController !== null ||
      this.audio !== null ||
      this.session !== null ||
      this.activePlaybackResolve !== null;
    if (!wasActive) return false;
    this.operationId += 1;
    this.session?.segmenter.discard();
    this.session = null;
    this.requestController?.abort();
    this.requestController = null;
    const resolvePlayback = this.activePlaybackResolve;
    this.activePlaybackResolve = null;
    resolvePlayback?.();
    this.audio?.pause();
    if (this.audio) this.audio.currentTime = 0;
    this.cleanupAudio();
    if (announce && !this.disposed) {
      this.setStatus("stopped", "音声を停止しました。", this.replaySegments.length ? "replay" : "none");
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
      if (this.isOperationCurrent(operationId) && !ready) {
        this.callbacks.onWarning("WAV振幅を解析できないため、Lip Syncなしで再生します。");
      }
    } catch {
      if (this.isOperationCurrent(operationId)) {
        this.callbacks.onWarning("Lip Syncの準備に失敗したため、音声だけ再生します。");
      }
    }
  }

  private isCurrent(session: StreamingSpeechSession): boolean {
    return this.session === session && this.isOperationCurrent(session.operationId);
  }

  private isOperationCurrent(operationId: number): boolean {
    return !this.disposed && operationId === this.operationId;
  }

  private setStatus(state: SpeechStatus["state"], message: string, action: SpeechStatus["action"]): void {
    if (!this.disposed) this.callbacks.onStatusChange({ state, message, action });
  }

  private publicMessage(error: unknown): string {
    if (error instanceof SpeechApiError) {
      return error.requestId ? `${error.message}（Request ID: ${error.requestId}）` : error.message;
    }
    if (error instanceof Error && error.message === "audio_playback_failed") {
      return "音声の再生中にエラーが発生しました。";
    }
    return "音声処理で予期しないエラーが発生しました。";
  }
}
