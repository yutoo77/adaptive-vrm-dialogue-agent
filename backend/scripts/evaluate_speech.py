from __future__ import annotations

import argparse
import io
import json
import statistics
import sys
import wave
from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any

import httpx

EVALUATION_TEXTS = (
    "こんにちは。今日はどんなことを話そうか？",
    "このアプリでは、文章への返答を音声と表情で伝えられます。",
    "少し長い説明でも、最後まで落ち着いて読み上げられるか確認します。",
    "音声の生成中でも、画面に表示された文章はそのまま確認できます。",
    "分からないことがあれば、条件を整理してから一緒に考えましょう。",
    "数字の読み上げを確認します。二〇二六年、十回、三・五秒です。",
    "英字を含む文章も試します。VOICEVOXとVRMを連携しています。",
    "句読点の間や、文章の終わりが不自然でないか確認してください。",
    "エラーが起きても、音声以外の操作を続けられる設計にしています。",
    "これで十回目の音声です。再生と口の動きが一致しているか確認します。",
)


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    index: int
    text: str
    success: bool
    latency_ms: int
    audio_seconds: float | None
    bytes: int
    request_id: str | None
    error: str | None


def wav_duration_seconds(audio: bytes) -> float:
    with wave.open(io.BytesIO(audio), "rb") as wav_file:
        frame_rate = wav_file.getframerate()
        if frame_rate <= 0:
            raise ValueError("WAV frame rate must be positive.")
        return wav_file.getnframes() / frame_rate


def percentile(values: list[int], ratio: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = round((len(ordered) - 1) * ratio)
    return ordered[index]


def evaluate(base_url: str, timeout_seconds: float) -> dict[str, Any]:
    normalized_base_url = base_url.rstrip("/")
    cases: list[EvaluationCase] = []

    with httpx.Client(base_url=normalized_base_url, timeout=timeout_seconds) as client:
        health_response = client.get("/api/speech/health")
        health_response.raise_for_status()
        health = health_response.json()
        if health.get("status") != "ready":
            raise RuntimeError(health.get("message", "VOICEVOX is unavailable."))

        for index, text in enumerate(EVALUATION_TEXTS, start=1):
            started_at = perf_counter()
            try:
                response = client.post("/api/speech", json={"text": text})
                latency_ms = round((perf_counter() - started_at) * 1000)
                response.raise_for_status()
                audio = response.content
                duration = round(wav_duration_seconds(audio), 3)
                cases.append(
                    EvaluationCase(
                        index=index,
                        text=text,
                        success=True,
                        latency_ms=latency_ms,
                        audio_seconds=duration,
                        bytes=len(audio),
                        request_id=response.headers.get("x-request-id"),
                        error=None,
                    )
                )
            except (httpx.HTTPError, ValueError, wave.Error) as error:
                cases.append(
                    EvaluationCase(
                        index=index,
                        text=text,
                        success=False,
                        latency_ms=round((perf_counter() - started_at) * 1000),
                        audio_seconds=None,
                        bytes=0,
                        request_id=None,
                        error=str(error),
                    )
                )

    successful_latencies = [case.latency_ms for case in cases if case.success]
    return {
        "health": health,
        "summary": {
            "attempted": len(cases),
            "succeeded": len(successful_latencies),
            "failed": len(cases) - len(successful_latencies),
            "latency_ms": {
                "min": min(successful_latencies, default=0),
                "median": round(statistics.median(successful_latencies)) if successful_latencies else 0,
                "p95": percentile(successful_latencies, 0.95),
                "max": max(successful_latencies, default=0),
            },
        },
        "cases": [asdict(case) for case in cases],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the repeatable 10-case VOICEVOX output evaluation.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL.")
    parser.add_argument("--timeout", type=float, default=40.0, help="Timeout per HTTP request in seconds.")
    return parser.parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args()
    try:
        result = evaluate(args.base_url, args.timeout)
    except (httpx.HTTPError, RuntimeError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False, indent=2))
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
