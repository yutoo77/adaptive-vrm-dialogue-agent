import { describe, expect, it } from "vitest";
import { isVoiceCatalog, parseStoredVoiceSettings } from "./voicePreferences";

const SETTINGS = { speaker_id: 14, speed_scale: 0.96, pitch_scale: -0.01, intonation_scale: 0.94 };

describe("saved voice preferences", () => {
  it("restores only validated voice fields and tolerates corrupt or out-of-range storage", () => {
    expect(parseStoredVoiceSettings(JSON.stringify({ ...SETTINGS, unused: "discard me" }))).toEqual(SETTINGS);
    for (const raw of [null, "broken", "null", "[]", JSON.stringify({ ...SETTINGS, pitch_scale: 100 }),
      JSON.stringify({ ...SETTINGS, speaker_id: true }), JSON.stringify({ ...SETTINGS, speed_scale: "1" })]) {
      expect(parseStoredVoiceSettings(raw)).toBeUndefined();
    }
  });

  it("rejects malformed catalogs instead of populating unsafe options", () => {
    const catalog = { defaults: SETTINGS, voices: [{ id: 14, name: "声", style: "標準", credit: "VOICEVOX:声" }] };
    expect(isVoiceCatalog(catalog)).toBe(true);
    expect(isVoiceCatalog({ ...catalog, voices: [] })).toBe(false);
    expect(isVoiceCatalog({ ...catalog, voices: [{ id: -1, name: "声" }] })).toBe(false);
  });
});
