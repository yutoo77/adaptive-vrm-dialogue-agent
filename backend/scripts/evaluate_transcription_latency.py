"""Opt-in, RAM-only synthetic ASR benchmark; cached model only, no microphone or LLM."""

import argparse
import asyncio
import json
import statistics
import unicodedata
from collections.abc import Callable
from io import BytesIO
from time import perf_counter
from typing import Any

from faster_whisper import WhisperModel

from app.config import Settings
from app.speech import VoicevoxSpeechProvider

TEXTS = (
    "今日は少し忙しかったから、ゆっくり話したいな。",
    "丸い月を真ん中に置いてみよう。",
    "右の栞を、一度外してみて。",
    "ヒントはまだ言わないで。一緒に考えたい。",
    "声の速さを少しゆっくりにしてほしい。",
)


def normalize(text: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFKC", text)
        if not unicodedata.category(char).startswith(("P", "Z")) and not char.isspace()
    )


async def evaluate(
    speech: Any,
    model_factory: Callable[..., Any],
    clock: Callable[[], float] = perf_counter,
    *,
    compare_beams: bool = False,
) -> dict[str, Any]:
    health = await speech.check_health()
    if not health.available:
        raise RuntimeError("Start existing local VOICEVOX on port 50021 first.")
    # Finish synthesis before timing recognition; no audio is written to disk.
    clips = [(await speech.synthesize(text, f"synthetic-asr-{index}")).audio for index, text in enumerate(TEXTS)]
    before = clock()
    model = model_factory("small", device="cpu", compute_type="int8", local_files_only=True)
    model_init_ms = round((clock() - before) * 1000)
    rows = []
    for round_index in range(2):
        for index, (expected, audio) in enumerate(zip(TEXTS, clips, strict=True)):
            before = clock()
            segments, info = model.transcribe(
                BytesIO(audio),
                language="ja",
                task="transcribe",
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = "".join(segment.text for segment in segments).strip()
            rows.append(
                {
                    "round": round_index + 1,
                    "case": index + 1,
                    "expected": expected,
                    "text": text,
                    "recognition_ms": round((clock() - before) * 1000),
                    "audio_ms": round(info.duration * 1000),
                    "normalized_exact": normalize(text) == normalize(expected),
                }
            )
    warm = [row["recognition_ms"] for row in rows[1:]]
    report = {
        "voicevox": health.engine_version,
        "model": "small",
        "device": "cpu",
        "compute_type": "int8",
        "beam_size": 5,
        "local_files_only": True,
        "microphone_requests": 0,
        "external_ai_requests": 0,
        "synthetic_clips": len(clips),
        "model_init_ms": model_init_ms,
        "first_decode_ms": rows[0]["recognition_ms"],
        "subsequent_median_ms": statistics.median(warm),
        "subsequent_min_ms": min(warm),
        "subsequent_max_ms": max(warm),
        "normalized_exact_count": sum(row["normalized_exact"] for row in rows),
        "rows": rows,
        "limits": "Synthetic clean speech, 5 sentences x 2; not real microphone accuracy or end-to-end latency.",
    }
    if compare_beams:
        report["comparison"] = compare(model, clips, clock)
    return report


def compare(model: Any, clips: list[bytes], clock: Callable[[], float]) -> dict[str, Any]:
    pairs = []
    for round_index in range(2):
        for index, (expected, audio) in enumerate(zip(TEXTS, clips, strict=True)):
            pair = {"round": round_index + 1, "case": index + 1, "expected": expected}
            for beam in (5, 1) if round_index == 0 else (1, 5):
                started = clock()
                segments, _info = model.transcribe(
                    BytesIO(audio),
                    language="ja",
                    task="transcribe",
                    beam_size=beam,
                    vad_filter=True,
                    condition_on_previous_text=False,
                )
                text = "".join(segment.text for segment in segments).strip()
                pair[f"beam_{beam}_ms"] = round((clock() - started) * 1000)
                pair[f"beam_{beam}_text"] = text
                pair[f"beam_{beam}_normalized_exact"] = normalize(text) == normalize(expected)
            pair["same_normalized_text"] = normalize(pair["beam_5_text"]) == normalize(pair["beam_1_text"])
            pairs.append(pair)
    return {
        "pairs": pairs,
        "order": "5 then 1 in round 1; 1 then 5 in round 2; baseline warmed both",
        "median_beam_5_ms": statistics.median(pair["beam_5_ms"] for pair in pairs),
        "median_beam_1_ms": statistics.median(pair["beam_1_ms"] for pair in pairs),
        "median_paired_saving_ms": statistics.median(pair["beam_5_ms"] - pair["beam_1_ms"] for pair in pairs),
        "same_normalized_count": sum(pair["same_normalized_text"] for pair in pairs),
        "beam_5_exact_count": sum(pair["beam_5_normalized_exact"] for pair in pairs),
        "beam_1_exact_count": sum(pair["beam_1_normalized_exact"] for pair in pairs),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run-local", action="store_true", help="Use local VOICEVOX and the already cached small model."
    )
    parser.add_argument("--compare-beams", action="store_true", help="Add 20 paired recognitions, beam 5 vs 1.")
    args = parser.parse_args()
    if not args.run_local:
        print("No work performed. Pass --run-local to synthesize 5 clips and run 10 CPU recognitions in RAM.")
        return 2

    async def run():
        speech = VoicevoxSpeechProvider(Settings())
        try:
            return await evaluate(speech, WhisperModel, compare_beams=args.compare_beams)
        finally:
            await speech.aclose()

    try:
        result = asyncio.run(run())
    except Exception:
        print("Local benchmark failed. Check VOICEVOX and the pre-downloaded small model; no model is downloaded here.")
        return 1
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
