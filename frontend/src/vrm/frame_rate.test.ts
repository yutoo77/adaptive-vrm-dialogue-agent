import { describe, expect, it } from "vitest";
import { FrameRateMeter } from "./FrameRateMeter";

describe("wall-time frame rate", () => {
  it("reports a slow renderer honestly rather than flooring it at 20 FPS", () => {
    const meter = new FrameRateMeter();
    expect(meter.sample(0)).toBeNull();
    expect(meter.sample(500)).toBeNull();
    expect(meter.sample(1000)).toBe(2);
  });

  it("measures a normal 60 FPS stream over the sampling window", () => {
    const meter = new FrameRateMeter();
    meter.sample(0);
    let result: number | null = null;
    for (let frame = 1; frame <= 45; frame++) result = meter.sample(frame * 1000 / 60);
    expect(result).toBe(60);
  });

  it("does not include hidden-tab time after reset", () => {
    const meter = new FrameRateMeter();
    meter.sample(0);
    meter.sample(500);
    meter.reset();
    expect(meter.sample(90_000)).toBeNull();
    expect(meter.sample(90_500)).toBeNull();
    expect(meter.sample(91_000)).toBe(2);
  });

  it("handles invalid, repeated, or backwards timestamps without an infinite rate", () => {
    const meter = new FrameRateMeter();
    for (const timestamp of [Number.NaN, Infinity, 1000, 1000, 500, 750]) {
      expect(meter.sample(timestamp)).toBeNull();
    }
    expect(meter.sample(1250)).toBe(3);
  });
});
