import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PushToTalkController,
  type AudioStreamLike,
  type RecorderLike,
  type TranscriptionGateway,
  type VoiceInputCallbacks,
} from "./PushToTalkController";
import { TranscriptionClient } from "./TranscriptionClient";
import type { TranscriptionHealth, TranscriptionResponse, VoiceInputStatus } from "./types";

const READY_HEALTH: TranscriptionHealth = {
  status: "ready",
  provider: "faster-whisper",
  model: "small",
  device: "cpu",
  compute_type: "int8",
  message: "ready",
};

const RESPONSE: TranscriptionResponse = {
  text: "こんにちは",
  language: "ja",
  language_probability: 0.99,
  audio_duration_seconds: 1.2,
  request_id: "request-1",
  latency_ms: 850,
};

afterEach(() => vi.unstubAllGlobals());

describe("TranscriptionClient", () => {
  it("uploads an audio blob as multipart form data", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toBeUndefined();
      expect(init?.body).toBeInstanceOf(FormData);
      expect((init?.body as FormData).get("audio")).toBeInstanceOf(Blob);
      return new Response(JSON.stringify(RESPONSE), { status: 200 });
    });
    const client = new TranscriptionClient(fetchMock, "/api", 1000);

    await expect(client.transcribe(new Blob(["audio"], { type: "audio/webm" }))).resolves.toEqual(RESPONSE);
  });

  it("uses the backend public error without exposing an unknown payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ detail: { code: "no_speech", message: "音声を検出できませんでした。", request_id: "req-2" } }),
        { status: 422 },
      ),
    );
    const client = new TranscriptionClient(fetchMock, "/api", 1000);

    await expect(client.transcribe(new Blob(["audio"]))).rejects.toMatchObject({
      message: "音声を検出できませんでした。",
      code: "no_speech",
      requestId: "req-2",
    });
  });
});

describe("PushToTalkController", () => {
  it("records only after a user action, transcribes, and returns a draft without sending it", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    const statuses: VoiceInputStatus[] = [];
    const transcripts: string[] = [];
    const states: string[] = [];
    const latencies: number[] = [];
    const track = { stop: vi.fn() };
    const stream: AudioStreamLike = { getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => stream);
    let recorder: FakeRecorder | null = null;
    const gateway: TranscriptionGateway = {
      getHealth: async () => READY_HEALTH,
      transcribe: vi.fn(async () => RESPONSE),
    };
    const callbacks: VoiceInputCallbacks = {
      onStatusChange: (status) => statuses.push(status),
      onTranscript: (text) => transcripts.push(text),
      onCharacterState: (state) => states.push(state),
      onMicrophonesChange: vi.fn(),
      onBeforeRecording: vi.fn(),
      onWarning: vi.fn(),
      onLatency: (latencyMs) => latencies.push(latencyMs),
    };
    const controller = new PushToTalkController(
      gateway,
      callbacks,
      { getUserMedia },
      () => (recorder = new FakeRecorder()),
    );

    await controller.initialize();
    expect(getUserMedia).not.toHaveBeenCalled();
    controller.toggle();
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("recording"));
    expect(getUserMedia).toHaveBeenCalledOnce();

    controller.toggle();
    await vi.waitFor(() => expect(transcripts).toEqual(["こんにちは"]));

    expect(recorder).not.toBeNull();
    expect(statuses.at(-1)).toMatchObject({ state: "ready", action: "start" });
    expect(states).toEqual(["listening", "thinking", "idle"]);
    expect(latencies).toHaveLength(1);
    expect(latencies[0]).toBeGreaterThanOrEqual(0);
    expect(track.stop).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("turns denied microphone permission into actionable guidance", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    const statuses: VoiceInputStatus[] = [];
    const warnings: string[] = [];
    const states: string[] = [];
    const controller = new PushToTalkController(
      { getHealth: async () => READY_HEALTH, transcribe: async () => RESPONSE },
      {
        onStatusChange: (status) => statuses.push(status),
        onTranscript: vi.fn(),
        onCharacterState: (state) => states.push(state),
        onMicrophonesChange: vi.fn(),
        onBeforeRecording: vi.fn(),
        onWarning: (message) => warnings.push(message),
      },
      { getUserMedia: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
      () => new FakeRecorder(),
    );

    await controller.initialize();
    controller.toggle();
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe("error"));

    expect(warnings.at(-1)).toContain("マイクの使用が許可されていません");
    expect(states.at(-1)).toBe("confused");
    controller.dispose();
  });

  it("lists available microphones and requests the selected device", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
    const microphoneUpdates: Array<{ ids: string[]; selected: string }> = [];
    const controller = new PushToTalkController(
      { getHealth: async () => READY_HEALTH, transcribe: async () => RESPONSE },
      {
        onStatusChange: vi.fn(),
        onTranscript: vi.fn(),
        onCharacterState: vi.fn(),
        onMicrophonesChange: (options, selected) => {
          microphoneUpdates.push({ ids: options.map((option) => option.deviceId), selected });
        },
        onBeforeRecording: vi.fn(),
        onWarning: vi.fn(),
      },
      {
        getUserMedia,
        enumerateDevices: async () => [
          { deviceId: "default", kind: "audioinput", label: "Headset Mic" },
          { deviceId: "mic-a", kind: "audioinput", label: "Webcam Mic" },
          { deviceId: "mic-b", kind: "audioinput", label: "USB Mic" },
          { deviceId: "camera-a", kind: "videoinput", label: "Webcam" },
        ],
      },
      () => new FakeRecorder(),
    );

    await controller.initialize();
    expect(microphoneUpdates.at(-1)?.ids).toEqual(["", "mic-a", "mic-b"]);
    controller.selectMicrophone("mic-b");
    expect(microphoneUpdates.at(-1)?.selected).toBe("mic-b");

    controller.toggle();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: "mic-b" } }),
      video: false,
    });
    controller.cancel();
    controller.dispose();
  });

  it("falls back to the default microphone when the selected device disappears", async () => {
    vi.stubGlobal("MediaRecorder", class {});
    const warnings: string[] = [];
    const track = { stop: vi.fn() };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("gone", "OverconstrainedError"))
      .mockResolvedValueOnce({ getTracks: () => [track] });
    const controller = new PushToTalkController(
      { getHealth: async () => READY_HEALTH, transcribe: async () => RESPONSE },
      {
        onStatusChange: vi.fn(),
        onTranscript: vi.fn(),
        onCharacterState: vi.fn(),
        onMicrophonesChange: vi.fn(),
        onBeforeRecording: vi.fn(),
        onWarning: (message) => warnings.push(message),
      },
      {
        getUserMedia,
        enumerateDevices: async () => [
          { deviceId: "default", kind: "audioinput", label: "Built-in Mic" },
          { deviceId: "mic-usb", kind: "audioinput", label: "USB Mic" },
        ],
      },
      () => new FakeRecorder(),
    );

    await controller.initialize();
    controller.selectMicrophone("mic-usb");
    controller.toggle();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));

    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({ audio: { deviceId: { exact: "mic-usb" } } });
    expect(getUserMedia.mock.calls[1]?.[0]).toMatchObject({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    expect(getUserMedia.mock.calls[1]?.[0].audio).not.toHaveProperty("deviceId");
    expect(warnings.at(-1)).toContain("既定のマイクへ戻しました");
    controller.cancel();
    controller.dispose();
  });
});

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
