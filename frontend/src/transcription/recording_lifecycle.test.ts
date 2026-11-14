import { afterEach, describe, expect, it, vi } from "vitest";
import { PushToTalkController, type AudioStreamLike, type MediaDeviceInfoLike, type MediaDevicesLike, type RecorderLike, type VoiceInputCallbacks } from "./PushToTalkController";
import type { VoiceActivityCallbacks } from "./VoiceActivityMonitor";
import type { TranscriptionResponse } from "./types";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class QueuedRecorder implements RecorderLike {
  state: RecordingState = "inactive";
  ondataavailable: RecorderLike["ondataavailable"] = null;
  onstop: RecorderLike["onstop"] = null;
  onerror: RecorderLike["onerror"] = null;
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => { this.state = "inactive"; });
  emit(text: string) { this.ondataavailable?.({ data: new Blob([text], { type: "audio/webm" }) } as BlobEvent); }
  finish() { this.onstop?.(new Event("stop")); }
}

const RESULT: TranscriptionResponse = {
  text: "架空のテスト文", language: "ja", language_probability: 1,
  audio_duration_seconds: 1, latency_ms: 10, request_id: "fake-recording",
};

function setup() {
  vi.stubGlobal("MediaRecorder", class {});
  const tracks: { stop: ReturnType<typeof vi.fn> }[] = [];
  const recorders: QueuedRecorder[] = [];
  const callbacks: VoiceInputCallbacks = {
    onStatusChange: vi.fn(), onTranscript: vi.fn(), onWarning: vi.fn(),
    onCharacterState: vi.fn(), onMicrophonesChange: vi.fn(), onBeforeRecording: vi.fn(),
  };
  const getUserMedia = vi.fn<MediaDevicesLike["getUserMedia"]>().mockImplementation(async () => {
    const track = { stop: vi.fn() }; tracks.push(track);
    return { getTracks: () => [track] };
  });
  const devices: readonly MediaDeviceInfoLike[] = [{ kind: "audioinput", deviceId: "usb", label: "Test USB" }];
  const enumerateDevices = vi.fn<() => Promise<readonly MediaDeviceInfoLike[]>>().mockResolvedValue(devices);
  const addEventListener = vi.fn<NonNullable<MediaDevicesLike["addEventListener"]>>();
  const transcribe = vi.fn().mockResolvedValue(RESULT);
  const monitorCallbacks: VoiceActivityCallbacks[] = [];
  const monitorStops: ReturnType<typeof vi.fn>[] = [];
  const controller = new PushToTalkController({
    getHealth: async () => ({ status: "ready", provider: "faster-whisper", model: "small", device: "cpu", compute_type: "int8", message: "ready" }),
    transcribe,
  }, callbacks, { getUserMedia, enumerateDevices, addEventListener }, () => {
    const recorder = new QueuedRecorder(); recorders.push(recorder); return recorder;
  }, () => {
    const stop = vi.fn(); monitorStops.push(stop);
    return { start: (_stream, handlers) => { monitorCallbacks.push(handlers); }, stop };
  });
  const start = async () => {
    controller.toggle();
    await vi.waitFor(() => expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "recording" })));
    return recorders[recorders.length - 1]!;
  };
  return { controller, start, tracks, recorders, callbacks, getUserMedia, enumerateDevices, addEventListener, transcribe, monitorCallbacks, monitorStops };
}

