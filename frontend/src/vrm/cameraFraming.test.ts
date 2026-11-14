import { Object3D, Vector3 } from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CAMERA_SETTINGS } from "../types/character";
import { CharacterController } from "./CharacterController";
import { getCharacterStatePreset } from "./CharacterStatePresets";
import { measureNeutralEyeHeight, resolveCameraFraming } from "./cameraFraming";

function createModel(eyes: readonly (number | null)[] = [1.42, 1.4], lookAtHeight: number | null = 1.41) {
  const scene = new Object3D();
  const head = new Object3D();
  head.position.set(0, 1.35, -0.02);
  scene.add(head);
  const bones = new Map<string, Object3D>([[VRMHumanBoneName.Head, head]]);
  [VRMHumanBoneName.LeftEye, VRMHumanBoneName.RightEye].forEach((name, index) => {
    const height = eyes[index];
    if (height === null || height === undefined) return;
    const eye = new Object3D();
    eye.position.y = height;
    scene.add(eye);
    bones.set(name, eye);
  });
  const setValue = vi.fn();
  const vrm = {
    scene,
    humanoid: { getRawBoneNode: (name: string) => bones.get(name) ?? null, getNormalizedBoneNode: (name: string) => bones.get(name) ?? null },
    lookAt: lookAtHeight === null ? null : {
      target: null,
      getLookAtWorldPosition: (target: Vector3) => target.set(0, lookAtHeight, 0),
    },
    expressionManager: { expressionMap: { neutral: {}, relaxed: {}, aa: {}, blink: {} }, setValue, resetValues: vi.fn() },
  } as unknown as VRM;
  scene.updateMatrixWorld(true);
  return { vrm, head, bones, setValue };
}

const stillMotion = { breathOffset: 0, swayAngle: 0, bounceOffset: 0, blinkWeight: 0 };
const noGesture = { headPitchOffset: 0, headRollOffset: 0, rootOffset: 0 };

describe("neutral eye-height measurement", () => {
  it("averages available raw eyes in the grounded world pose", () => {
    const { vrm } = createModel();
    vrm.scene.position.y = 0.2;
    vrm.scene.updateMatrixWorld(true);
    expect(measureNeutralEyeHeight(vrm, 1.56)).toBeCloseTo(1.61);
  });

  it("uses one valid eye when the other eye is missing or nonfinite", () => {
    expect(measureNeutralEyeHeight(createModel([1.4, null]).vrm, 1.56)).toBe(1.4);
    expect(measureNeutralEyeHeight(createModel([NaN, 1.4]).vrm, 1.56)).toBe(1.4);
  });

  it("falls back to the VRM LookAt origin, then a bounded-height default", () => {
    expect(measureNeutralEyeHeight(createModel([]).vrm, 1.56)).toBe(1.41);
    expect(measureNeutralEyeHeight(createModel([], null).vrm, 1.56)).toBeCloseTo(1.404);
    expect(measureNeutralEyeHeight(createModel([], NaN).vrm, NaN)).toBeCloseTo(1.53);
  });

  it("replaces the measurement for each model, without retaining the previous eyes", () => {
    expect(measureNeutralEyeHeight(createModel([1.7, 1.7]).vrm, 1.9)).toBe(1.7);
    expect(measureNeutralEyeHeight(createModel([], null).vrm, 1.2)).toBeCloseTo(1.08);
  });
});

describe("dialogue framing", () => {
  const modelHeight = 1.558116872;
  const eyeHeight = 1.41408998;
  const framing = (settings = DEFAULT_CAMERA_SETTINGS, companion = false, baseY = 0) =>
    resolveCameraFraming(modelHeight, eyeHeight, baseY, settings, companion, 30);

  it("puts the viewpoint at the neutral eyes while keeping the desk composition and distance", () => {
    const result = framing();
    expect(result.cameraY).toBe(eyeHeight);
    expect(result.targetY).toBeCloseTo(modelHeight * 0.82);
    expect(result.distance).toBeCloseTo(1.686341686);
    expect(result.cameraY).toBeGreaterThan(result.targetY);
  });

  it("scales the rest-eye anchor without coupling it to the avatar position slider", () => {
    const result = framing({ ...DEFAULT_CAMERA_SETTINGS, scale: 1.25, modelOffset: 0.3 }, false, 0.1);
    expect(result.cameraY).toBeCloseTo(0.1 + (eyeHeight - 0.1) * 1.25);
    expect(result).toEqual(framing({ ...DEFAULT_CAMERA_SETTINGS, scale: 1.25 }, false, 0.1));
  });

  it("keeps camera height, composition target and distance controls independent", () => {
    const original = framing();
    const result = framing({ ...DEFAULT_CAMERA_SETTINGS, heightOffset: 0.05, lookAtOffset: -0.04, distance: 1.1 });
    expect(result.cameraY).toBeCloseTo(original.cameraY + 0.05 * modelHeight);
    expect(result.targetY).toBeCloseTo(original.targetY - 0.04 * modelHeight);
    expect(result.distance).toBeCloseTo(original.distance * 1.1);
  });

  it("preserves the legacy experience camera even when its settings are changed", () => {
    const settings = { ...DEFAULT_CAMERA_SETTINGS, scale: 1.1, heightOffset: 0.03, lookAtOffset: -0.02, distance: 0.9 };
    const result = framing(settings, true);
    const targetY = modelHeight * 1.1 * 0.85 - 0.02 * modelHeight;
    expect(result.targetY).toBeCloseTo(targetY);
    expect(result.cameraY).toBeCloseTo(targetY + 0.03 * modelHeight);
    expect(result.distance).toBeCloseTo(modelHeight * 1.1 * 0.44 / (2 * Math.tan(Math.PI / 12)) * 0.9);
  });
});

