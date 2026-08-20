import type { SpeechTiming, SpeechViseme } from "./types";

export interface LipSyncAudioClock {
  readonly currentTime: number;
}

export interface LipSyncCallbacks {
  readonly onViseme: (viseme: SpeechViseme, weight: number) => void;
  readonly onReset: () => void;
}

interface AnimationScheduler {
  readonly request: (callback: FrameRequestCallback) => number;
  readonly cancel: (id: number) => void;
}

export interface LipSyncEnvelope {
  readonly frameDurationSeconds: number;
  readonly weights: readonly number[];
}

const DEFAULT_SCHEDULER: AnimationScheduler = {
  request: (callback) => globalThis.requestAnimationFrame(callback),
  cancel: (id) => globalThis.cancelAnimationFrame(id),
};

export class LipSyncController {
  private envelope: LipSyncEnvelope | null = null;
  private timing: SpeechTiming | null = null;
  private audio: LipSyncAudioClock | null = null;
  private animationFrameId: number | null = null;
  private previousTimestamp: number | null = null;
  private smoothedWeight = 0;
  private disposed = false;

  public constructor(
    private readonly callbacks: LipSyncCallbacks,
    private readonly scheduler: AnimationScheduler = DEFAULT_SCHEDULER,
  ) {}

  public async prepare(audio: Blob, timing: SpeechTiming | null = null): Promise<boolean> {
    if (this.disposed) return false;
    this.envelope = parseWavEnvelope(await audio.arrayBuffer());
    this.timing = timing;
    return this.envelope !== null;
  }

  public start(audio: LipSyncAudioClock): boolean {
    this.stop();
    if (!this.envelope || this.disposed) return false;
    this.audio = audio;
    this.previousTimestamp = null;
    this.smoothedWeight = 0;
    this.animationFrameId = this.scheduler.request((timestamp) => this.update(timestamp));
    return true;
  }

  public stop(): void {
    if (this.animationFrameId !== null) this.scheduler.cancel(this.animationFrameId);
    this.animationFrameId = null;
    this.audio = null;
    this.previousTimestamp = null;
    this.smoothedWeight = 0;
    this.callbacks.onReset();
  }

  public dispose(): void {
    this.disposed = true;
    this.stop();
    this.envelope = null;
    this.timing = null;
  }

  private update(timestamp: number): void {
    const audio = this.audio;
    const envelope = this.envelope;
    if (!audio || !envelope || this.disposed) return;

    const deltaSeconds = this.previousTimestamp === null ? 1 / 60 : Math.min((timestamp - this.previousTimestamp) / 1000, 0.1);
    this.previousTimestamp = timestamp;
    const index = Math.floor(audio.currentTime / envelope.frameDurationSeconds);
    const target = envelope.weights[index] ?? 0;
    const responseSeconds = target > this.smoothedWeight ? 0.035 : 0.08;
    const alpha = 1 - Math.exp(-deltaSeconds / responseSeconds);
    this.smoothedWeight += (target - this.smoothedWeight) * alpha;
    this.callbacks.onViseme(resolveVisemeAt(this.timing, audio.currentTime * 1000) ?? "a", this.smoothedWeight);
    this.animationFrameId = this.scheduler.request((nextTimestamp) => this.update(nextTimestamp));
  }
}

export function resolveVisemeAt(timing: SpeechTiming | null, timeMs: number): SpeechViseme | null {
  if (!timing?.visemes.length || !Number.isFinite(timeMs) || timeMs < 0) return null;
  let previous: SpeechTiming["visemes"][number] | null = null;
  for (const segment of timing.visemes) {
    const endMs = segment.startMs + segment.durationMs;
    if (timeMs >= segment.startMs - 35 && timeMs <= endMs + 25) return segment.viseme;
    if (segment.startMs > timeMs) {
      return segment.startMs - timeMs <= 90 ? segment.viseme : previous?.viseme ?? null;
    }
    previous = segment;
  }
  return previous && timeMs - (previous.startMs + previous.durationMs) <= 70 ? previous.viseme : null;
}

export function parseWavEnvelope(buffer: ArrayBuffer, frameDurationSeconds = 0.02): LipSyncEnvelope | null {
  const view = new DataView(buffer);
  if (view.byteLength < 44 || readFourCc(view, 0) !== "RIFF" || readFourCc(view, 8) !== "WAVE") {
    return null;
  }

  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = readFourCc(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > view.byteLength) return null;
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: view.getUint16(chunkDataOffset, true),
        channels: view.getUint16(chunkDataOffset + 2, true),
        sampleRate: view.getUint32(chunkDataOffset + 4, true),
        bitsPerSample: view.getUint16(chunkDataOffset + 14, true),
      };
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format || dataOffset < 0 || format.channels < 1 || format.sampleRate < 1) return null;
  const bytesPerSample = format.bitsPerSample / 8;
  if (!Number.isInteger(bytesPerSample) || bytesPerSample < 1) return null;
  const frameBytes = bytesPerSample * format.channels;
  const sampleFrames = Math.floor(dataSize / frameBytes);
  const samplesPerEnvelopeFrame = Math.max(1, Math.round(format.sampleRate * frameDurationSeconds));
  const weights: number[] = [];

  for (let frameStart = 0; frameStart < sampleFrames; frameStart += samplesPerEnvelopeFrame) {
    const frameEnd = Math.min(sampleFrames, frameStart + samplesPerEnvelopeFrame);
    let sumSquares = 0;
    let count = 0;
    for (let frame = frameStart; frame < frameEnd; frame += 1) {
      for (let channel = 0; channel < format.channels; channel += 1) {
        const sampleOffset = dataOffset + (frame * format.channels + channel) * bytesPerSample;
        const sample = readSample(view, sampleOffset, format.audioFormat, format.bitsPerSample);
        if (sample === null) return null;
        sumSquares += sample * sample;
        count += 1;
      }
    }
    const rms = count ? Math.sqrt(sumSquares / count) : 0;
    const gated = Math.max(0, rms - 0.012);
    weights.push(Math.min(1, Math.pow(gated * 3.4, 0.72)));
  }

  return weights.length ? { frameDurationSeconds, weights } : null;
}

function readSample(view: DataView, offset: number, audioFormat: number, bitsPerSample: number): number | null {
  if (audioFormat === 1 && bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
  if (audioFormat === 1 && bitsPerSample === 16) return view.getInt16(offset, true) / 32768;
  if (audioFormat === 1 && bitsPerSample === 24) {
    let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    if (value & 0x800000) value |= 0xff000000;
    return value / 8388608;
  }
  if (audioFormat === 1 && bitsPerSample === 32) return view.getInt32(offset, true) / 2147483648;
  if (audioFormat === 3 && bitsPerSample === 32) return view.getFloat32(offset, true);
  return null;
}

function readFourCc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}
