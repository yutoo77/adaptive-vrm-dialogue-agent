import { describe, expect, it } from "vitest";

import {
  CHARACTER_STATES,
  DEFAULT_CAMERA_SETTINGS,
  isCharacterState,
  type CharacterStatePreset,
} from "../types/character";
import { clampCameraSettings } from "../utils/math";
import { CharacterController } from "./CharacterController";
import { CHARACTER_STATE_PRESETS, getCharacterStatePreset } from "./CharacterStatePresets";
import { IdleMotionController } from "./IdleMotionController";
import { resolveBlinkExpressions, resolveExpressionCandidate, resolveStateExpression } from "./expressionMapping";

describe("character state", () => {
  it("accepts only the defined state names", () => {
    CHARACTER_STATES.forEach((state) => expect(isCharacterState(state)).toBe(true));
    expect(isCharacterState("speaking")).toBe(false);
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

  it("keeps state transitions centralized and rejects unknown external values", () => {
    const changes: string[] = [];
    const controller = new CharacterController({ onStateChange: (state) => changes.push(state) });

    expect(controller.setStateFromUnknown("thinking")).toBe(true);
    expect(controller.getState()).toBe("thinking");
    expect(changes).toEqual(["thinking"]);
    expect(controller.setStateFromUnknown("unsupported")).toBe(false);
    expect(controller.getState()).toBe("thinking");
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
});
