export const CHARACTER_STATES = [
  "idle",
  "listening",
  "thinking",
  "explaining",
  "speaking",
  "happy",
  "gentle",
  "curious",
  "cautious",
  "confused",
  "error",
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

export const PERFORMANCE_EMOTIONS = ["neutral", "happy", "gentle", "curious", "cautious", "confused"] as const;
export const PERFORMANCE_GESTURES = ["none", "small_nod", "head_tilt", "soft_bounce"] as const;
export const VOICE_STYLES = ["neutral", "warm", "bright", "gentle", "serious"] as const;
export const REDUCED_MOTION_MODES = ["system", "normal", "reduced"] as const;
export const GAZE_BEHAVIORS = ["responsive", "engaged", "soft", "curious", "steady", "searching"] as const;

export type PerformanceEmotion = (typeof PERFORMANCE_EMOTIONS)[number];
export type PerformanceGesture = (typeof PERFORMANCE_GESTURES)[number];
export type VoiceStyle = (typeof VOICE_STYLES)[number];
export type ReducedMotionMode = (typeof REDUCED_MOTION_MODES)[number];
export type GazeBehavior = (typeof GAZE_BEHAVIORS)[number];

export interface PerformanceCue {
  readonly at: number;
  readonly gesture: Exclude<PerformanceGesture, "none">;
  readonly intensity: number;
}

export interface PerformancePlan {
  readonly emotion: PerformanceEmotion;
  readonly intensity: number;
  readonly gesture: PerformanceGesture;
  readonly voice_style: VoiceStyle;
  readonly cues: readonly PerformanceCue[];
}

export const PERFORMANCE_PREVIEW_INTENSITIES = {
  weak: 0.3,
  medium: 0.6,
  strong: 0.9,
} as const;

export function createPerformancePreviewPlan(
  emotion: PerformanceEmotion,
  gesture: PerformanceGesture,
  intensity: number,
): PerformancePlan {
  const voiceStyles: Readonly<Record<PerformanceEmotion, VoiceStyle>> = {
    neutral: "neutral",
    happy: "bright",
    gentle: "gentle",
    curious: "warm",
    cautious: "serious",
    confused: "gentle",
  };
  return {
    emotion,
    gesture,
    intensity: Math.max(0, Math.min(1, intensity)),
    voice_style: voiceStyles[emotion],
    cues: [],
  };
}

export function resolveReducedMotion(mode: ReducedMotionMode, systemPreference: boolean): boolean {
  if (mode === "system") return systemPreference;
  return mode === "reduced";
}

export function performanceEmotionToState(emotion: PerformanceEmotion): CharacterState {
  return emotion === "neutral" ? "explaining" : emotion;
}

export function isPerformancePlan(value: unknown): value is PerformancePlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as Record<string, unknown>;
  const cues = plan["cues"];
  return (
    PERFORMANCE_EMOTIONS.includes(plan["emotion"] as PerformanceEmotion) &&
    typeof plan["intensity"] === "number" &&
    Number.isFinite(plan["intensity"]) &&
    plan["intensity"] >= 0 &&
    plan["intensity"] <= 1 &&
    PERFORMANCE_GESTURES.includes(plan["gesture"] as PerformanceGesture) &&
    VOICE_STYLES.includes(plan["voice_style"] as VoiceStyle) &&
    Array.isArray(cues) &&
    cues.length <= 2 &&
    cues.every((cue, index) => isPerformanceCue(cue, index === 0 ? null : cues[index - 1]))
  );
}

function isPerformanceCue(value: unknown, previous: unknown): value is PerformanceCue {
  if (typeof value !== "object" || value === null) return false;
  const cue = value as Record<string, unknown>;
  const previousAt =
    typeof previous === "object" && previous !== null
      ? (previous as Record<string, unknown>)["at"]
      : null;
  return (
    typeof cue["at"] === "number" &&
    Number.isFinite(cue["at"]) &&
    cue["at"] >= 0.2 &&
    cue["at"] <= 0.82 &&
    cue["gesture"] !== "none" &&
    PERFORMANCE_GESTURES.includes(cue["gesture"] as PerformanceGesture) &&
    typeof cue["intensity"] === "number" &&
    Number.isFinite(cue["intensity"]) &&
    cue["intensity"] >= 0 &&
    cue["intensity"] <= 1 &&
    (typeof previousAt !== "number" || cue["at"] - previousAt >= 0.15)
  );
}

export interface ExpressionCandidate {
  readonly name: string;
  readonly weight: number;
}

export interface PosturePreset {
  readonly headPitch: number;
  readonly headYaw: number;
  readonly headRoll: number;
  readonly neckPitch: number;
  readonly chestPitch: number;
  readonly chestRoll: number;
}

export type GazeMode = "center" | "pointer" | "away";

export interface GazePreset {
  readonly mode: GazeMode;
  readonly pointerInfluence: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface MotionPreset {
  readonly speed: number;
  readonly breath: number;
  readonly sway: number;
  readonly bounce: number;
  readonly blink: number;
}

export interface CharacterStatePreset {
  readonly state: CharacterState;
  readonly label: string;
  readonly shortLabel: string;
  readonly message: string;
  readonly tone: "blue" | "violet" | "teal" | "amber" | "rose";
  readonly expressions: readonly ExpressionCandidate[];
  readonly posture: PosturePreset;
  readonly gaze: GazePreset;
  readonly motion: MotionPreset;
}

export interface IdleMotionFrame {
  readonly breathOffset: number;
  readonly swayAngle: number;
  readonly bounceOffset: number;
  readonly blinkWeight: number;
}

export interface PerformanceMotionFrame {
  readonly headPitchOffset: number;
  readonly headRollOffset: number;
  readonly rootOffset: number;
}

export interface CameraSettings {
  readonly distance: number;
  readonly heightOffset: number;
  readonly lookAtOffset: number;
  readonly modelOffset: number;
  readonly scale: number;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  distance: 1,
  heightOffset: 0,
  lookAtOffset: 0,
  modelOffset: 0,
  scale: 1,
};

export interface ModelDiagnostics {
  readonly modelName: string;
  readonly vrmVersion: string;
  readonly authors: readonly string[];
  readonly meta: Readonly<Record<string, string>>;
  readonly expressions: readonly string[];
  readonly bones: readonly string[];
  readonly loadTimeMs: number | null;
}

export interface RuntimeDiagnostics {
  readonly state: CharacterState;
  readonly activeExpression: string;
  readonly fps: number;
  readonly warnings: readonly string[];
}

export function isCharacterState(value: unknown): value is CharacterState {
  return typeof value === "string" && CHARACTER_STATES.includes(value as CharacterState);
}
