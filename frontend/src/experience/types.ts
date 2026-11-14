import { isPerformancePlan, type PerformancePlan } from "../types/character";

export const MOONS = ["half", "full", "crescent"] as const;
export const EXPERIENCE_TARGETS = ["window", "letter", "box"] as const;
export type Moon = (typeof MOONS)[number];
export type ExperienceFocusTarget = (typeof EXPERIENCE_TARGETS)[number] | null;
export type Arrangement = readonly [Moon | null, Moon | null, Moon | null];
export type ExperienceAction =
  | { readonly action: "inspect"; readonly target: Exclude<ExperienceFocusTarget, null> }
  | { readonly action: "arrange"; readonly arrangement: Arrangement }
  | { readonly action: "message"; readonly message: string }
  | { readonly action: "hint" | "submit" };

export interface ExperienceSnapshot {
  readonly session_id: string;
  readonly revision: number;
  readonly phase: "active" | "solved";
  readonly inspected: readonly Exclude<ExperienceFocusTarget, null>[];
  readonly hint_level: number;
  readonly arrangement: Arrangement;
  readonly attempts: number;
  readonly reply: string;
  readonly performance: PerformancePlan;
  readonly focus_target: ExperienceFocusTarget;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  readonly narration_provider: "scripted" | "openai";
  readonly notice: string | null;
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

export function isMoon(value: unknown): value is Moon {
  return MOONS.some((moon) => moon === value);
}

export function isTarget(value: unknown): value is Exclude<ExperienceFocusTarget, null> {
  return EXPERIENCE_TARGETS.some((target) => target === value);
}

export function isArrangement(value: unknown): value is Arrangement {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => item === null || isMoon(item))) return false;
  const occupied = value.filter((item) => item !== null);
  return new Set(occupied).size === occupied.length;
}

export function isExperienceSnapshot(value: unknown): value is ExperienceSnapshot {
  if (!isRecord(value)) return false;
  const inspected = value["inspected"];
  const performance = value["performance"];
  const messages = value["messages"];
  return isSessionId(value["session_id"]) && integer(value["revision"], 0) &&
    (value["phase"] === "active" || value["phase"] === "solved") &&
    Array.isArray(inspected) && inspected.length <= 3 && inspected.every(isTarget) && new Set(inspected).size === inspected.length &&
    integer(value["hint_level"], 0, 3) && isArrangement(value["arrangement"]) && integer(value["attempts"], 0) &&
    boundedText(value["reply"], 1, 1_000) && isPerformancePlan(performance) && performance.intensity <= 0.45 &&
    performance.gesture !== "soft_bounce" && performance.cues.every((cue) => cue.intensity <= 0.45 && cue.gesture !== "soft_bounce") &&
    (value["focus_target"] === null || isTarget(value["focus_target"])) &&
    Array.isArray(messages) && messages.length <= 24 && messages.every((message) => isRecord(message) &&
      (message["role"] === "user" || message["role"] === "assistant") && boundedText(message["text"], 1, 1_000)) &&
    (value["narration_provider"] === "scripted" || value["narration_provider"] === "openai") &&
    (value["notice"] === null || boundedText(value["notice"], 1, 1_000));
}

export function isExperienceAction(value: unknown): value is ExperienceAction {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (value["action"] === "inspect") return keys === "action,target" && isTarget(value["target"]);
  if (value["action"] === "arrange") return keys === "action,arrangement" && isArrangement(value["arrangement"]);
  if (value["action"] === "message") return keys === "action,message" && boundedText(value["message"], 1, 500);
  return keys === "action" && (value["action"] === "hint" || value["action"] === "submit");
}

/** Clicking an occupied slot replaces its card; a moved card cannot appear twice. */
export function placeMoon(arrangement: Arrangement, moon: Moon, index: number): Arrangement {
  if (!Number.isInteger(index) || index < 0 || index > 2) return arrangement;
  const next: [Moon | null, Moon | null, Moon | null] = [...arrangement];
  for (let slot = 0; slot < 3; slot += 1) if (next[slot] === moon) next[slot] = null;
  next[index] = moon;
  return next;
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function boundedText(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
