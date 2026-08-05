import type { CharacterStatePreset, ExpressionCandidate } from "../types/character";

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