describe("camera-centered dialogue gaze", () => {
  function attach() {
    const model = createModel();
    const controller = new CharacterController();
    const target = new Object3D();
    const camera = new Object3D();
    camera.position.set(0, 1.414, 1.686);
    controller.attachVRM(model.vrm, target);
    controller.setGazeFocus(camera);
    return { ...model, controller, target, camera };
  }

  it("uses the live camera position without lifting the idle head", () => {
    const { controller, target, camera, head } = attach();
    controller.update(1, stillMotion, noGesture);
    expect(target.position.toArray()).toEqual(camera.position.toArray());
    expect(head.rotation.x).toBeCloseTo(0);
    camera.position.y += 0.1;
    controller.update(1, stillMotion, noGesture);
    expect(target.position.y).toBeCloseTo(camera.position.y);
  });

  it("retains thinking, pointer and ambient offsets and expressive head movement", () => {
    const { controller, target, camera, head } = attach();
    controller.setState("thinking");
    controller.setPointer(0.5, -0.2);
    controller.setAmbientGaze(0.1, 0.05);
    controller.update(1, stillMotion, { ...noGesture, headRollOffset: 0.03 });
    const preset = getCharacterStatePreset("thinking");
    expect(target.position.x).toBeCloseTo(camera.position.x + preset.gaze.offsetX + (0.5 * preset.gaze.pointerInfluence + 0.1) * 0.28);
    expect(target.position.y).toBeCloseTo(camera.position.y + preset.gaze.offsetY + (-0.2 * preset.gaze.pointerInfluence + 0.05) * 0.16);
    expect(target.position.z).toBe(camera.position.z);
    expect(Math.abs(head.rotation.x)).toBeGreaterThan(0.01);
    expect(Math.abs(head.rotation.z)).toBeGreaterThan(0.05);
  });

  it("keeps emotion, blink and lip-sync blending when looking at the camera", () => {
    const { controller, setValue } = attach();
    controller.setState("gentle");
    controller.setLipSyncWeight(0.6);
    controller.update(1, { ...stillMotion, blinkWeight: 0.8 }, noGesture);
    expect(setValue).toHaveBeenCalledWith("relaxed", expect.any(Number));
    expect(setValue.mock.calls.find(([name]) => name === "relaxed")?.[1]).toBeGreaterThan(0.5);
    expect(setValue.mock.calls.find(([name]) => name === "blink")?.[1]).toBeGreaterThan(0.7);
    expect(setValue.mock.calls.find(([name]) => name === "aa")?.[1]).toBeGreaterThan(0.5);
  });

  it("restores the exact legacy head-relative target in experience and can switch back", () => {
    const { controller, target, head, camera } = attach();
    controller.setGazeFocus(null);
    controller.update(1, stillMotion, noGesture);
    const expected = head.getWorldPosition(new Vector3());
    expected.z += 1.7;
    expect(target.position.toArray()).toEqual(expected.toArray());
    controller.setGazeFocus(camera);
    controller.update(1, stillMotion, noGesture);
    expect(target.position.toArray()).toEqual(camera.position.toArray());
  });

  it("releases the camera reference when replacing a model", () => {
    const { controller, target } = attach();
    const next = createModel();
    controller.attachVRM(next.vrm, target);
    controller.update(1, stillMotion, noGesture);
    expect(target.position.y).toBeCloseTo(next.head.position.y);
  });
});
