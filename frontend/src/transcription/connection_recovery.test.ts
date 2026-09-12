import { afterEach, describe, expect, it, vi } from "vitest";
import { PushToTalkController, type MediaDeviceInfoLike, type TranscriptionGateway, type VoiceInputCallbacks } from "./PushToTalkController";
import { TranscriptionApiError, TranscriptionClient } from "./TranscriptionClient";
import type { TranscriptionHealth } from "./types";

const HEALTH: TranscriptionHealth = {
  status: "ready", provider: "faster-whisper", model: "small", device: "cpu", compute_type: "int8", message: "ready",
};

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function setup() {
  vi.stubGlobal("MediaRecorder", class {});
  const getHealth = vi.fn<TranscriptionGateway["getHealth"]>().mockResolvedValue(HEALTH);
  const getUserMedia = vi.fn();
  const callbacks: VoiceInputCallbacks = {
    onStatusChange: vi.fn(), onTranscript: vi.fn(), onCharacterState: vi.fn(),
    onMicrophonesChange: vi.fn(), onBeforeRecording: vi.fn(), onWarning: vi.fn(),
  };
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const enumerateDevices = vi.fn<() => Promise<readonly MediaDeviceInfoLike[]>>().mockResolvedValue([]);
  const controller = new PushToTalkController({ getHealth, transcribe: vi.fn() }, callbacks, {
    getUserMedia, addEventListener, removeEventListener, enumerateDevices,
  });
  return { controller, getHealth, getUserMedia, callbacks, addEventListener, removeEventListener, enumerateDevices };
}

describe("health request recovery", () => {
  it("retries one transient malformed response and asks for uncached health only", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<html>starting</html>"))
      .mockResolvedValueOnce(new Response(JSON.stringify(HEALTH)));
    const pending = expect(new TranscriptionClient(fetcher).getHealth()).resolves.toEqual(HEALTH);
    await vi.advanceTimersByTimeAsync(400);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("/api/transcription/health", expect.objectContaining({
      method: "GET", cache: "no-store",
    }));
  });

  it("bounds automatic retries and identifies invalid health without revealing its payload", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"private":"do-not-display"}'));
    const outcome = new TranscriptionClient(fetcher).getHealth().catch(error => error);
    await vi.advanceTimersByTimeAsync(1_000);
    const error: unknown = await outcome;
    expect(error).toMatchObject({ code: "client_invalid_health" });
    expect(String(error)).not.toContain("do-not-display");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent 4xx or an audio upload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}", { status: 403 }));
    await expect(new TranscriptionClient(fetcher).getHealth()).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValue(new TypeError("offline"));
    await expect(new TranscriptionClient(fetcher).transcribe(new Blob(["test"]))).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never sends an already cancelled request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(HEALTH)));
    const controller = new AbortController();
    controller.abort();
    await expect(new TranscriptionClient(fetcher).getHealth(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports body-read timeouts as timeouts, not malformed health", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const response = new Response("{}", { status: 200 });
      vi.spyOn(response, "json").mockImplementation(() => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("body cancelled", "AbortError")), { once: true });
      }));
      return response;
    });
    const outcome = new TranscriptionClient(fetcher).getHealth().catch(error => error);
    await vi.advanceTimersByTimeAsync(10_400);
    expect(await outcome).toMatchObject({ status: 504, code: "client_timeout" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the retry delay without a second request", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    const controller = new AbortController();
    const outcome = new TranscriptionClient(fetcher).getHealth(controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("microphone readiness cannot be bypassed", () => {
  it("recovers through an explicit retry without recording or losing a draft", async () => {
    const { controller, getHealth, getUserMedia, callbacks, addEventListener } = setup();
    getHealth.mockRejectedValueOnce(new TranscriptionApiError("offline"));
    await controller.initialize();
    expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "unavailable", action: "retry" }));
    controller.toggle();
    await vi.waitFor(() => expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "idle", action: "start" })));
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onBeforeRecording).not.toHaveBeenCalled();
    expect(addEventListener).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("cannot enable recording by changing preferences before a successful health check", async () => {
    const { controller, getHealth, getUserMedia, callbacks } = setup();
    getHealth.mockRejectedValue(new TranscriptionApiError("offline"));
    await controller.initialize();
    controller.selectMicrophone("");
    controller.setAutoStop(false);
    expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "unavailable" }));
    controller.toggle();
    await vi.waitFor(() => expect(getHealth).toHaveBeenCalledTimes(2));
    expect(getUserMedia).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("coalesces repeated initialization and ignores health arriving after disposal", async () => {
    const { controller, getHealth, callbacks, removeEventListener } = setup();
    const pending = deferred<TranscriptionHealth>();
    getHealth.mockReturnValue(pending.promise);
    const first = controller.initialize();
    await controller.initialize();
    expect(getHealth).toHaveBeenCalledTimes(1);
    controller.dispose();
    const signal = getHealth.mock.calls[0]?.[0];
    expect(signal?.aborted).toBe(true);
    pending.resolve(HEALTH);
    await first;
    expect(callbacks.onStatusChange).not.toHaveBeenCalledWith(expect.objectContaining({ state: "idle" }));
    await controller.initialize();
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("does not suggest retry for a browser without microphone support", async () => {
    const { controller, getHealth, callbacks } = setup();
    vi.stubGlobal("MediaRecorder", undefined);
    await controller.initialize();
    expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "unavailable", action: "none" }));
    controller.toggle();
    expect(getHealth).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not publish delayed device enumeration after disposal", async () => {
    const { controller, enumerateDevices, callbacks } = setup();
    const pending = deferred<readonly MediaDeviceInfoLike[]>();
    enumerateDevices.mockReturnValue(pending.promise);
    const initialization = controller.initialize();
    await vi.waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(1));
    controller.dispose();
    pending.resolve([{ kind: "audioinput", deviceId: "late-device", label: "test microphone" }]);
    await initialization;
    expect(callbacks.onMicrophonesChange).not.toHaveBeenCalled();
  });

  it("keeps preferences from enabling a microphone while health is pending or cancelled", async () => {
    const { controller, getHealth, callbacks, getUserMedia } = setup();
    const pending = deferred<TranscriptionHealth>();
    getHealth.mockReturnValue(pending.promise);
    const initialization = controller.initialize();
    controller.selectMicrophone("");
    controller.setAutoStop(false);
    expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "checking", action: "none" }));
    controller.cancel();
    pending.resolve(HEALTH);
    await initialization;
    expect(callbacks.onStatusChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: "unavailable", action: "retry" }));
    expect(getUserMedia).not.toHaveBeenCalled();
    controller.dispose();
  });
});
