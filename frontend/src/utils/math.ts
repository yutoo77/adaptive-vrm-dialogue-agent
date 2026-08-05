import type { CameraSettings } from "../types/character";

export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function damp(current: number, target: number, smoothing: number, delta: number): number {
  if (delta <= 0) return current;
  const t = 1 - Math.exp(-Math.max(0, smoothing) * delta);
  return current + (target - current) * t;
}

export function clampCameraSettings(settings: CameraSettings): CameraSettings {
  return {
    distance: clamp(settings.distance, 0.65, 1.8),
    heightOffset: clamp(settings.heightOffset, -0.5, 0.5),
    lookAtOffset: clamp(settings.lookAtOffset, -0.4, 0.4),
    modelOffset: clamp(settings.modelOffset, -0.6, 0.6),
    scale: clamp(settings.scale, 0.65, 1.45),
  };
}
