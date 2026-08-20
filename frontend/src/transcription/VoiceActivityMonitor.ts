export type VoiceActivityEvent = "none" | "speech-start" | "speech-end" | "no-speech";

export interface VoiceActivityConfig {
  readonly speechThreshold: number;
  readonly minimumSpeechMs: number;
  readonly endingSilenceMs: number;
  readonly noSpeechTimeoutMs: number;
  readonly silenceRatio: number;
}

export interface VoiceActivityCallbacks {
  readonly onSpeechStart: () => void;
  readonly onSpeechEnd: () => void;
  readonly onNoSpeech: () => void;
}

export interface VoiceActivityMonitor {
  readonly start: (stream: MediaStream, callbacks: VoiceActivityCallbacks) => void;
  readonly stop: () => void;
}

const DEFAULT_CONFIG: VoiceActivityConfig = {
  speechThreshold: 0.025,
  minimumSpeechMs: 120,
  endingSilenceMs: 1_000,
  noSpeechTimeoutMs: 5_000,
  silenceRatio: 0.65,
};

export class VoiceActivityDetector {
  private startedAt: number | null = null;
  private aboveThresholdSince: number | null = null;
  private silenceSince: number | null = null;
  private speechStarted = false;
  private completed = false;
  private readonly config: VoiceActivityConfig;

  public constructor(config: Partial<VoiceActivityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public reset(nowMs: number): void {
    this.startedAt = nowMs;
    this.aboveThresholdSince = null;
    this.silenceSince = null;
    this.speechStarted = false;
    this.completed = false;
  }

  public update(rawLevel: number, nowMs: number): VoiceActivityEvent {
    if (this.completed) return "none";
    if (this.startedAt === null) this.reset(nowMs);
    const level = Number.isFinite(rawLevel) ? Math.max(0, rawLevel) : 0;

    if (!this.speechStarted) {
      if (level >= this.config.speechThreshold) {
        this.aboveThresholdSince ??= nowMs;
        if (nowMs - this.aboveThresholdSince >= this.config.minimumSpeechMs) {
          this.speechStarted = true;
          this.aboveThresholdSince = null;
          return "speech-start";
        }
      } else {
        this.aboveThresholdSince = null;
      }

      if (nowMs - (this.startedAt ?? nowMs) >= this.config.noSpeechTimeoutMs) {
        this.completed = true;
        return "no-speech";
      }
      return "none";
    }

    const silenceThreshold = this.config.speechThreshold * this.config.silenceRatio;
    if (level < silenceThreshold) {
      this.silenceSince ??= nowMs;
      if (nowMs - this.silenceSince >= this.config.endingSilenceMs) {
        this.completed = true;
        return "speech-end";
      }
    } else {
      this.silenceSince = null;
    }
    return "none";
  }
}

export class BrowserVoiceActivityMonitor implements VoiceActivityMonitor {
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private frameId: number | null = null;

  public constructor(private readonly detector = new VoiceActivityDetector()) {}

  public start(stream: MediaStream, callbacks: VoiceActivityCallbacks): void {
    this.stop();
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    const source = context.createMediaStreamSource(stream);
    analyser.fftSize = 1024;
    source.connect(analyser);
    this.audioContext = context;
    this.source = source;
    this.detector.reset(performance.now());
    if (context.state === "suspended") void context.resume().catch(() => undefined);

    const samples = new Float32Array(analyser.fftSize);
    const observe = (nowMs: number): void => {
      analyser.getFloatTimeDomainData(samples);
      const event = this.detector.update(rootMeanSquare(samples), nowMs);
      if (event === "speech-start") callbacks.onSpeechStart();
      if (event === "speech-end" || event === "no-speech") {
        this.stop();
        if (event === "speech-end") callbacks.onSpeechEnd();
        else callbacks.onNoSpeech();
        return;
      }
      this.frameId = requestAnimationFrame(observe);
    };
    this.frameId = requestAnimationFrame(observe);
  }

  public stop(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.source?.disconnect();
    this.source = null;
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  }
}

export function rootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
