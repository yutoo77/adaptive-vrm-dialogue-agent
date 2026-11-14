"""Paired local-only VOICEVOX comparison. Never uses Settings.from_env or an LLM."""

import asyncio
import hashlib
import json
import statistics
from time import perf_counter

from app.config import Settings
from app.speech import VoicevoxSpeechProvider

TEXTS = (
    "わたしは、しずくだよ。",
    "少し休もうか。",
    "APIは、ソフト同士がやり取りする窓口だよ。",
    "わたしは月白しずく。落ち着いた口調で、ふだんの会話や考え事の整理を一緒にするよ。",
)


async def evaluate() -> dict[str, object]:
    shared = VoicevoxSpeechProvider(Settings())
    rows: list[dict[str, object]] = []
    try:
        health = await shared.check_health()
        if not health.available:
            raise RuntimeError("Start local VOICEVOX on port 50021 first.")
        # Exclude voice-model cold loading equally from both modes.
        await shared.synthesize(TEXTS[0], "connection-warmup")
        for round_index in range(2):
            for index, text in enumerate(TEXTS):
                pair: dict[str, object] = {"round": round_index, "case": index, "characters": len(text)}
                hashes: list[str] = []
                for mode in (("fresh", "reused") if round_index == 0 else ("reused", "fresh")):
                    provider = VoicevoxSpeechProvider(Settings()) if mode == "fresh" else shared
                    started = perf_counter()
                    try:
                        result = await provider.synthesize(text, f"connection-{round_index}-{index}-{mode}")
                        pair[f"{mode}_ms"] = round((perf_counter() - started) * 1000)
                        hashes.append(hashlib.sha256(result.audio).hexdigest())
                        pair["audio_ms"] = result.timing.duration_ms if result.timing else None
                    finally:
                        if mode == "fresh":
                            await provider.aclose()
                pair["same_wav"] = hashes[0] == hashes[1]
                rows.append(pair)
        return {"engine": health.engine_version, "external_ai_requests": 0, "pairs": rows,
                "median_fresh_ms": statistics.median(row["fresh_ms"] for row in rows),
                "median_reused_ms": statistics.median(row["reused_ms"] for row in rows),
                "median_paired_saving_ms": statistics.median(
                    row["fresh_ms"] - row["reused_ms"] for row in rows),
                "all_wav_identical": all(row["same_wav"] for row in rows)}
    finally:
        await shared.aclose()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(evaluate()), ensure_ascii=True, indent=2))
