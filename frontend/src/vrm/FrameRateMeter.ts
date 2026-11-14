/** Measures rendered frames using wall time, independent of animation's delta clamp. */
export class FrameRateMeter {
  private previousTimestamp: number | null = null;
  private frames = 0;
  private elapsedMs = 0;

  public sample(timestamp: number): number | null {
    if (!Number.isFinite(timestamp)) return null;
    const previous = this.previousTimestamp;
    this.previousTimestamp = timestamp;
    if (previous === null || timestamp <= previous) {
      this.frames = 0;
      this.elapsedMs = 0;
      return null;
    }
    this.frames += 1;
    this.elapsedMs += timestamp - previous;
    if (this.elapsedMs < 750) return null;
    const fps = Math.round(this.frames * 1000 / this.elapsedMs);
    this.frames = 0;
    this.elapsedMs = 0;
    return fps;
  }

  public reset(): void {
    this.previousTimestamp = null;
    this.frames = 0;
    this.elapsedMs = 0;
  }
}
