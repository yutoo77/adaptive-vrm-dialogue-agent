import { describe, expect, it, vi } from "vitest";

import {
  CHARACTER_STATES,
  DEFAULT_CAMERA_SETTINGS,
  PERFORMANCE_PREVIEW_INTENSITIES,
  createPerformancePreviewPlan,
  isPerformancePlan,
  isCharacterState,
  performanceEmotionToState,
  resolveReducedMotion,
  type CharacterStatePreset,
} from "../types/character";
import { clampCameraSettings } from "../utils/math";
import { VRMHumanBoneName } from "@pixiv/three-vrm";

import { CharacterController, NEUTRAL_UPPER_ARM_ROLLS } from "./CharacterController";
import { CHARACTER_STATE_PRESETS, getCharacterStatePreset } from "./CharacterStatePresets";
import { IdleMotionController } from "./IdleMotionController";
import { GazeMotionController } from "./GazeMotionController";
import { PerformanceMotionController } from "./PerformanceMotionController";
import {
  performanceLingerMs,
  PerformanceTimelineController,
  snapPerformanceCueTimeMs,
} from "./PerformanceTimelineController";
import {
  resolveBlinkExpressions,
  resolveExpressionCandidate,
  resolveLipSyncExpression,
  resolveLipSyncExpressions,
  resolveStateExpression,
} from "./expressionMapping";

describe("character state", () => {
  it("accepts only the defined state names", () => {
    CHARACTER_STATES.forEach((state) => expect(isCharacterState(state)).toBe(true));
    expect(isCharacterState("speaking")).toBe(true);
    expect(isCharacterState(null)).toBe(false);
  });

  it("returns a complete preset for every state", () => {
    CHARACTER_STATES.forEach((state) => {
      const preset = getCharacterStatePreset(state);
      expect(preset.state).toBe(state);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.motion.speed).toBeGreaterThan(0);
    });
  });

  it("falls back to idle if hot reload temporarily exposes a stale state", () => {
    expect(getCharacterStatePreset("future-state" as CharacterStatePreset["state"])).toBe(
      CHARACTER_STATE_PRESETS.idle,
    );
  });

  it("keeps state transitions centralized and rejects unknown external values", () => {
    const changes: string[] = [];
    const controller = new CharacterController({ onStateChange: (state) => changes.push(state) });

    expect(controller.setStateFromUnknown("thinking")).toBe(true);
    expect(controller.getState()).toBe("thinking");
    expect(changes).toEqual(["thinking"]);
    expect(controller.setStateFromUnknown("unsupported")).toBe(false);
    expect(controller.getState()).toBe("thinking");
  });

  it("maps only bounded performance emotions to existing character states", () => {
    expect(performanceEmotionToState("neutral")).toBe("explaining");
    expect(performanceEmotionToState("happy")).toBe("happy");
    expect(
      isPerformancePlan({
        emotion: "happy",
        intensity: 0.6,
        gesture: "small_nod",
        voice_style: "bright",
        cues: [],
      }),
    ).toBe(true);
    expect(
      isPerformancePlan({
        emotion: "angry",
        intensity: 2,
        gesture: "arbitrary_command",
        voice_style: "bright",
        cues: [],
      }),
    ).toBe(false);
  });

  it("creates bounded developer previews at the three documented strengths", () => {
    expect(PERFORMANCE_PREVIEW_INTENSITIES).toEqual({ weak: 0.3, medium: 0.6, strong: 0.9 });
    expect(createPerformancePreviewPlan("happy", "soft_bounce", 0.9)).toEqual({
      emotion: "happy",
      intensity: 0.9,
      gesture: "soft_bounce",
      voice_style: "bright",
      cues: [],
    });
    expect(createPerformancePreviewPlan("cautious", "small_nod", 9).intensity).toBe(1);
  });

  it("keeps system reduced-motion as the default while allowing temporary developer comparison", () => {
    expect(resolveReducedMotion("system", true)).toBe(true);
    expect(resolveReducedMotion("system", false)).toBe(false);
    expect(resolveReducedMotion("normal", true)).toBe(false);
    expect(resolveReducedMotion("reduced", false)).toBe(true);
  });

  it("uses a mirrored neutral arm pose instead of leaving VRM 1.0 models in a T-pose", () => {
    const left = NEUTRAL_UPPER_ARM_ROLLS[VRMHumanBoneName.LeftUpperArm];
    const right = NEUTRAL_UPPER_ARM_ROLLS[VRMHumanBoneName.RightUpperArm];

    expect(left).toBeCloseTo(-right);
    expect(left).toBeLessThan(-Math.PI / 3);
    expect(left).toBeGreaterThan(-Math.PI / 2);
  });
});

