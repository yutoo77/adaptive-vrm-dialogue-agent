import { describe, expect, it, vi } from "vitest";

import { LipSyncController, parseWavEnvelope, resolveVisemeAt } from "./LipSyncController";
import type { SpeechTiming } from "./types";

function createPcm16Wav(samples: readonly number[], sampleRate = 1000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(sample * 32767), true));
  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
}

describe("parseWavEnvelope", () => {
  it("turns PCM loudness into gated mouth weights", () => {
    const samples = [...Array<number>(20).fill(0), ...Array<number>(20).fill(0.35)];
    const envelope = parseWavEnvelope(createPcm16Wav(samples));

    expect(envelope?.frameDurationSeconds).toBe(0.02);
    expect(envelope?.weights).toHaveLength(2);
    expect(envelope?.weights[0]).toBe(0);
    expect(envelope?.weights[1]).toBeGreaterThan(0.5);
    expect(envelope?.weights[1]).toBeLessThanOrEqual(1);
  });

  it("rejects data that is not a supported WAV", () => {
    expect(parseWavEnvelope(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  });
});

describe("LipSyncController", () => {
  it("follows playback time and resets the mouth immediately on stop", async () => {
    const scheduled: FrameRequestCallback[] = [];
    const scheduler = {
      request: vi.fn((callback: FrameRequestCallback) => {
        scheduled.push(callback);
        return 1;
      }),
      cancel: vi.fn(),
    };
    const frames: Array<{ viseme: string; weight: number }> = [];
    const onReset = vi.fn();
    const controller = new LipSyncController(
      { onViseme: (viseme, weight) => frames.push({ viseme, weight }), onReset },
      scheduler,
    );
    const samples = Array<number>(60).fill(0.4);
    const audio = { currentTime: 0.03 };

    await expect(controller.prepare(new Blob([createPcm16Wav(samples)]))).resolves.toBe(true);
    expect(controller.start(audio)).toBe(true);
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.(16);
    expect(frames.at(-1)?.viseme).toBe("a");
    expect(frames.at(-1)?.weight).toBeGreaterThan(0);

    controller.stop();
    expect(scheduler.cancel).toHaveBeenCalled();
    expect(onReset).toHaveBeenCalled();
  });

  it("switches among VOICEVOX vowel visemes while retaining amplitude weight", async () => {
    const scheduled: FrameRequestCallback[] = [];
    const frames: Array<{ viseme: string; weight: number }> = [];
    const timing: SpeechTiming = {
      durationMs: 1000,
      phraseBoundariesMs: [],
      visemes: [
        { viseme: "o", startMs: 50, durationMs: 150 },
        { viseme: "i", startMs: 250, durationMs: 150 },
      ],
    };
    const controller = new LipSyncController(
      { onViseme: (viseme, weight) => frames.push({ viseme, weight }), onReset: vi.fn() },
      { request: (callback) => (scheduled.push(callback), scheduled.length), cancel: vi.fn() },
    );
    const audio = { currentTime: 0.1 };
    await controller.prepare(new Blob([createPcm16Wav(Array<number>(1000).fill(0.4))]), timing);
    controller.start(audio);
    scheduled.shift()?.(16);
    expect(frames.at(-1)?.viseme).toBe("o");

    audio.currentTime = 0.3;
    scheduled.shift()?.(32);
    expect(frames.at(-1)?.viseme).toBe("i");
  });
});

describe("resolveVisemeAt", () => {
  const timing: SpeechTiming = {
    durationMs: 1000,
    phraseBoundariesMs: [],
    visemes: [
      { viseme: "a", startMs: 100, durationMs: 100 },
      { viseme: "o", startMs: 300, durationMs: 100 },
    ],
  };

  it("anticipates the next mora slightly and closes across long pauses", () => {
    expect(resolveVisemeAt(timing, 70)).toBe("a");
    expect(resolveVisemeAt(timing, 330)).toBe("o");
    expect(resolveVisemeAt(timing, 900)).toBeNull();
  });
});
