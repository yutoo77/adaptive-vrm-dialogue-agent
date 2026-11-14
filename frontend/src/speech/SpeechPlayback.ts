import type { PerformancePlan, VoiceStyle } from "../types/character";

const MAX_SPEECH_DURATION_MS = 300_000;

export function getVoicePlaybackRate(performance: PerformancePlan | null): number {
  if (!performance) return 1;
  const targetRates: Readonly<Record<VoiceStyle, number>> = {
    neutral: 1,
    warm: 0.98,
    bright: 1.06,
    gentle: 0.93,
    serious: 0.96,
  };
  return 1 + (targetRates[performance.voice_style] - 1) * performance.intensity;
}

export function resolveSpeechDurationMs(
  mediaDurationSeconds: number,
  text: string,
  playbackRate: number,
  metadataDurationMs: number | null = null,
): number {
  const safeRate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  if (Number.isFinite(mediaDurationSeconds) && mediaDurationSeconds > 0) {
    return Math.round(
      Math.max(800, Math.min(MAX_SPEECH_DURATION_MS, (mediaDurationSeconds * 1000) / safeRate)),
    );
  }
  if (metadataDurationMs !== null && Number.isFinite(metadataDurationMs) && metadataDurationMs > 0) {
    return Math.round(
      Math.max(800, Math.min(MAX_SPEECH_DURATION_MS, metadataDurationMs / safeRate)),
    );
  }
  const punctuationPauses = (text.match(/[。！？!?、，,]/g) ?? []).length * 120;
  return Math.round(
    Math.max(1_000, Math.min(MAX_SPEECH_DURATION_MS, (text.length * 115 + punctuationPauses) / safeRate)),
  );
}
