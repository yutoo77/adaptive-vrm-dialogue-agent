/** Appends dictation without replacing typed text or interrupting Japanese composition. */
export class VoiceDraft {
  private composing = false;
  private pending: string[] = [];
  private timer: number | null = null;

  public constructor(
    private readonly input: HTMLTextAreaElement,
    private readonly onChange: () => void,
    private readonly signal: AbortSignal,
  ) {
    input.addEventListener("compositionstart", () => { this.composing = true; }, { signal });
    input.addEventListener("compositionend", () => {
      this.composing = false;
      if (!this.pending.length) return;
      // The final input event may follow compositionend in the same browser task.
      this.timer = globalThis.setTimeout(() => { this.timer = null; this.flush(); }, 0);
    }, { signal });
    input.addEventListener("input", () => this.validate(), { signal });
    signal.addEventListener("abort", () => this.cancelPending(), { once: true });
  }

  public append(text: string): void {
    if (this.signal.aborted || !text.trim()) return;
    this.pending.push(text);
    this.validate();
    if (!this.composing && this.timer === null) this.flush();
  }

  public cancelPending(): void {
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    this.pending = [];
    this.validate();
  }

  public validate(): void {
    const max = this.input.maxLength;
    this.input.setCustomValidity(this.pending.length
      ? "文字入力を確定してから送信してください。"
      : max >= 0 && this.input.value.length > max
        ? `${max}文字以内に短くしてから送信してください。` : "");
  }

  private flush(): void {
    if (this.signal.aborted || this.composing || !this.pending.length) return;
    const { selectionStart, selectionEnd, selectionDirection } = this.input;
    const focused = this.input.ownerDocument.activeElement === this.input;
    const draft = this.input.value;
    const separator = draft && !draft.endsWith("\n") ? "\n" : "";
    this.input.value = draft + separator + this.pending.join("\n");
    this.pending = [];
    // Keep an ongoing edit's selection; never move focus out of another control.
    if (focused) this.input.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
    this.validate();
    this.onChange();
  }
}
