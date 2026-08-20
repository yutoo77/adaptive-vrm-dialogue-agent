import type { PerformanceGesture, PerformancePlan } from "../types/character";
import type { SpeechPlaybackEvent } from "../speech/SpeechController";

export type PerformanceTimelinePhase = "prepared" | "speaking" | "cue" | "lingering" | "idle";

export interface PerformanceTimelineOutput {
  readonly preparePerformance: (plan: PerformancePlan) => void;
  readonly playGesture: (gesture: PerformanceGesture, intensity: number) => void;
  readonly returnToIdle: () => void;
  readonly reportPhase?: (phase: PerformanceTimelinePhase, cueIndex?: number, cueTotal?: number) => void;
}

export class PerformanceTimelineController {
  private plan: PerformancePlan | null = null;
  private idleTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private cueTimers: ReturnType<typeof globalThis.setTimeout>[] = [];
  private disposed = false;

  public constructor(private readonly output: PerformanceTimelineOutput) {}

  public prepare(plan: PerformancePlan): void {
    if (this.disposed) return;
    this.clearIdleTimer();
    this.clearCueTimers();
    this.plan = plan;
    this.output.preparePerformance(plan);
    this.output.reportPhase?.("prepared");
  }

  public handlePlayback(event: SpeechPlaybackEvent): void {
    if (this.disposed) return;
    this.clearIdleTimer();

    if (event.type === "started") {
      if (this.plan) {
        this.output.preparePerformance(this.plan);
        this.output.playGesture(this.plan.gesture, this.plan.intensity);
        this.output.reportPhase?.("speaking");
        let previousCueTimeMs = 0;
        this.plan.cues.forEach((cue, index) => {
          const targetTimeMs = cue.at * event.durationMs;
          let cueTimeMs = snapPerformanceCueTimeMs(targetTimeMs, event.durationMs, event.phraseBoundariesMs);
          if (cueTimeMs - previousCueTimeMs < 120) cueTimeMs = targetTimeMs;
          previousCueTimeMs = cueTimeMs;
          const timer = globalThis.setTimeout(() => {
            this.cueTimers = this.cueTimers.filter((candidate) => candidate !== timer);
            if (this.disposed) return;
            this.output.playGesture(cue.gesture, cue.intensity);
            this.output.reportPhase?.("cue", index + 1, this.plan?.cues.length ?? 0);
          }, cueTimeMs);
          this.cueTimers.push(timer);
        });
      }
      return;
    }

    this.clearCueTimers();
    if (event.type === "completed") {
      this.output.reportPhase?.("lingering");
      const lingerMs = performanceLingerMs(this.plan);
      this.idleTimer = globalThis.setTimeout(() => {
        this.idleTimer = null;
        if (!this.disposed) {
          this.output.returnToIdle();
          this.output.reportPhase?.("idle");
        }
      }, lingerMs);
      return;
    }

    this.output.returnToIdle();
    this.output.reportPhase?.("idle");
  }

  public clear(): void {
    this.clearIdleTimer();
    this.clearCueTimers();
    this.plan = null;
  }

  public dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) globalThis.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearCueTimers(): void {
    this.cueTimers.forEach((timer) => globalThis.clearTimeout(timer));
    this.cueTimers = [];
  }
}

export function snapPerformanceCueTimeMs(
  targetTimeMs: number,
  durationMs: number,
  phraseBoundariesMs: readonly number[],
): number {
  if (!Number.isFinite(targetTimeMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const boundedTarget = Math.max(durationMs * 0.2, Math.min(durationMs * 0.82, targetTimeMs));
  const candidates = phraseBoundariesMs.filter(
    (boundary) =>
      Number.isFinite(boundary) && boundary >= durationMs * 0.2 && boundary <= durationMs * 0.82,
  );
  if (!candidates.length) return boundedTarget;
  const nearest = candidates.reduce((best, candidate) =>
    Math.abs(candidate - boundedTarget) < Math.abs(best - boundedTarget) ? candidate : best,
  );
  const maximumSnapDistance = Math.max(250, durationMs * 0.08);
  return Math.abs(nearest - boundedTarget) <= maximumSnapDistance ? nearest : boundedTarget;
}

export function performanceLingerMs(plan: PerformancePlan | null): number {
  if (!plan) return 520;
  const lingerByEmotion: Readonly<Record<PerformancePlan["emotion"], number>> = {
    neutral: 360,
    happy: 500,
    gentle: 680,
    curious: 540,
    cautious: 620,
    confused: 580,
  };
  return lingerByEmotion[plan.emotion];
}
