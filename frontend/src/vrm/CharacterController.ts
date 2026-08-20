import { Euler, Quaternion, Vector3, type Object3D, type Object3DEventMap } from "three";
import { VRMHumanBoneName, type VRM, type VRMHumanBoneName as HumanBoneName } from "@pixiv/three-vrm";

import {
  isCharacterState,
  type CharacterState,
  type IdleMotionFrame,
  type PerformanceMotionFrame,
} from "../types/character";
import type { SpeechViseme } from "../speech/types";
import { damp } from "../utils/math";
import { getCharacterStatePreset } from "./CharacterStatePresets";
import { resolveBlinkExpressions, resolveLipSyncExpressions, resolveStateExpression } from "./expressionMapping";

interface BoneBinding {
  readonly node: Object3D<Object3DEventMap>;
  readonly restQuaternion: Quaternion;
}

export interface CharacterControllerEvents {
  readonly onStateChange?: (state: CharacterState) => void;
  readonly onExpressionChange?: (expression: string) => void;
  readonly onWarning?: (message: string) => void;
}

const CONTROLLED_BONES: readonly HumanBoneName[] = [
  VRMHumanBoneName.Hips,
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.UpperChest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.RightUpperArm,
];

export const NEUTRAL_UPPER_ARM_ROLLS = {
  [VRMHumanBoneName.LeftUpperArm]: -Math.PI * 0.4,
  [VRMHumanBoneName.RightUpperArm]: Math.PI * 0.4,
} as const;

export class CharacterController {
  private state: CharacterState = "idle";
  private vrm: VRM | null = null;
  private readonly bones = new Map<HumanBoneName, BoneBinding>();
  private availableExpressions: readonly string[] = [];
  private blinkExpressions: readonly string[] = [];
  private lipSyncExpressions: Partial<Record<SpeechViseme, string>> = {};
  private lipSyncViseme: SpeechViseme = "a";
  private lipSyncWeight = 0;
  private lipSyncWarningEmitted = false;
  private lipSyncFallbackWarningEmitted = false;
  private readonly expressionValues = new Map<string, number>();
  private activeExpression = "なし";
  private performanceIntensity = 1;
  private manualExpression: { readonly name: string; readonly weight: number } | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private rootBaseY = 0;
  private lookAtTarget: Object3D<Object3DEventMap> | null = null;
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  private readonly poseQuaternion = new Quaternion();
  private readonly targetQuaternion = new Quaternion();
  private readonly headWorldPosition = new Vector3();

  public constructor(private readonly events: CharacterControllerEvents = {}) {}

  public getState(): CharacterState {
    return this.state;
  }

  public getActiveExpression(): string {
    return this.activeExpression;
  }

  public setState(state: CharacterState): void {
    this.performanceIntensity = 1;
    if (state === this.state) return;
    this.state = state;
    this.manualExpression = null;
    this.events.onStateChange?.(state);
  }

  public setPerformanceIntensity(intensity: number): void {
    this.performanceIntensity = Math.max(0, Math.min(1, intensity));
  }

  public applyPerformance(state: CharacterState, intensity: number): void {
    this.setState(state);
    this.manualExpression = null;
    this.setPerformanceIntensity(intensity);
  }

  public setStateFromUnknown(value: unknown): boolean {
    if (!isCharacterState(value)) return false;
    this.setState(value);
    return true;
  }

  public setPointer(x: number, y: number): void {
    this.pointerX = Math.max(-1, Math.min(1, x));
    this.pointerY = Math.max(-1, Math.min(1, y));
  }

  public setRootBaseY(y: number): void {
    this.rootBaseY = y;
    if (this.vrm) this.vrm.scene.position.y = y;
  }

  public setManualExpression(name: string | null, weight = 0): boolean {
    if (name === null) {
      this.manualExpression = null;
      return true;
    }
    if (!this.availableExpressions.includes(name)) return false;
    this.manualExpression = { name, weight: Math.max(0, Math.min(1, weight)) };
    return true;
  }

  public setLipSyncWeight(weight: number): boolean {
    return this.setLipSyncViseme("a", weight);
  }