describe("expression mapping", () => {
  it("selects the first available candidate without changing its actual case", () => {
    const result = resolveExpressionCandidate(
      ["Neutral", "Relaxed", "Happy"],
      [
        { name: "missing", weight: 0.8 },
        { name: "happy", weight: 0.6 },
      ],
    );
    expect(result).toEqual({ name: "Happy", weight: 0.6 });
  });

  it("falls back to a later expression and safely returns null when none exist", () => {
    const gentle = getCharacterStatePreset("gentle");
    expect(resolveStateExpression(["neutral"], gentle)).toEqual({ name: "neutral", weight: 1 });
    expect(resolveStateExpression([], gentle)).toBeNull();
  });

  it("supports single and split blink expressions", () => {
    expect(resolveBlinkExpressions(["blink", "happy"])).toEqual(["blink"]);
    expect(resolveBlinkExpressions(["BlinkLeft", "BlinkRight"])).toEqual(["BlinkLeft", "BlinkRight"]);
    expect(resolveBlinkExpressions(["neutral"])).toEqual([]);
  });

  it("selects a case-preserving mouth expression for lip sync", () => {
    expect(resolveLipSyncExpression(["neutral", "AA", "ih"])).toBe("AA");
    expect(resolveLipSyncExpression(["neutral"])).toBeNull();
    expect(resolveLipSyncExpressions(["AA", "ih", "ou", "ee", "oh"])).toEqual({
      a: "AA",
      i: "ih",
      u: "ou",
      e: "ee",
      o: "oh",
    });
  });
});

describe("configuration limits", () => {
  it("clamps camera settings to safe ranges", () => {
    expect(
      clampCameraSettings({ distance: 9, heightOffset: -9, lookAtOffset: 2, modelOffset: -2, scale: 0 }),
    ).toEqual({ distance: 1.8, heightOffset: -0.5, lookAtOffset: 0.4, modelOffset: -0.6, scale: 0.65 });
    expect(clampCameraSettings(DEFAULT_CAMERA_SETTINGS)).toEqual(DEFAULT_CAMERA_SETTINGS);
  });
});

describe("idle motion", () => {
  const idlePreset: CharacterStatePreset = CHARACTER_STATE_PRESETS.idle;

  it("creates a blink with a non-fixed interval and returns to open eyes", () => {
    const controller = new IdleMotionController(() => 0);
    controller.update(2.41, idlePreset.motion);
    const middle = controller.update(0.085, idlePreset.motion);
    const finished = controller.update(0.1, idlePreset.motion);

    expect(middle.blinkWeight).toBeGreaterThan(0.9);
    expect(finished.blinkWeight).toBe(0);
  });

  it("reduces body motion when reduced-motion is active", () => {
    const normal = new IdleMotionController(() => 0.5);
    const reduced = new IdleMotionController(() => 0.5);
    reduced.setReducedMotion(true);

    const normalFrame = normal.update(0.8, idlePreset.motion);
    const reducedFrame = reduced.update(0.8, idlePreset.motion);
    expect(Math.abs(reducedFrame.breathOffset)).toBeLessThan(Math.abs(normalFrame.breathOffset));
    expect(Math.abs(reducedFrame.swayAngle)).toBeLessThan(Math.abs(normalFrame.swayAngle));
  });

  it("applies the bounded emotional continuity scale to idle motion", () => {
    const normal = new IdleMotionController(() => 0.5);
    const subdued = new IdleMotionController(() => 0.5);
    subdued.setContinuityScale(0.5);

    const normalFrame = normal.update(0.8, idlePreset.motion);
    const subduedFrame = subdued.update(0.8, idlePreset.motion);
    expect(Math.abs(subduedFrame.breathOffset)).toBeLessThan(Math.abs(normalFrame.breathOffset));
    expect(Math.abs(subduedFrame.swayAngle)).toBeLessThan(Math.abs(normalFrame.swayAngle));
  });
});

describe("gaze motion", () => {
  it("changes gaze on a bounded emotional rhythm and eases toward the target", () => {
    const values = [0, 1, 0.75, 0.25];
    const gaze = new GazeMotionController(() => values.shift() ?? 0.5);
    gaze.setBehavior("curious", 0.8);

    const before = gaze.update(1);
    const after = gaze.update(3.2);

    expect(before.offsetX).toBe(0);
    expect(before.offsetY).toBeGreaterThan(0);
    expect(Math.abs(after.offsetX)).toBeGreaterThan(0);
    expect(Math.abs(after.offsetX)).toBeLessThanOrEqual(0.22);
    expect(Math.abs(after.offsetY)).toBeLessThanOrEqual(0.15);
  });

  it("subdues ambient gaze when reduced motion is active", () => {
    const normal = new GazeMotionController(() => 0);
    const reduced = new GazeMotionController(() => 0);
    normal.setBehavior("responsive", 1);
    reduced.setBehavior("responsive", 1);
    reduced.setReducedMotion(true);

    const normalFrame = normal.update(6);
    const reducedFrame = reduced.update(6);
    expect(Math.abs(reducedFrame.offsetX)).toBeLessThan(Math.abs(normalFrame.offsetX));
  });
});

