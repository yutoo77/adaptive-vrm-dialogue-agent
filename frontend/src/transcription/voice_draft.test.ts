import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceDraft } from "./VoiceDraft";

class FakeInput extends EventTarget {
  value = "";
  maxLength = 500;
  validationMessage = "";
  selectionStart = 0;
  selectionEnd = 0;
  selectionDirection: "forward" | "backward" | "none" = "none";
  ownerDocument: { activeElement: FakeInput | null } = { activeElement: null };
  setCustomValidity(message: string) { this.validationMessage = message; }
  setSelectionRange = vi.fn();
}

function setup(value = "") {
  const input = new FakeInput(); input.value = value;
  const controller = new AbortController();
  const changed = vi.fn();
  const draft = new VoiceDraft(input as unknown as HTMLTextAreaElement, changed, controller.signal);
  return { input, controller, changed, draft };
}

afterEach(() => vi.useRealTimers());

describe("voice draft preservation", () => {
  it.each([
    ["", "声", "声"],
    ["下書き", "声", "下書き\n声"],
    ["下書き\n", "声", "下書き\n声"],
    ["  下書き  ", " 声 ", "  下書き  \n 声 "],
  ])("appends without altering existing text: %j", (before, transcript, expected) => {
    const { input, draft, changed } = setup(before);
    draft.append(transcript);
    expect(input.value).toBe(expected);
    expect(changed).toHaveBeenCalledOnce();
    expect(input.setSelectionRange).not.toHaveBeenCalled();
  });

  it("keeps the active selection and successive dictations", () => {
    const { input, draft } = setup("直している文");
    input.ownerDocument.activeElement = input;
    input.selectionStart = 1; input.selectionEnd = 3; input.selectionDirection = "backward";
    draft.append("一つ目"); draft.append("二つ目");
    expect(input.value).toBe("直している文\n一つ目\n二つ目");
    expect(input.setSelectionRange).toHaveBeenLastCalledWith(1, 3, "backward");
  });

  it("waits for the final IME input event, preserving edits and transcript order", () => {
    vi.useFakeTimers();
    const { input, draft, changed } = setup("へんかん");
    input.dispatchEvent(new Event("compositionstart"));
    draft.append("一つ目"); draft.append("二つ目");
    expect(input.value).toBe("へんかん");
    expect(input.validationMessage).toContain("確定");
    input.dispatchEvent(new Event("compositionend"));
    input.value = "変換確定";
    input.dispatchEvent(new Event("input"));
    expect(changed).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(input.value).toBe("変換確定\n一つ目\n二つ目");
    expect(input.validationMessage).toBe("");
    expect(changed).toHaveBeenCalledOnce();
  });

  it("waits again if another composition starts before the scheduled append", () => {
    vi.useFakeTimers();
    const { input, draft } = setup("下書き");
    input.dispatchEvent(new Event("compositionstart")); draft.append("声");
    input.dispatchEvent(new Event("compositionend"));
    input.dispatchEvent(new Event("compositionstart")); vi.runAllTimers();
    expect(input.value).toBe("下書き");
    input.dispatchEvent(new Event("compositionend")); vi.runAllTimers();
    expect(input.value).toBe("下書き\n声");
  });

  it.each(["pending", "scheduled"])("cancels %s IME results at a workspace boundary", stage => {
    vi.useFakeTimers();
    const { input, draft, changed } = setup("残す");
    input.dispatchEvent(new Event("compositionstart")); draft.append("古い声");
    if (stage === "scheduled") input.dispatchEvent(new Event("compositionend"));
    draft.cancelPending();
    input.dispatchEvent(new Event("compositionend")); vi.runAllTimers();
    expect(input.value).toBe("残す");
    expect(input.validationMessage).toBe("");
    expect(changed).not.toHaveBeenCalled();
  });

  it("disposal discards pending work and ignores future transcripts", () => {
    vi.useFakeTimers();
    const { input, draft, controller, changed } = setup("残す");
    input.dispatchEvent(new Event("compositionstart")); draft.append("古い声");
    input.dispatchEvent(new Event("compositionend")); controller.abort();
    vi.runAllTimers(); draft.append("さらに古い声");
    expect(input.value).toBe("残す");
    expect(changed).not.toHaveBeenCalled();
  });

  it("retains all over-limit text including emoji and clears validation after editing", () => {
    const { input, draft } = setup("文".repeat(500));
    draft.append("🌙");
    expect(input.value).toBe("文".repeat(500) + "\n🌙");
    expect(input.validationMessage).toContain("500文字以内");
    input.value = "短く修正🌙";
    input.dispatchEvent(new Event("input"));
    expect(input.validationMessage).toBe("");
  });

  it("accepts an exact-limit draft and ignores blank recognition", () => {
    const { input, draft, changed } = setup("文".repeat(498));
    draft.append("声"); draft.append("  \n");
    expect(input.value.length).toBe(500);
    expect(input.validationMessage).toBe("");
    expect(changed).toHaveBeenCalledOnce();
  });
});