  public setLipSyncViseme(viseme: SpeechViseme, weight: number): boolean {
    this.lipSyncViseme = viseme;
    this.lipSyncWeight = Math.max(0, Math.min(1, weight));
    if (this.lipSyncExpressions[viseme]) return true;
    if (this.activeLipSyncExpression()) {
      if (this.lipSyncWeight > 0.01 && !this.lipSyncFallbackWarningEmitted) {
        this.lipSyncFallbackWarningEmitted = true;
        this.events.onWarning?.("このモデルは一部の母音口形がないため、利用可能な口形へFallbackします。");
      }
      return true;
    }
    if (this.lipSyncWeight > 0.01 && !this.lipSyncWarningEmitted) {
      this.lipSyncWarningEmitted = true;
      this.events.onWarning?.("このモデルにはLip Sync用の口形Expressionがありません。");
    }
    return false;
  }

  public resetLipSync(): void {
    this.lipSyncWeight = 0;
    const manager = this.vrm?.expressionManager;
    new Set(Object.values(this.lipSyncExpressions)).forEach((name) => {
      if (!name) return;
      manager?.setValue(name, 0);
      this.expressionValues.set(name, 0);
    });
  }

  public attachVRM(vrm: VRM, lookAtTarget: Object3D<Object3DEventMap>): void {
    this.detachVRM();
    this.vrm = vrm;
    this.lookAtTarget = lookAtTarget;
    this.rootBaseY = vrm.scene.position.y;
    this.availableExpressions = Object.keys(vrm.expressionManager?.expressionMap ?? {}).sort();
    this.blinkExpressions = resolveBlinkExpressions(this.availableExpressions);
    this.lipSyncExpressions = resolveLipSyncExpressions(this.availableExpressions);
    this.lipSyncViseme = "a";
    this.lipSyncWeight = 0;
    this.lipSyncWarningEmitted = false;
    this.lipSyncFallbackWarningEmitted = false;
    this.expressionValues.clear();
    this.availableExpressions.forEach((name) => this.expressionValues.set(name, 0));

    for (const boneName of CONTROLLED_BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(boneName);
      if (node) this.bones.set(boneName, { node, restQuaternion: node.quaternion.clone() });
    }

    if (vrm.lookAt) vrm.lookAt.target = lookAtTarget;
  }

  public detachVRM(): void {
    if (this.vrm?.expressionManager) this.vrm.expressionManager.resetValues();
    if (this.vrm?.lookAt) this.vrm.lookAt.target = null;
    this.vrm = null;
    this.lookAtTarget = null;
    this.bones.clear();
    this.availableExpressions = [];
    this.blinkExpressions = [];
    this.lipSyncExpressions = {};
    this.lipSyncViseme = "a";
    this.lipSyncWeight = 0;
    this.lipSyncWarningEmitted = false;
    this.lipSyncFallbackWarningEmitted = false;
    this.expressionValues.clear();
    this.manualExpression = null;
    this.activeExpression = "なし";
  }

  public update(delta: number, motion: IdleMotionFrame, performance: PerformanceMotionFrame): void {
    if (!this.vrm) return;

    this.vrm.scene.position.y = this.rootBaseY + motion.breathOffset + motion.bounceOffset + performance.rootOffset;
    this.updateExpressions(delta, motion.blinkWeight);
    this.updatePose(delta, motion.swayAngle, performance);
    this.updateLookAt();
  }

  private updateExpressions(delta: number, blinkWeight: number): void {
    const manager = this.vrm?.expressionManager;
    if (!manager) {
      this.setActiveExpression("姿勢のみ");
      return;
    }

    const preset = getCharacterStatePreset(this.state);
    const resolved = resolveStateExpression(this.availableExpressions, preset);
    const targetName = this.manualExpression?.name ?? resolved?.name ?? null;
    const baseTargetWeight = this.manualExpression?.weight ?? resolved?.weight ?? 0;
    const emotionalScale = targetName?.toLowerCase() === "neutral" ? 1 : 0.35 + this.performanceIntensity * 0.65;
    const targetWeight = this.manualExpression ? baseTargetWeight : baseTargetWeight * emotionalScale;
    const blinkNames = new Set(this.blinkExpressions);
    const lipSyncExpression = this.activeLipSyncExpression();

    for (const name of this.availableExpressions) {
      let target = name === targetName ? targetWeight : 0;
      if (blinkNames.has(name)) target = Math.max(target, blinkWeight);
      if (name === lipSyncExpression) target = Math.max(target, this.lipSyncWeight);
      const current = this.expressionValues.get(name) ?? 0;
      const next = damp(current, target, 8.5, delta);
      this.expressionValues.set(name, next);
      manager.setValue(name, next);
    }

    const lipSyncActive = lipSyncExpression && this.lipSyncWeight > 0.02;
    this.setActiveExpression(
      lipSyncActive ? `${targetName ?? "姿勢のみ"} + ${lipSyncExpression}` : (targetName ?? "姿勢のみ"),
    );
  }