describe("performance motion", () => {
  it("plays a one-shot nod and returns to a neutral overlay", () => {
    const controller = new PerformanceMotionController();
    controller.start("small_nod", 0.8);

    const moving = controller.update(0.2);
    controller.update(1);
    const finished = controller.update(0.1);

    expect(Math.abs(moving.headPitchOffset)).toBeGreaterThan(0);
    expect(finished).toEqual({ headPitchOffset: 0, headRollOffset: 0, rootOffset: 0 });
  });

  it("reduces gesture amplitude for reduced-motion users", () => {
    const normal = new PerformanceMotionController();
    const reduced = new PerformanceMotionController();
    normal.start("head_tilt", 1);
    reduced.start("head_tilt", 1);
    reduced.setReducedMotion(true);

    expect(Math.abs(reduced.update(0.4).headRollOffset)).toBeLessThan(
      Math.abs(normal.update(0.4).headRollOffset),
    );
  });
});

describe("performance timeline", () => {
  const plan = {
    emotion: "happy",
    intensity: 0.6,
    gesture: "small_nod",
    voice_style: "bright",
    cues: [
      { at: 0.3, gesture: "small_nod", intensity: 0.4 },
      { at: 0.65, gesture: "head_tilt", intensity: 0.35 },
    ],
  } as const;

  it("prepares the expression first and starts the one-shot gesture only when audio starts", () => {
    const preparePerformance = vi.fn();
    const playGesture = vi.fn();
    const returnToBaseline = vi.fn();
    const timeline = new PerformanceTimelineController({ preparePerformance, playGesture, returnToBaseline });

    timeline.prepare(plan);
    expect(preparePerformance).toHaveBeenCalledOnce();
    expect(playGesture).not.toHaveBeenCalled();

    timeline.handlePlayback({ type: "started", durationMs: 4_000, phraseBoundariesMs: [] });
    expect(preparePerformance).toHaveBeenCalledTimes(2);
    expect(playGesture).toHaveBeenCalledWith("small_nod", 0.6);
    expect(returnToBaseline).not.toHaveBeenCalled();
  });

  it("keeps a short post-speech linger and returns immediately for stop or failure", () => {
    vi.useFakeTimers();
    try {
      const returnToBaseline = vi.fn();
      const timeline = new PerformanceTimelineController({
        preparePerformance: vi.fn(),
        playGesture: vi.fn(),
        returnToBaseline,
      });
      timeline.prepare(plan);
      timeline.handlePlayback({ type: "completed" });
      vi.advanceTimersByTime(performanceLingerMs(plan) - 1);
      expect(returnToBaseline).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(returnToBaseline).toHaveBeenCalledOnce();

      timeline.handlePlayback({ type: "stopped" });
      timeline.handlePlayback({ type: "failed" });
      expect(returnToBaseline).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays bounded mid-speech cues from audio duration and cancels pending cues on stop", () => {
    vi.useFakeTimers();
    try {
      const playGesture = vi.fn();
      const reportPhase = vi.fn();
      const timeline = new PerformanceTimelineController({
        preparePerformance: vi.fn(),
        playGesture,
        returnToBaseline: vi.fn(),
        reportPhase,
      });
      timeline.prepare(plan);
      timeline.handlePlayback({ type: "started", durationMs: 4_000, phraseBoundariesMs: [] });
      expect(playGesture).toHaveBeenLastCalledWith("small_nod", 0.6);

      vi.advanceTimersByTime(1_200);
      expect(playGesture).toHaveBeenLastCalledWith("small_nod", 0.4);
      expect(reportPhase).toHaveBeenLastCalledWith("cue", 1, 2);

      timeline.handlePlayback({ type: "stopped" });
      vi.advanceTimersByTime(4_000);
      expect(playGesture).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("snaps a cue to a nearby VOICEVOX phrase boundary but ignores distant boundaries", () => {
    expect(snapPerformanceCueTimeMs(2_400, 4_000, [1_200, 2_550])).toBe(2_550);
    expect(snapPerformanceCueTimeMs(2_400, 4_000, [900])).toBe(2_400);
  });
});
