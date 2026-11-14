import { afterEach, expect, it, vi } from "vitest";
import { BrowserVoiceActivityMonitor, VoiceActivityDetector } from "./VoiceActivityMonitor";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const frames: FrameRequestCallback[] = [];
  const contexts: FakeContext[] = [];
  class FakeContext {
    state = "running";
    source = { connect: vi.fn(), disconnect: vi.fn() };
    close = vi.fn(async () => { this.state = "closed"; });
    resume = vi.fn(async () => undefined);
    createAnalyser = vi.fn(() => ({ fftSize: 1024, getFloatTimeDomainData: (data: Float32Array) => data.fill(0.1) }));
    createMediaStreamSource = vi.fn(() => this.source);
    constructor() { contexts.push(this); }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  const requestFrame = vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const callbacks = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn(), onNoSpeech: vi.fn() };
  const monitor = new BrowserVoiceActivityMonitor(new VoiceActivityDetector({ minimumSpeechMs: 0 }));
  return { frames, contexts, FakeContext, callbacks, monitor, requestFrame };
}

it("ignores an already queued sample after stop and restart", () => {
  const env = setup();
  env.monitor.start({} as MediaStream, env.callbacks);
  const old = env.frames[0]!;
  env.monitor.stop(); env.monitor.start({} as MediaStream, env.callbacks);
  old(performance.now());
  expect(env.callbacks.onSpeechStart).not.toHaveBeenCalled();
  expect(env.requestFrame).toHaveBeenCalledTimes(2);
  expect(env.contexts[1]?.close).not.toHaveBeenCalled();
  env.monitor.stop();
});

it("does not schedule another sample when a callback stops the monitor", () => {
  const env = setup();
  env.callbacks.onSpeechStart.mockImplementation(() => env.monitor.stop());
  env.monitor.start({} as MediaStream, env.callbacks);
  env.frames[0]?.(performance.now());
  expect(env.callbacks.onSpeechStart).toHaveBeenCalledOnce();
  expect(env.requestFrame).toHaveBeenCalledOnce();
  expect(env.contexts[0]?.close).toHaveBeenCalledOnce();
});

it.each(["source", "connect"] as const)("releases the context when %s initialization fails", (stage) => {
  const env = setup();
  class FailingContext extends env.FakeContext {
    constructor() {
      super();
      if (stage === "source") this.createMediaStreamSource.mockImplementation(() => { throw new Error("source failed"); });
      else this.source.connect.mockImplementation(() => { throw new Error("connect failed"); });
    }
  }
  vi.stubGlobal("AudioContext", FailingContext);
  expect(() => env.monitor.start({} as MediaStream, env.callbacks)).toThrow();
  expect(env.contexts[0]?.close).toHaveBeenCalledOnce();
  if (stage === "connect") expect(env.contexts[0]?.source.disconnect).toHaveBeenCalledOnce();
  expect(env.requestFrame).not.toHaveBeenCalled();
  env.monitor.stop();
  expect(env.contexts[0]?.close).toHaveBeenCalledOnce();
});
