import { TranscriptionApiError } from "./TranscriptionClient";
import {
  BrowserVoiceActivityMonitor,
  type VoiceActivityMonitor,
} from "./VoiceActivityMonitor";
import type {
  MicrophoneOption,
  TranscriptionHealth,
  TranscriptionResponse,
  VoiceInputStatus,
} from "./types";
import type { CharacterState } from "../types/character";

export interface TranscriptionGateway {
  readonly getHealth: (signal?: AbortSignal) => Promise<TranscriptionHealth>;
  readonly transcribe: (audio: Blob, signal?: AbortSignal) => Promise<TranscriptionResponse>;
}

export interface VoiceInputCallbacks {
  readonly onStatusChange: (status: VoiceInputStatus) => void;
  readonly onTranscript: (text: string) => void;
  readonly onCharacterState: (state: CharacterState) => void;
  readonly onMicrophonesChange: (options: readonly MicrophoneOption[], selectedDeviceId: string) => void;
  readonly onBeforeRecording: () => void;
  readonly onWarning: (message: string) => void;
  readonly onLatency?: (latencyMs: number) => void;
}

export interface AudioTrackLike {
  readonly stop: () => void;
}

export interface AudioStreamLike {
  readonly getTracks: () => readonly AudioTrackLike[];
}

export interface MediaDevicesLike {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<AudioStreamLike>;
  readonly enumerateDevices?: () => Promise<readonly MediaDeviceInfoLike[]>;
  readonly addEventListener?: (type: "devicechange", listener: EventListener) => void;
  readonly removeEventListener?: (type: "devicechange", listener: EventListener) => void;
}

export interface MediaDeviceInfoLike {
  readonly deviceId: string;
  readonly kind: MediaDeviceKind;
  readonly label: string;
}

export interface RecorderLike {
  readonly state: RecordingState;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  readonly start: (timeslice?: number) => void;
  readonly stop: () => void;
}

type RecorderFactory = (stream: AudioStreamLike) => RecorderLike;
type VoiceActivityMonitorFactory = () => VoiceActivityMonitor | null;

const MAX_RECORDING_MS = 15_000;
const DEFAULT_MICROPHONE: MicrophoneOption = { deviceId: "", label: "既定のマイク" };

export class PushToTalkController {
  private operationId = 0;
  private requestController: AbortController | null = null;
  private recorder: RecorderLike | null = null;
  private stream: AudioStreamLike | null = null;
  private chunks: Blob[] = [];
  private stopTimer: number | null = null;
  private discardRecording = false;
  private disposed = false;
  private state: VoiceInputStatus["state"] = "checking";
  private microphones: readonly MicrophoneOption[] = [DEFAULT_MICROPHONE];
  private selectedDeviceId = "";
  private autoStopEnabled = true;
  private voiceActivityMonitor: VoiceActivityMonitor | null = null;
  private readonly handleDeviceChange: EventListener = () => void this.refreshMicrophones(true);

  public constructor(
    private readonly gateway: TranscriptionGateway,
    private readonly callbacks: VoiceInputCallbacks,
    private readonly mediaDevices: MediaDevicesLike | undefined = navigator.mediaDevices,
    private readonly createRecorder: RecorderFactory = (stream) => new MediaRecorder(stream as MediaStream),
    private readonly createVoiceActivityMonitor: VoiceActivityMonitorFactory = defaultVoiceActivityMonitorFactory,
  ) {}