describe("recording resource ownership", () => {
  it.each(["data", "stop", "error"] as const)("ignores queued old %s events after cancel and immediate re-record", async (event) => {
    const env = setup();
    await env.controller.initialize();
    const old = await env.start();
    const queuedData = old.ondataavailable;
    const queuedStop = old.onstop;
    const queuedError = old.onerror;
    env.controller.cancel();
    const current = await env.start();
    if (event === "data") queuedData?.({ data: new Blob(["OLD"], { type: "audio/webm" }) } as BlobEvent);
    if (event === "stop") queuedStop?.(new Event("stop"));
    if (event === "error") queuedError?.({} as ErrorEvent);
    expect(env.tracks[1]?.stop).not.toHaveBeenCalled();
    expect(env.callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "recording" }));
    expect(env.callbacks.onWarning).not.toHaveBeenCalled();
    current.emit("NEW");
    env.controller.toggle(); current.finish();
    await vi.waitFor(() => expect(env.transcribe).toHaveBeenCalledTimes(1));
    expect(await (env.transcribe.mock.calls[0]?.[0] as Blob).text()).toBe("NEW");
    expect(env.callbacks.onTranscript).toHaveBeenCalledWith(RESULT.text);
    env.controller.dispose();
  });

  it("detaches, stops and releases an errored recorder and rejects queued data/stop", async () => {
    const env = setup();
    await env.controller.initialize(); const recorder = await env.start();
    const queuedStop = recorder.onstop;
    const queuedData = recorder.ondataavailable;
    recorder.onerror?.({} as ErrorEvent);
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(recorder.ondataavailable).toBeNull();
    expect(recorder.onerror).toBeNull();
    expect(recorder.onstop).toBeNull();
    expect(env.tracks[0]?.stop).toHaveBeenCalledOnce();
    expect(env.monitorStops[0]).toHaveBeenCalledOnce();
    queuedData?.({ data: new Blob(["discard"]) } as BlobEvent); queuedStop?.(new Event("stop"));
    expect(env.transcribe).not.toHaveBeenCalled();
    expect(env.callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "error" }));
    env.controller.dispose();
  });

  it("does not retry a disappeared microphone after cancellation during enumeration", async () => {
    const env = setup();
    await env.controller.initialize(); env.controller.selectMicrophone("usb");
    const pending = deferred<readonly MediaDeviceInfoLike[]>();
    env.enumerateDevices.mockReturnValueOnce(pending.promise);
    env.getUserMedia.mockRejectedValueOnce(new DOMException("gone", "NotFoundError"));
    env.controller.toggle();
    await vi.waitFor(() => expect(env.enumerateDevices).toHaveBeenCalledTimes(2));
    env.controller.cancel(); pending.resolve([]);
    await vi.waitFor(() => expect(env.callbacks.onMicrophonesChange).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(env.getUserMedia).toHaveBeenCalledOnce();
    expect(env.callbacks.onWarning).not.toHaveBeenCalled();
    env.controller.dispose();
  });

  it("does not retry a disappeared microphone whose permission result arrives after cancellation", async () => {
    const env = setup();
    await env.controller.initialize(); env.controller.selectMicrophone("usb");
    const pending = deferred<AudioStreamLike>();
    env.getUserMedia.mockReturnValueOnce(pending.promise);
    env.controller.toggle(); env.controller.cancel();
    pending.reject(new DOMException("gone", "OverconstrainedError"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(env.getUserMedia).toHaveBeenCalledOnce();
    expect(env.callbacks.onWarning).not.toHaveBeenCalled();
    env.controller.dispose();
  });

  it("releases a late permission grant without stopping the replacement recording", async () => {
    const env = setup();
    await env.controller.initialize();
    const pending = deferred<AudioStreamLike>();
    const lateTrack = { stop: vi.fn() };
    env.getUserMedia.mockReturnValueOnce(pending.promise);
    env.controller.toggle(); env.controller.cancel();
    await env.start();
    pending.resolve({ getTracks: () => [lateTrack] });
    await vi.waitFor(() => expect(lateTrack.stop).toHaveBeenCalledOnce());
    expect(env.tracks[0]?.stop).not.toHaveBeenCalled();
    expect(env.recorders).toHaveLength(1);
    env.controller.dispose();
  });

  it("ignores obsolete device enumeration arriving after a newer device change", async () => {
    const env = setup();
    await env.controller.initialize(); env.controller.selectMicrophone("usb");
    const earlier = deferred<readonly MediaDeviceInfoLike[]>();
    env.enumerateDevices.mockReturnValueOnce(earlier.promise);
    const change = env.addEventListener.mock.calls[0]?.[1];
    change?.(new Event("devicechange")); change?.(new Event("devicechange"));
    await new Promise(resolve => setTimeout(resolve, 0));
    earlier.resolve([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(env.callbacks.onMicrophonesChange).toHaveBeenLastCalledWith(expect.any(Array), "usb");
    expect(env.callbacks.onWarning).not.toHaveBeenCalled();
    env.controller.dispose();
  });

  it("discards a late transcription after cancel, then permits a new result", async () => {
    const env = setup(); await env.controller.initialize();
    const pending = deferred<TranscriptionResponse>(); env.transcribe.mockReturnValueOnce(pending.promise);
    const old = await env.start(); old.emit("old"); env.controller.toggle(); old.finish();
    const signal = env.transcribe.mock.calls[0]?.[1] as AbortSignal;
    env.controller.cancel();
    const current = await env.start(); current.emit("new"); env.controller.toggle(); current.finish();
    await vi.waitFor(() => expect(env.callbacks.onTranscript).toHaveBeenCalledOnce());
    pending.resolve({ ...RESULT, text: "obsolete" });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(signal.aborted).toBe(true);
    expect(env.callbacks.onTranscript).toHaveBeenCalledExactlyOnceWith(RESULT.text);
    env.controller.dispose();
  });

  it("discards silence and ignores old voice-activity callbacks after re-recording", async () => {
    const env = setup(); await env.controller.initialize(); await env.start();
    const old = env.monitorCallbacks[0]!;
    old.onNoSpeech();
    expect(env.transcribe).not.toHaveBeenCalled();
    await env.start();
    old.onSpeechEnd(); old.onNoSpeech(); old.onSpeechStart();
    expect(env.callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "recording" }));
    expect(env.tracks[1]?.stop).not.toHaveBeenCalled();
    env.controller.dispose();
  });
});
