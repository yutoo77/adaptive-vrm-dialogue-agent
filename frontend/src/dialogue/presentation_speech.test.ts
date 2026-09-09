import { describe, expect, it, vi } from "vitest";
import { PresentationSpeechOutput } from "./PresentationSpeechOutput";

describe("mode-separated speech", () => {
  it("does not resurrect a cancelled old turn after leaving and returning", () => {
    const output = { speak: vi.fn(), beginStreaming: vi.fn(), appendStreamingText: vi.fn(), completeStreaming: vi.fn(),
      stop: vi.fn(), toggle: vi.fn(), dispose: vi.fn(), discard: vi.fn() };
    let visible = true;
    const gate = new PresentationSpeechOutput(output, () => visible);
    gate.beginStreaming();
    gate.appendStreamingText("前の文。");
    gate.suspend();
    visible = false;
    gate.speak("遅れて届いた声");
    visible = true;
    gate.completeStreaming("取消と競合した確定応答。");
    gate.speak("通常モードに戻っても古い発話はしない");
    expect(output.completeStreaming).not.toHaveBeenCalled();
    expect(output.speak).not.toHaveBeenCalled();
    expect(output.stop).toHaveBeenCalledOnce();
    gate.toggle();
    expect(output.toggle).toHaveBeenCalledOnce();
    gate.beginTurn();
    gate.speak("新しい発話。");
    expect(output.speak).toHaveBeenCalledExactlyOnceWith("新しい発話。");
  });
});