  public async initialize(): Promise<void> {
    if (!this.mediaDevices?.getUserMedia || typeof globalThis.MediaRecorder === "undefined") {
      this.setStatus("unavailable", "このブラウザではマイク録音を利用できません。", "none");
      return;
    }
    this.mediaDevices.addEventListener?.("devicechange", this.handleDeviceChange);
    const operationId = ++this.operationId;
    const controller = new AbortController();
    this.requestController = controller;
    this.setStatus("checking", "ローカル音声認識の接続を確認しています。", "none");
    try {
      const health = await this.gateway.getHealth(controller.signal);
      if (!this.isCurrent(operationId)) return;
      await this.refreshMicrophones(false);
      if (!this.isCurrent(operationId)) return;
      this.setStatus("idle", `音声入力できます（${health.model} / 端末内処理）。`, "start");
    } catch (error: unknown) {
      if (!this.isCurrent(operationId)) return;
      this.setStatus("unavailable", this.publicMessage(error), "none");
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  public toggle(): void {
    if (this.disposed) return;
    if (this.state === "recording") {
      this.stopRecording();
      return;
    }
    if (this.state === "requesting" || this.state === "processing") {
      this.cancel();
      return;
    }
    if (this.state === "idle" || this.state === "ready" || this.state === "error") {
      void this.startRecording();
    }
  }

  public selectMicrophone(deviceId: string): void {
    if (this.disposed || this.isBusy()) return;
    const selected = this.microphones.find((option) => option.deviceId === deviceId);
    if (!selected) return;
    this.selectedDeviceId = selected.deviceId;
    this.callbacks.onMicrophonesChange(this.microphones, this.selectedDeviceId);
    this.setStatus("idle", `${selected.label}を次回の録音で使用します。`, "start");
  }

  public setAutoStop(enabled: boolean): void {
    if (this.disposed || this.isBusy()) return;
    this.autoStopEnabled = enabled;
    this.setStatus(
      "idle",
      enabled ? "話し終わりの無音を検出して自動停止します。" : "手動停止で音声を認識します。",
      "start",
    );
  }

  public cancel(): void {
    this.operationId += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.discardRecording = true;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.cleanupRecording();
    if (!this.disposed) {
      this.setStatus("idle", "音声入力をキャンセルしました。", "start");
      this.callbacks.onCharacterState("idle");
    }
  }

  public dispose(): void {
    this.mediaDevices?.removeEventListener?.("devicechange", this.handleDeviceChange);
    this.disposed = true;
    this.cancel();
  }

  private async startRecording(): Promise<void> {
    if (!this.mediaDevices) return;
    const operationId = ++this.operationId;
    this.callbacks.onBeforeRecording();
    this.setStatus("requesting", "マイクの使用許可を待っています。", "cancel");
    try {
      const stream = await this.acquireStream();
      if (!this.isCurrent(operationId)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      await this.refreshMicrophones(false);
      if (!this.isCurrent(operationId)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.chunks = [];
      this.discardRecording = false;
      const recorder = this.createRecorder(stream);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => this.fail("マイク録音中にエラーが発生しました。");
      recorder.onstop = () => void this.handleRecordingStopped(operationId);
      recorder.start(250);
      this.stopTimer = globalThis.setTimeout(() => this.stopRecording(), MAX_RECORDING_MS);
      this.setStatus("recording", "録音中です。もう一度押すと認識します（最大15秒）。", "stop");
      this.callbacks.onCharacterState("listening");
      if (this.autoStopEnabled) this.startVoiceActivityMonitoring(stream, operationId);
    } catch (error: unknown) {
      if (!this.isCurrent(operationId)) return;
      this.fail(this.microphoneErrorMessage(error));
    }
  }

  private stopRecording(): void {
    if (this.recorder?.state !== "recording") return;
    this.clearStopTimer();
    this.stopVoiceActivityMonitoring();
    this.setStatus("processing", "録音を端末内で文字起こししています。", "cancel");
    this.callbacks.onCharacterState("thinking");
    this.recorder.stop();
  }

  private async handleRecordingStopped(operationId: number): Promise<void> {
    const discarded = this.discardRecording;
    const mimeType = this.chunks.find((chunk) => chunk.type)?.type ?? "audio/webm";
    const audio = new Blob(this.chunks, { type: mimeType });
    this.cleanupRecording();
    if (discarded || !this.isCurrent(operationId)) return;
    if (audio.size === 0) {
      this.fail("音声を録音できませんでした。マイク設定を確認してください。");
      return;
    }

    const controller = new AbortController();
    this.requestController = controller;
    try {
      const startedAt = performance.now();
      const result = await this.gateway.transcribe(audio, controller.signal);
      if (!this.isCurrent(operationId)) return;
      this.callbacks.onLatency?.(Math.max(0, Math.round(performance.now() - startedAt)));
      this.callbacks.onTranscript(result.text);
      this.setStatus("ready", "文字起こししました。内容を確認してから送信してください。", "start");
      this.callbacks.onCharacterState("idle");
    } catch (error: unknown) {
      if (!this.isCurrent(operationId) || controller.signal.aborted) return;
      this.fail(this.publicMessage(error));
    } finally {
      if (this.requestController === controller) this.requestController = null;
    }
  }

  private cleanupRecording(): void {
    this.clearStopTimer();
    this.stopVoiceActivityMonitoring();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }

  private startVoiceActivityMonitoring(stream: AudioStreamLike, operationId: number): void {
    try {
      const monitor = this.createVoiceActivityMonitor();
      if (!monitor) return;
      this.voiceActivityMonitor = monitor;
      monitor.start(stream as MediaStream, {
        onSpeechStart: () => {
          if (!this.isCurrent(operationId) || this.state !== "recording") return;
          this.setStatus("recording", "声を検出しました。話し終わると自動で認識します。", "stop");
        },
        onSpeechEnd: () => {
          if (this.isCurrent(operationId) && this.state === "recording") this.stopRecording();
        },
        onNoSpeech: () => {
          if (!this.isCurrent(operationId) || this.state !== "recording") return;
          this.discardRecording = true;
          if (this.recorder?.state === "recording") this.recorder.stop();
          this.fail("音声を検出できませんでした。マイクへ近づいて、もう一度話してください。");
        },
      });
    } catch {
      this.voiceActivityMonitor = null;
      this.callbacks.onWarning("話し終わりの自動判定を開始できないため、手動停止を使用します。");
    }
  }

  private stopVoiceActivityMonitoring(): void {
    this.voiceActivityMonitor?.stop();
    this.voiceActivityMonitor = null;
  }

  private async acquireStream(): Promise<AudioStreamLike> {
    if (!this.mediaDevices) throw new Error("Media devices are unavailable.");
    try {
      return await this.mediaDevices.getUserMedia({ audio: this.audioConstraints(), video: false });
    } catch (error: unknown) {
      if (
        !this.selectedDeviceId ||
        (!isNamedError(error, "OverconstrainedError") && !isNamedError(error, "NotFoundError"))
      ) {
        throw error;
      }
      const unavailable = this.microphones.find((option) => option.deviceId === this.selectedDeviceId)?.label;
      this.selectedDeviceId = "";
      await this.refreshMicrophones(false);
      this.callbacks.onWarning(`${unavailable ?? "選択したマイク"}を利用できないため、既定のマイクへ戻しました。`);
      return this.mediaDevices.getUserMedia({ audio: this.audioConstraints(), video: false });
    }
  }

  private audioConstraints(): MediaTrackConstraints {
    const constraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    return this.selectedDeviceId
      ? { ...constraints, deviceId: { exact: this.selectedDeviceId } }
      : constraints;
  }

  private async refreshMicrophones(announceFallback: boolean): Promise<void> {
    if (!this.mediaDevices?.enumerateDevices) {
      this.callbacks.onMicrophonesChange(this.microphones, this.selectedDeviceId);
      return;
    }
    try {
      const devices = await this.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      const defaultLabel = audioInputs.find((device) => device.deviceId === "default")?.label;
      const options: MicrophoneOption[] = [
        {
          deviceId: "",
          label: defaultLabel ? `既定: ${normalizeDeviceLabel(defaultLabel)}` : "既定のマイク",
        },
      ];
      const knownIds = new Set<string>();
      audioInputs.forEach((device, index) => {
        if (!device.deviceId || device.deviceId === "default" || knownIds.has(device.deviceId)) return;
        knownIds.add(device.deviceId);
        options.push({
          deviceId: device.deviceId,
          label: normalizeDeviceLabel(device.label) || `マイク ${index + 1}`,
        });
      });

      const previousDeviceId = this.selectedDeviceId;
      if (previousDeviceId && !options.some((option) => option.deviceId === previousDeviceId)) {
        this.selectedDeviceId = "";
        if (announceFallback) {
          this.callbacks.onWarning("選択中のマイクが外されたため、既定のマイクへ戻しました。");
        }
      }
      this.microphones = options;
      this.callbacks.onMicrophonesChange(options, this.selectedDeviceId);
    } catch {
      this.callbacks.onMicrophonesChange(this.microphones, this.selectedDeviceId);
    }
  }

  private clearStopTimer(): void {
    if (this.stopTimer !== null) globalThis.clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }

  private fail(message: string): void {
    this.operationId += 1;
    this.requestController?.abort();
    this.requestController = null;
    this.cleanupRecording();
    if (this.disposed) return;
    this.setStatus("error", message, "start");
    this.callbacks.onCharacterState("confused");
    this.callbacks.onWarning(message);
  }

  private setStatus(
    state: VoiceInputStatus["state"],
    message: string,
    action: VoiceInputStatus["action"],
  ): void {
    this.state = state;
    if (!this.disposed) this.callbacks.onStatusChange({ state, message, action });
  }

  private isCurrent(operationId: number): boolean {
    return !this.disposed && operationId === this.operationId;
  }

  private isBusy(): boolean {
    return this.state === "requesting" || this.state === "recording" || this.state === "processing";
  }

  private publicMessage(error: unknown): string {
    if (error instanceof TranscriptionApiError) {
      return error.requestId ? `${error.message}（Request ID: ${error.requestId}）` : error.message;
    }
    return "音声認識で予期しないエラーが発生しました。";
  }

  private microphoneErrorMessage(error: unknown): string {
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      return "マイクの使用が許可されていません。ブラウザのサイト設定から許可してください。";
    }
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return "利用できるマイクが見つかりません。接続とOS設定を確認してください。";
    }
    return "マイクを開始できませんでした。ブラウザとOSのマイク設定を確認してください。";
  }
}

function normalizeDeviceLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, 120);
}

function isNamedError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}

function defaultVoiceActivityMonitorFactory(): VoiceActivityMonitor | null {
  return typeof globalThis.AudioContext === "function" ? new BrowserVoiceActivityMonitor() : null;
}