  private activeLipSyncExpression(): string | null {
    return this.lipSyncExpressions[this.lipSyncViseme] ?? this.lipSyncExpressions.a ?? null;
  }

  private updatePose(delta: number, swayAngle: number, performance: PerformanceMotionFrame): void {
    const preset = getCharacterStatePreset(this.state);
    const emotionalScale = 0.45 + this.performanceIntensity * 0.55;
    const hasLookAt = Boolean(this.vrm?.lookAt);
    const pointerYaw = hasLookAt ? 0 : this.pointerX * preset.gaze.pointerInfluence * 0.09;
    const pointerPitch = hasLookAt ? 0 : -this.pointerY * preset.gaze.pointerInfluence * 0.055;

    this.applyBoneRotation(
      VRMHumanBoneName.LeftUpperArm,
      0,
      0,
      NEUTRAL_UPPER_ARM_ROLLS[VRMHumanBoneName.LeftUpperArm],
      delta,
    );
    this.applyBoneRotation(
      VRMHumanBoneName.RightUpperArm,
      0,
      0,
      NEUTRAL_UPPER_ARM_ROLLS[VRMHumanBoneName.RightUpperArm],
      delta,
    );

    this.applyBoneRotation(
      VRMHumanBoneName.Head,
      preset.posture.headPitch * emotionalScale + pointerPitch + performance.headPitchOffset,
      preset.posture.headYaw * emotionalScale + pointerYaw,
      preset.posture.headRoll * emotionalScale + performance.headRollOffset,
      delta,
    );
    this.applyBoneRotation(VRMHumanBoneName.Neck, preset.posture.neckPitch * emotionalScale, 0, swayAngle * 0.25, delta);
    this.applyBoneRotation(
      VRMHumanBoneName.UpperChest,
      preset.posture.chestPitch * emotionalScale,
      0,
      preset.posture.chestRoll * emotionalScale + swayAngle,
      delta,
    );
    this.applyBoneRotation(
      VRMHumanBoneName.Chest,
      preset.posture.chestPitch * emotionalScale * 0.55,
      0,
      preset.posture.chestRoll * emotionalScale * 0.45 + swayAngle * 0.5,
      delta,
    );
    this.applyBoneRotation(VRMHumanBoneName.Spine, 0, 0, swayAngle * 0.2, delta);
  }

  private applyBoneRotation(
    boneName: HumanBoneName,
    pitch: number,
    yaw: number,
    roll: number,
    delta: number,
  ): void {
    const binding = this.bones.get(boneName);
    if (!binding) return;

    this.euler.set(pitch, yaw, roll, "YXZ");
    this.poseQuaternion.setFromEuler(this.euler);
    this.targetQuaternion.copy(binding.restQuaternion).multiply(this.poseQuaternion);
    binding.node.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-6.5 * Math.max(0, delta)));
  }

  private updateLookAt(): void {
    if (!this.vrm?.lookAt || !this.lookAtTarget) return;
    const preset = getCharacterStatePreset(this.state);
    const head = this.bones.get(VRMHumanBoneName.Head)?.node;
    if (!head) return;

    head.getWorldPosition(this.headWorldPosition);
    const pointerX = preset.gaze.mode === "center" ? 0 : this.pointerX * preset.gaze.pointerInfluence;
    const pointerY = preset.gaze.mode === "center" ? 0 : this.pointerY * preset.gaze.pointerInfluence;
    this.lookAtTarget.position.set(
      this.headWorldPosition.x + preset.gaze.offsetX + pointerX * 0.28,
      this.headWorldPosition.y + preset.gaze.offsetY + pointerY * 0.16,
      this.headWorldPosition.z + 1.7,
    );
  }

  private setActiveExpression(value: string): void {
    if (value === this.activeExpression) return;
    this.activeExpression = value;
    this.events.onExpressionChange?.(value);
  }
}
