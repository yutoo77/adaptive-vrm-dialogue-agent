import type { PerformanceGesture, PerformanceMotionFrame } from "../types/character";

const EMPTY_FRAME: PerformanceMotionFrame = {
  headPitchOffset: 0,
  headRollOffset: 0,
  rootOffset: 0,
};

export class PerformanceMotionController {
  private gesture: PerformanceGesture = "none";
  private intensity = 0;
  private elapsed = 0;
  private reducedMotion = false;

  public start(gesture: PerformanceGesture, intensity: number): void {
    this.gesture = gesture;
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.elapsed = 0;
  }

  public reset(): void {
    this.start("none", 0);
  }

  public setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  public update(delta: number): PerformanceMotionFrame {
    if (this.gesture === "none") return EMPTY_FRAME;
    this.elapsed += Math.max(0, delta);
    const duration = this.gesture === "head_tilt" ? 1.2 : 0.85;
    const progress = Math.min(1, this.elapsed / duration);
    const scale = this.intensity * (this.reducedMotion ? 0.18 : 1);
    const envelope = Math.sin(Math.PI * progress);
    let frame = EMPTY_FRAME;

    if (this.gesture === "small_nod") {
      frame = {
        ...EMPTY_FRAME,
        headPitchOffset: Math.sin(Math.PI * 2 * progress) * 0.075 * scale,
      };
    } else if (this.gesture === "head_tilt") {
      frame = { ...EMPTY_FRAME, headRollOffset: -envelope * 0.11 * scale };
    } else if (this.gesture === "soft_bounce") {
      frame = { ...EMPTY_FRAME, rootOffset: envelope * 0.028 * scale };
    }

    if (progress >= 1) this.reset();
    return frame;
  }
}
