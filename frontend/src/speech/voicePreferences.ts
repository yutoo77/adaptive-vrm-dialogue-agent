import type { VoiceCatalog, VoiceSettings } from "./types";

export const VOICE_STORAGE_KEY = "adaptive-character:voice:v1";

export function isVoiceSettings(value: unknown): value is VoiceSettings {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const bounded = (key: string, min: number, max: number): boolean => {
    const number = item[key];
    return typeof number === "number" && Number.isFinite(number) && number >= min && number <= max;
  };
  return bounded("speaker_id", 0, 100_000) && Number.isInteger(item["speaker_id"])
    && bounded("speed_scale", 0.6, 1.6) && bounded("pitch_scale", -0.15, 0.15)
    && bounded("intonation_scale", 0, 1.5);
}

export function copyVoiceSettings(value: VoiceSettings): VoiceSettings {
  return {
    speaker_id: value.speaker_id, speed_scale: value.speed_scale,
    pitch_scale: value.pitch_scale, intonation_scale: value.intonation_scale,
  };
}

export function parseStoredVoiceSettings(raw: string | null): VoiceSettings | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return isVoiceSettings(value) ? copyVoiceSettings(value) : undefined;
  } catch {
    return undefined;
  }
}

export function isVoiceCatalog(value: unknown): value is VoiceCatalog {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isVoiceSettings(item["defaults"]) && Array.isArray(item["voices"]) && item["voices"].length > 0
    && item["voices"].every((voice: unknown) => {
      if (!voice || typeof voice !== "object") return false;
      const option = voice as Record<string, unknown>;
      return typeof option["id"] === "number" && Number.isInteger(option["id"])
        && option["id"] >= 0 && option["id"] <= 100_000
        && typeof option["name"] === "string" && typeof option["style"] === "string"
        && typeof option["credit"] === "string";
    });
}
