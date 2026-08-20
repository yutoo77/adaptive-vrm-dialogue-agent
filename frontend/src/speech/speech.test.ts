import { describe, expect, it, vi } from "vitest";

import { SpeechApiError, SpeechClient } from "./SpeechClient";
import {
  getVoicePlaybackRate,
  resolveSpeechDurationMs,
  SpeechController,
  type SpeechAudio,
  type SpeechCallbacks,
  type SpeechGateway,
  type LipSyncOutput,
} from "./SpeechController";
import type { SpeechHealth, SpeechStatus, SpeechSynthesisResult, SpeechTiming } from "./types";

const WAV_BYTES = new Uint8Array([
  82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
]);
const READY_HEALTH: SpeechHealth = {
  status: "ready",
  provider: "voicevox",
  speaker_id: 7,
  engine_version: "0.25.2",
  speaker_name: "テスト話者",
  style_name: "ノーマル",
  credit: "VOICEVOX:テスト話者",
  message: "ready",
};

class FakeAudio implements SpeechAudio {
  public currentTime = 0;
  public playbackRate = 1;
  public readonly duration: number;
  public readonly play: () => Promise<void>;
  public readonly pause = vi.fn();
  private readonly listeners = new Map<"ended" | "error", () => void>();

  public constructor(play: () => Promise<void> = async () => undefined, duration = 4) {
    this.play = vi.fn(play);
    this.duration = duration;
  }

  public addEventListener(type: "ended" | "error", listener: () => void): void {
    this.listeners.set(type, listener);
  }

  public emit(type: "ended" | "error"): void {
    this.listeners.get(type)?.();
  }
}

function createObservedCallbacks() {
  const statuses: SpeechStatus[] = [];
  const playback: Array<{ readonly type: string; readonly durationMs?: number }> = [];
  const warnings: string[] = [];
  const latencies: number[] = [];
  const callbacks: SpeechCallbacks = {
    onStatusChange: (status) => statuses.push(status),
    onPlaybackChange: (event) => playback.push(event),
    onWarning: (message) => warnings.push(message),
    onLatency: (latencyMs) => latencies.push(latencyMs),
  };
  return { callbacks, statuses, playback, warnings, latencies };
}

function createGateway(overrides: Partial<SpeechGateway> = {}): SpeechGateway {
  return {
    getHealth: async () => READY_HEALTH,
    synthesize: async (): Promise<SpeechSynthesisResult> => ({
      audio: new Blob([WAV_BYTES], { type: "audio/wav" }),
      timing: null,
    }),
    ...overrides,
  };
}

describe("SpeechClient", () => {
  it("requests WAV audio from the backend and validates its header", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ text: "こんにちは" }));
      return new Response(WAV_BYTES, {
        status: 200,
        headers: {
          "content-type": "audio/wav",
          "x-speech-timing-version": "1",
          "x-speech-duration-ms": "4000",
          "x-speech-phrase-boundaries": "1200,2600",
          "x-speech-visemes": "o:100:300,i:450:250,a:800:350",
        },
      });
    });
    const client = new SpeechClient(fetchMock, "/api", 1000);

    const result = await client.synthesize("こんにちは");

    expect(result.audio.type).toBe("audio/wav");
    expect(result.audio.size).toBe(WAV_BYTES.byteLength);
    expect(result.timing).toEqual({
      durationMs: 4000,
      phraseBoundariesMs: [1200, 2600],
      visemes: [
        { viseme: "o", startMs: 100, durationMs: 300 },
        { viseme: "i", startMs: 450, durationMs: 250 },
        { viseme: "a", startMs: 800, durationMs: 350 },
      ],
    });
  });

  it("uses the safe backend speech error and request ID", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          detail: {
            code: "voicevox_unreachable",
            message: "VOICEVOXを起動してください。",
            request_id: "speech-1",
          },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new SpeechClient(fetchMock, "/api", 1000);

    await expect(client.synthesize("テスト")).rejects.toMatchObject({
      message: "VOICEVOXを起動してください。",
      status: 503,
      code: "voicevox_unreachable",
      requestId: "speech-1",
    });
  });

  it("keeps valid WAV playback while discarding malformed optional timing metadata", async () => {
    const client = new SpeechClient(
      async () =>
        new Response(WAV_BYTES, {
          status: 200,
          headers: {
            "content-type": "audio/wav",
            "x-speech-timing-version": "1",
            "x-speech-duration-ms": "1000",
            "x-speech-phrase-boundaries": "700,300",
            "x-speech-visemes": "run_shell:0:100",
          },
        }),
      "/api",
      1000,
    );

    const result = await client.synthesize("Fallbackテスト");

    expect(result.audio.size).toBe(WAV_BYTES.byteLength);
    expect(result.timing).toEqual({ durationMs: 1000, phraseBoundariesMs: [], visemes: [] });
  });
});

