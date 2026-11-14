import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PushToTalkController,
  type RecorderLike,
  type TranscriptionGateway,
  type VoiceInputCallbacks,
} from "./PushToTalkController";
import {
  VoiceActivityDetector,
  rootMeanSquare,
  type VoiceActivityCallbacks,
  type VoiceActivityMonitor,
} from "./VoiceActivityMonitor";
import type { TranscriptionHealth, TranscriptionResponse, VoiceInputStatus } from "./types";

const HEALTH: TranscriptionHealth = {
  status: "ready",
  provider: "faster-whisper",
  model: "small",
  device: "cpu",
  compute_type: "int8",
  message: "ready",
};

const RESPONSE: TranscriptionResponse = {
  text: "自動停止しました",
  language: "ja",
  language_probability: 0.99,
  audio_duration_seconds: 1.5,
  request_id: "request-vad",
  latency_ms: 600,
};

afterEach(() => vi.unstubAllGlobals());

describe("VoiceActivityDetector", () => {
  it("requires sustained speech and ends after one second of silence", () => {
    const detector = new VoiceActivityDetector();
    detector.reset(0);

    expect(detector.update(0.04, 0)).toBe("none");
    expect(detector.update(0.04, 120)).toBe("speech-start");
    expect(detector.update(0.04, 500)).toBe("none");
    expect(detector.update(0.005, 600)).toBe("none");
    expect(detector.update(0.005, 1_599)).toBe("none");
    expect(detector.update(0.005, 1_600)).toBe("speech-end");
  });

  it("reports no speech after five seconds and ignores a short spike", () => {
    const detector = new VoiceActivityDetector();
    detector.reset(0);

    expect(detector.update(0.04, 100)).toBe("none");
    expect(detector.update(0.001, 150)).toBe("none");
    expect(detector.update(0.001, 5_000)).toBe("no-speech");
  });

  it("calculates RMS from time-domain samples", () => {
    expect(rootMeanSquare(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(rootMeanSquare(new Float32Array())).toBe(0);
  });
});

describe("PushToTalk voice activity integration", () => {
  it("automatically stops and transcribes after speech ends", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    const statuses: VoiceInputStatus[] = [];
    const transcripts: string[] = [];
    const track = { stop: vi.fn() };
    const monitor = new FakeVoiceActivityMonitor();
    const gateway: TranscriptionGateway = {
      getHealth: async () => HEALTH,
      transcribe: vi.fn(async () => RESPONSE),
    };
    const controller = new PushToTalkController(
      gateway,
      callbacks(statuses, transcripts),
      { getUserMedia: async () => ({ getTracks: () => [track] }) },
      () => new FakeRecorder(),
      () => monitor,
    );

    await controller.initialize();
    controller.toggle();
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("recording"));
    monitor.callbacks?.onSpeechStart();
    expect(statuses.at(-1)?.message).toContain("声を検出しました");
    monitor.callbacks?.onSpeechEnd();
    await vi.waitFor(() => expect(transcripts).toEqual(["自動停止しました"]));

    expect(gateway.transcribe).toHaveBeenCalledOnce();
    expect(monitor.stop).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("rejects five seconds of silence without sending it to the backend", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    const statuses: VoiceInputStatus[] = [];
    const monitor = new FakeVoiceActivityMonitor();
    const transcribe = vi.fn(async () => RESPONSE);
    const controller = new PushToTalkController(
      { getHealth: async () => HEALTH, transcribe },
      callbacks(statuses, []),
      { getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }) },
      () => new FakeRecorder(),
      () => monitor,
    );

    await controller.initialize();
    controller.toggle();
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("recording"));
    monitor.callbacks?.onNoSpeech();
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("error"));

    expect(statuses.at(-1)?.message).toContain("音声を検出できませんでした");
    expect(transcribe).not.toHaveBeenCalled();
    controller.dispose();
  });
});

function callbacks(statuses: VoiceInputStatus[], transcripts: string[]): VoiceInputCallbacks {
  return {
    onStatusChange: (status) => statuses.push(status),
    onTranscript: (text) => transcripts.push(text),
    onCharacterState: vi.fn(),
    onMicrophonesChange: vi.fn(),
    onBeforeRecording: vi.fn(),
    onWarning: vi.fn(),
  };
}

class FakeVoiceActivityMonitor implements VoiceActivityMonitor {
  public callbacks: VoiceActivityCallbacks | null = null;
  public readonly stop = vi.fn();

  public start(_stream: MediaStream, callbacksValue: VoiceActivityCallbacks): void {
    this.callbacks = callbacksValue;
  }
}

class FakeRecorder implements RecorderLike {
  public state: RecordingState = "inactive";
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onstop: ((event: Event) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;

  public start(): void {
    this.state = "recording";
  }

  public stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded"], { type: "audio/webm" }) } as BlobEvent);
    this.onstop?.(new Event("stop"));
  }
}
