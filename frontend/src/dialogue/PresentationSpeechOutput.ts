import type { SpeechOutput } from "./DialogueController";

/** A mode switch permanently silences the old turn, even after switching back. */
export class PresentationSpeechOutput implements SpeechOutput {
  private turnAllowed = true;

  public constructor(private readonly output: SpeechOutput, private readonly isVisible: () => boolean) {}
  public beginTurn(): void { this.turnAllowed = true; }
  public suspend(): void { this.turnAllowed = false; this.output.stop(); }
  public speak: SpeechOutput["speak"] = (...args) => {
    if (this.isVisible() && this.turnAllowed) this.output.speak(...args);
  };
  public beginStreaming: NonNullable<SpeechOutput["beginStreaming"]> = (...args) => {
    if (this.isVisible() && this.turnAllowed) this.output.beginStreaming?.(...args);
  };
  public appendStreamingText: NonNullable<SpeechOutput["appendStreamingText"]> = (...args) => {
    if (this.isVisible() && this.turnAllowed) this.output.appendStreamingText?.(...args);
  };
  public completeStreaming: NonNullable<SpeechOutput["completeStreaming"]> = (...args) => {
    if (this.isVisible() && this.turnAllowed) this.output.completeStreaming?.(...args);
  };
  public toggle(): void { if (this.isVisible()) this.output.toggle(); }
  public stop(): void { this.output.stop(); }
  public discard(): void { this.output.discard?.(); }
  public dispose(): void { this.output.dispose(); }
}
