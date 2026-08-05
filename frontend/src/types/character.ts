export const CHARACTER_STATES = [
  "idle",
  "listening",
  "thinking",
  "explaining",
  "happy",
  "gentle",
  "curious",
  "cautious",
  "confused",
  "error",
] as const;

export type CharacterState = (typeof CHARACTER_STATES)[number];

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