describe("SpeechController", () => {
  it("applies a bounded voice-style tempo without changing the generated WAV", () => {
    expect(
      getVoicePlaybackRate({ emotion: "happy", intensity: 0.5, gesture: "soft_bounce", voice_style: "bright", cues: [] }),
    ).toBeCloseTo(1.03);
    expect(
      getVoicePlaybackRate({ emotion: "gentle", intensity: 1, gesture: "small_nod", voice_style: "gentle", cues: [] }),
    ).toBeCloseTo(0.93);
  });

  it("reports the resolved speaker, style, and credit after health check", async () => {
    const observed = createObservedCallbacks();
    const controller = new SpeechController(createGateway(), observed.callbacks);

    await controller.initialize();

    expect(observed.statuses.at(-1)).toEqual({
      state: "available",
      message: "VOICEVOX:テスト話者 / ノーマル v0.25.2 / ID 7",
      action: "none",
    });
  });

  it("moves through generation, playback, completion, and replay readiness", async () => {
    const audio = new FakeAudio();
    const observed = createObservedCallbacks();
    const revoke = vi.fn();
    const controller = new SpeechController(
      createGateway(),
      observed.callbacks,
      null,
      () => audio,
      { createObjectURL: () => "blob:test", revokeObjectURL: revoke },
    );

    controller.speak("こんにちは", {
      emotion: "happy",
      intensity: 0.5,
      gesture: "soft_bounce",
      voice_style: "bright",
      cues: [],
    });
    await vi.waitFor(() => expect(observed.statuses.at(-1)?.state).toBe("playing"));
    expect(observed.playback).toEqual([{ type: "started", durationMs: 3883, phraseBoundariesMs: [] }]);
    expect(audio.playbackRate).toBeCloseTo(1.03);
    expect(observed.latencies).toHaveLength(1);
    expect(observed.latencies[0]).toBeGreaterThanOrEqual(0);

    audio.emit("ended");
    expect(observed.statuses.at(-1)).toMatchObject({ state: "ready", action: "replay" });
    expect(observed.playback).toEqual([
      { type: "started", durationMs: 3883, phraseBoundariesMs: [] },
      { type: "completed" },
    ]);
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });

  it("stops active playback while retaining audio for replay", async () => {
    const audio = new FakeAudio();
    const observed = createObservedCallbacks();
    const controller = new SpeechController(
      createGateway(),
      observed.callbacks,
      null,
      () => audio,
      { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() },
    );

    controller.speak("停止テスト");
    await vi.waitFor(() => expect(observed.statuses.at(-1)?.state).toBe("playing"));
    controller.toggle();

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(observed.statuses.at(-1)).toMatchObject({ state: "stopped", action: "replay" });
    expect(observed.playback.at(-1)).toEqual({ type: "stopped" });
  });

  it("keeps generated audio replayable when browser autoplay is blocked", async () => {
    const blockedAudio = new FakeAudio(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });
    const replayAudio = new FakeAudio();
    const audios = [blockedAudio, replayAudio];
    const observed = createObservedCallbacks();
    const controller = new SpeechController(
      createGateway(),
      observed.callbacks,
      null,
      () => audios.shift() ?? replayAudio,
      { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() },
    );

    controller.speak("自動再生テスト");
    await vi.waitFor(() => expect(observed.statuses.at(-1)?.state).toBe("ready"));
    expect(observed.statuses.at(-1)?.action).toBe("replay");

    controller.toggle();
    await vi.waitFor(() => expect(observed.statuses.at(-1)?.state).toBe("playing"));
    expect(replayAudio.play).toHaveBeenCalledOnce();
  });

  it("reports synthesis failure without throwing away the text flow", async () => {
    const observed = createObservedCallbacks();
    const controller = new SpeechController(
      createGateway({
        synthesize: async () => {
          throw new SpeechApiError("VOICEVOXを起動してください。", 503, "voicevox_unreachable");
        },
      }),
      observed.callbacks,
      null,
      () => new FakeAudio(),
      { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() },
    );

    controller.speak("失敗テスト");
    await vi.waitFor(() => expect(observed.statuses.at(-1)?.state).toBe("error"));

    expect(observed.statuses.at(-1)?.message).toContain("Text回答はそのまま確認できます。");
    expect(observed.warnings).toEqual(["VOICEVOXを起動してください。"]);
    expect(observed.playback.at(-1)).toEqual({ type: "failed" });
  });

  it("prepares, starts, and stops lip sync with the audio lifecycle", async () => {
    const audio = new FakeAudio();
    const observed = createObservedCallbacks();
    const lipSync: LipSyncOutput = {
      prepare: vi.fn(async () => true),
      start: vi.fn(() => true),
      stop: vi.fn(),
      dispose: vi.fn(),
    };
    const controller = new SpeechController(
      createGateway(),
      observed.callbacks,
      lipSync,
      () => audio,
      { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() },
    );

    controller.speak("Lip Syncテスト");
    await vi.waitFor(() => expect(observed.statuses.at(-1)?.state).toBe("playing"));
    expect(lipSync.prepare).toHaveBeenCalledWith(expect.any(Blob), null);
    expect(lipSync.start).toHaveBeenCalledWith(audio);

    audio.emit("ended");
    expect(lipSync.stop).toHaveBeenCalled();
    controller.dispose();
    expect(lipSync.dispose).toHaveBeenCalledOnce();
  });
});

