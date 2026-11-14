import type { CharacterStatePreset, ExpressionCandidate } from "../types/character";
import type { SpeechViseme } from "../speech/types";

export interface ResolvedExpression {
  readonly name: string;
  readonly weight: number;
}

export function resolveExpressionCandidate(
  availableNames: readonly string[],
  candidates: readonly ExpressionCandidate[],
): ResolvedExpression | null {
  const normalized = new Map(availableNames.map((name) => [name.toLowerCase(), name]));

  for (const candidate of candidates) {
    const actualName = normalized.get(candidate.name.toLowerCase());
    if (actualName) return { name: actualName, weight: candidate.weight };
  }

  return null;
}

export function resolveStateExpression(
  availableNames: readonly string[],
  preset: CharacterStatePreset,
): ResolvedExpression | null {
  return resolveExpressionCandidate(availableNames, preset.expressions);
}

export function resolveBlinkExpressions(availableNames: readonly string[]): readonly string[] {
  const normalized = new Map(availableNames.map((name) => [name.toLowerCase(), name]));
  const blink = normalized.get("blink");
  if (blink) return [blink];

  return [normalized.get("blinkleft"), normalized.get("blinkright")].filter(
    (name): name is string => typeof name === "string",
  );
}

export function resolveLipSyncExpression(availableNames: readonly string[]): string | null {
  return resolveLipSyncExpressions(availableNames).a ?? null;
}

export function resolveLipSyncExpressions(
  availableNames: readonly string[],
): Partial<Record<SpeechViseme, string>> {
  const candidates: Readonly<Record<SpeechViseme, readonly ExpressionCandidate[]>> = {
    a: [{ name: "aa", weight: 1 }, { name: "a", weight: 1 }, { name: "mouthOpen", weight: 1 }],
    i: [{ name: "ih", weight: 1 }, { name: "i", weight: 1 }],
    u: [{ name: "ou", weight: 1 }, { name: "u", weight: 1 }],
    e: [{ name: "ee", weight: 1 }, { name: "e", weight: 1 }],
    o: [{ name: "oh", weight: 1 }, { name: "o", weight: 1 }],
  };
  const result: Partial<Record<SpeechViseme, string>> = {};
  (Object.keys(candidates) as SpeechViseme[]).forEach((viseme) => {
    const resolved = resolveExpressionCandidate(availableNames, candidates[viseme]);
    if (resolved) result[viseme] = resolved.name;
  });
  return result;
}
