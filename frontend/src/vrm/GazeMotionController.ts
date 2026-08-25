import type { GazeBehavior } from "../types/character";
import { damp } from "../utils/math";

type RandomSource = () => number;

export interface GazeMotionFrame {
  readonly offsetX: number;
  readonly offsetY: number;
}

interface GazeBehaviorPreset {
  readonly intervalMin: number;
  readonly intervalRange: number;
  readonly amplitudeX: number;
  readonly amplitudeY: number;
  readonly biasY: number;
}

const GAZE_PRESETS: Readonly<Record<GazeBehavior, GazeBehaviorPreset>> = {
  responsive: { intervalMin: 2.8, intervalRange: 2.8, amplitudeX: 0.16, amplitudeY: 0.1, biasY: 0 },
  engaged: { intervalMin: 2.4, intervalRange: 2.2, amplitudeX: 0.11, amplitudeY: 0.07, biasY: 0.025 },
  soft: { intervalMin: 3.6, intervalRange: 3, amplitudeX: 0.09, amplitudeY: 0.055, biasY: -0.035 },
  curious: { intervalMin: 1.9, intervalRange: 2.1, amplitudeX: 0.22, amplitudeY: 0.11, biasY: 0.035 },
  steady: { intervalMin: 4.5, intervalRange: 3, amplitudeX: 0.055, amplitudeY: 0.04, biasY: -0.02 },
  searching: { intervalMin: 2.2, intervalRange: 2.2, amplitudeX: 0.2, amplitudeY: 0.1, biasY: 0 },
};

export class GazeMotionController {
  private behavior: GazeBehavior = "responsive";
  private intensity = 0.35;
  private elapsed = 0;
  private nextShiftAt = 0;
  private currentX = 0;
  private currentY = 0;
  private targetX = 0;
  private targetY = 0;
  private reducedMotion = false;

  public constructor(private readonly random: RandomSource = Math.random) {
    this.scheduleNextShift();
  }

  public setBehavior(behavior: GazeBehavior, intensity: number): void {
    this.behavior = behavior;
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.targetX = 0;
    this.targetY = GAZE_PRESETS[behavior].biasY * this.intensity;
    this.scheduleNextShift();
  }

  public setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  public reset(): void {
    this.behavior = "responsive";
    this.intensity = 0.35;
    this.elapsed = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.scheduleNextShift();
  }

  public update(delta: number): GazeMotionFrame {
    const elapsedDelta = Math.max(0, delta);
    this.elapsed += elapsedDelta;
    if (this.elapsed >= this.nextShiftAt) this.chooseNextTarget();

    const motionScale = this.reducedMotion ? 0.18 : 1;
    this.currentX = damp(this.currentX, this.targetX * motionScale, 2.6, elapsedDelta);
    this.currentY = damp(this.currentY, this.targetY * motionScale, 2.6, elapsedDelta);
    return { offsetX: this.currentX, offsetY: this.currentY };
  }

  private chooseNextTarget(): void {
    const preset = GAZE_PRESETS[this.behavior];
    const strength = 0.35 + this.intensity * 0.65;
    this.targetX = (this.random() * 2 - 1) * preset.amplitudeX * strength;
    this.targetY = preset.biasY * strength + (this.random() * 2 - 1) * preset.amplitudeY * strength;
    this.scheduleNextShift();
  }

  private scheduleNextShift(): void {
    const preset = GAZE_PRESETS[this.behavior];
    this.nextShiftAt = this.elapsed + preset.intervalMin + this.random() * preset.intervalRange;
  }
}