describe("speech duration", () => {
  it("uses media duration when available and a bounded Japanese-text estimate otherwise", () => {
    expect(resolveSpeechDurationMs(4, "短文", 2)).toBe(2000);
    expect(resolveSpeechDurationMs(Number.NaN, "短文", 2, 4000)).toBe(2000);
    expect(resolveSpeechDurationMs(Number.NaN, "こんにちは。", 1)).toBe(1000);
    expect(resolveSpeechDurationMs(9999, "長文", 1)).toBe(300_000);
  });

  it("scales phrase boundaries to the actual playback rate", async () => {
    const timing: SpeechTiming = {
      durationMs: 4000,
      phraseBoundariesMs: [1200, 2600],
      visemes: [{ viseme: "a", startMs: 100, durationMs: 300 }],
    };
    const audio = new FakeAudio(undefined, Number.NaN);
    const observed = createObservedCallbacks();
    const controller = new SpeechController(
      createGateway({
        synthesize: async () => ({ audio: new Blob([WAV_BYTES], { type: "audio/wav" }), timing }),
      }),
      observed.callbacks,
      null,
      () => audio,
      { createObjectURL: () => "blob:test", revokeObjectURL: vi.fn() },
    );

    controller.speak("境界テスト", {
      emotion: "happy",
      intensity: 0.5,
      gesture: "soft_bounce",
      voice_style: "bright",
      cues: [],
    });
    await vi.waitFor(() => expect(observed.statuses.at(-1)?.state).toBe("playing"));
    expect(observed.playback[0]).toEqual({
      type: "started",
      durationMs: 3883,
      phraseBoundariesMs: [1165, 2524],
    });
  });
});
