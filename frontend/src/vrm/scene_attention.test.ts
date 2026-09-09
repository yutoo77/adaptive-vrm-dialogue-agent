import { describe, expect, it } from "vitest";
import { GazeMotionController } from "./GazeMotionController";

describe("bounded scene attention", () => {
  it("looks toward the selected object briefly, then releases without a jump", () => {
    const gaze = new GazeMotionController(() => .5);
    gaze.setAttention({ x: -99, y: 99 });
    let frame = gaze.update(.05);
    expect(frame.offsetX).toBeLessThan(0);
    for (let index = 0; index < 50; index++) frame = gaze.update(.05);
    expect(frame.offsetX).toBeGreaterThanOrEqual(-.35);
    expect(frame.offsetY).toBeLessThanOrEqual(.25);
    for (let index = 0; index < 160; index++) frame = gaze.update(.05);
    expect(Math.abs(frame.offsetX)).toBeLessThan(.005);
    expect(Math.abs(frame.offsetY)).toBeLessThan(.005);
  });
  it("clears attention on mode reset and respects reduced motion", () => {
    const gaze = new GazeMotionController(() => .5);
    gaze.setAttention({ x: -.3, y: .2 });
    gaze.setReducedMotion(true);
    let frame = gaze.update(1);
    expect(Math.abs(frame.offsetX)).toBeLessThan(.06);
    gaze.reset();
    frame = gaze.update(.1);
    expect(frame).toEqual({ offsetX: 0, offsetY: 0 });
    gaze.setAttention({ x: NaN, y: Infinity });
    expect(gaze.update(.1)).toEqual({ offsetX: 0, offsetY: 0 });
  });
});
