import { MathUtils, Vector3 } from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import type { CameraSettings } from "../types/character";

/** Measure once in the grounded rest pose, before breathing or gestures start. */
export function measureNeutralEyeHeight(vrm: VRM, modelHeight: number): number {
  const position = new Vector3();
  const eyeHeights = [VRMHumanBoneName.LeftEye, VRMHumanBoneName.RightEye]
    .map((bone) => vrm.humanoid.getRawBoneNode(bone)?.getWorldPosition(position).y)
    .filter((height): height is number => height !== undefined && Number.isFinite(height));
  if (eyeHeights.length) return eyeHeights.reduce((sum, height) => sum + height, 0) / eyeHeights.length;

  const lookAtHeight = vrm.lookAt?.getLookAtWorldPosition(position).y;
  if (lookAtHeight !== undefined && Number.isFinite(lookAtHeight)) return lookAtHeight;
  return (Number.isFinite(modelHeight) && modelHeight > 0 ? modelHeight : 1.7) * 0.9;
}

export function resolveCameraFraming(
  modelHeight: number,
  neutralEyeHeight: number,
  modelBaseY: number,
  settings: CameraSettings,
  companion: boolean,
  fov: number,
): { readonly cameraY: number; readonly targetY: number; readonly distance: number } {
  const height = modelHeight * settings.scale;
  const targetY = height * (companion ? 0.85 : 0.82) + settings.lookAtOffset * modelHeight;
  const frameHeight = height * (companion ? 0.44 : 0.58);
  const distance = frameHeight / (2 * Math.tan(MathUtils.degToRad(fov * 0.5))) * settings.distance;
  // Keep composition and eye-level viewpoint independent; modelOffset only moves the avatar.
  const cameraY = (companion ? targetY : modelBaseY + (neutralEyeHeight - modelBaseY) * settings.scale)
    + settings.heightOffset * modelHeight;
  return { cameraY, targetY, distance };
}
