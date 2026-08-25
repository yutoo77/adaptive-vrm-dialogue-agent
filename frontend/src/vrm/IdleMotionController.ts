import type { IdleMotionFrame, MotionPreset } from "../types/character";

type RandomSource = () => number;

export class IdleMotionController {
  private elapsed = 0;
  private nextBlinkAt = 2.8;
  private blinkStartedAt: number | null = null;
  private reducedMotion = false;
  private continuityScale = 1;

  public constructor(private readonly random: RandomSource = Math.random) {
    this.scheduleNextBlink();
  }

  public setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  public setContinuityScale(scale: number): void {
    this.continuityScale = Math.max(0.4, Math.min(1.2, scale));
  }

  public reset(): void {
    this.elapsed = 0;
    this.blinkStartedAt = null;
    this.scheduleNextBlink();
  }

  public update(delta: number, preset: MotionPreset): IdleMotionFrame {
    this.elapsed += Math.max(0, delta) * preset.speed;
    const motionFactor = (this.reducedMotion ? 0.18 : 1) * this.continuityScale;
    const blinkWeight = this.updateBlink(preset.blink);

    const breathOffset = Math.sin(this.elapsed * 1.55) * 0.0065 * preset.breath * motionFactor;
    const swayAngle =
      (Math.sin(this.elapsed * 0.47) * 0.006 + Math.sin(this.elapsed * 0.21 + 0.8) * 0.003) *
      preset.sway *
      motionFactor;
    const bounceOffset =
      Math.max(0, Math.sin(this.elapsed * 2.2)) * 0.0035 * preset.bounce * motionFactor;

    return { breathOffset, swayAngle, bounceOffset, blinkWeight };
  }

  private updateBlink(blinkIntensity: number): number {
    if (this.blinkStartedAt === null && this.elapsed >= this.nextBlinkAt) {
      this.blinkStartedAt = this.elapsed;
    }

    if (this.blinkStartedAt === null) return 0;

    const duration = 0.17;
    const progress = (this.elapsed - this.blinkStartedAt) / duration;
    if (progress >= 1) {
      this.blinkStartedAt = null;
      this.scheduleNextBlink();
      return 0;
    }

    return Math.sin(Math.PI * progress) * blinkIntensity;
  }

  private scheduleNextBlink(): void {
    const interval = 2.4 + this.random() * 3.3;
    this.nextBlinkAt = this.elapsed + interval;
  }
}
