from __future__ import annotations

import argparse
import json
import statistics
import sys
import wave
from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any, Literal

import httpx

from scripts.evaluate_speech import wav_duration_seconds

ScenarioCategory = Literal["baseline", "adversarial"]


@dataclass(frozen=True, slots=True)
class PerformanceScenario:
    id: str
    category: ScenarioCategory
    message: str
    expected_emotion: str
    expected_gesture: str
    expected_voice_style: str


SCENARIOS = (
    PerformanceScenario("greeting", "baseline", "こんにちは", "happy", "soft_bounce", "bright"),
    PerformanceScenario("gratitude", "baseline", "ありがとう、助かったよ", "happy", "soft_bounce", "bright"),
    PerformanceScenario("fatigue", "baseline", "今日は少し疲れた", "gentle", "small_nod", "gentle"),
    PerformanceScenario("question", "baseline", "どうして空は青いの？", "curious", "head_tilt", "warm"),
    PerformanceScenario("risk", "baseline", "危険性を確認して", "cautious", "small_nod", "serious"),
    PerformanceScenario("unclear", "baseline", "どういう意味かわからない", "confused", "head_tilt", "serious"),
    PerformanceScenario("neutral", "baseline", "続きを話そう", "neutral", "small_nod", "neutral"),
    PerformanceScenario("mixed", "adversarial", "不安だけど、どうしてこうなるの？", "gentle", "small_nod", "gentle"),
    PerformanceScenario("negated_happy", "adversarial", "別に嬉しくないよ", "gentle", "small_nod", "gentle"),
    PerformanceScenario(
        "positive_then_damage",
        "adversarial",
        "最高だね。全部壊れたけど。",
        "cautious",
        "small_nod",
        "serious",
    ),
)


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    id: str
    category: ScenarioCategory
    message: str
    expected: dict[str, str]
    actual: dict[str, Any] | None
    performance_match: bool
    cue_timeline_valid: bool
    dialogue_success: bool
    dialogue_latency_ms: int
    speech_success: bool
    speech_timing_valid: bool
    viseme_count: int
    phrase_boundary_count: int
    speech_latency_ms: int | None
    audio_seconds: float | None
    audio_bytes: int
    error: str | None


def evaluate(
    base_url: str,
    timeout_seconds: float,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    normalized_base_url = base_url.rstrip("/")
    cases: list[EvaluationCase] = []

    with httpx.Client(base_url=normalized_base_url, timeout=timeout_seconds, transport=transport) as client:
        health_response = client.get("/api/speech/health")
        health_response.raise_for_status()
        health = health_response.json()
        if health.get("status") != "ready":
            raise RuntimeError(health.get("message", "VOICEVOX is unavailable."))

        for index, scenario in enumerate(SCENARIOS, start=1):
            cases.append(_evaluate_scenario(client, scenario, index))

    dialogue_latencies = [case.dialogue_latency_ms for case in cases if case.dialogue_success]
    speech_latencies = [case.speech_latency_ms for case in cases if case.speech_latency_ms is not None]
    baseline_cases = [case for case in cases if case.category == "baseline"]
    adversarial_cases = [case for case in cases if case.category == "adversarial"]
    return {
        "health": health,
        "summary": {
            "attempted": len(cases),
            "dialogue_succeeded": sum(case.dialogue_success for case in cases),
            "speech_succeeded": sum(case.speech_success for case in cases),
            "speech_timings_valid": sum(case.speech_timing_valid for case in cases),
            "performance_matched": sum(case.performance_match for case in cases),
            "cue_timelines_valid": sum(case.cue_timeline_valid for case in cases),
            "baseline_matched": sum(case.performance_match for case in baseline_cases),
            "baseline_total": len(baseline_cases),
            "adversarial_matched": sum(case.performance_match for case in adversarial_cases),
            "adversarial_total": len(adversarial_cases),
            "dialogue_latency_ms_median": _median(dialogue_latencies),
            "speech_latency_ms_median": _median([value for value in speech_latencies if value is not None]),
        },
        "cases": [asdict(case) for case in cases],
    }


def _evaluate_scenario(
    client: httpx.Client,
    scenario: PerformanceScenario,
    index: int,
) -> EvaluationCase:
    expected = {
        "emotion": scenario.expected_emotion,
        "gesture": scenario.expected_gesture,
        "voice_style": scenario.expected_voice_style,
    }
    dialogue_started = perf_counter()
    try:
        dialogue_response = client.post(
            "/api/dialogue",
            json={"message": scenario.message, "session_id": f"performance-eval-{index:02d}-20260818"},
        )
        dialogue_latency_ms = round((perf_counter() - dialogue_started) * 1000)
        dialogue_response.raise_for_status()
        dialogue_payload = dialogue_response.json()
        performance = dialogue_payload.get("performance")
        if not isinstance(performance, dict) or not isinstance(dialogue_payload.get("reply"), str):
            raise ValueError("Dialogue response did not contain a valid reply and performance plan.")

        actual = {
            "emotion": performance.get("emotion"),
            "intensity": performance.get("intensity"),
            "gesture": performance.get("gesture"),
            "voice_style": performance.get("voice_style"),
            "cues": performance.get("cues"),
        }
        cue_timeline_valid = _cue_timeline_is_valid(actual["cues"])
        performance_match = cue_timeline_valid and all(actual.get(key) == value for key, value in expected.items())
    except (httpx.HTTPError, ValueError) as error:
        return EvaluationCase(
            id=scenario.id,
            category=scenario.category,
            message=scenario.message,
            expected=expected,
            actual=None,
            performance_match=False,
            cue_timeline_valid=False,
            dialogue_success=False,
            dialogue_latency_ms=round((perf_counter() - dialogue_started) * 1000),
            speech_success=False,
            speech_timing_valid=False,
            viseme_count=0,
            phrase_boundary_count=0,
            speech_latency_ms=None,
            audio_seconds=None,
            audio_bytes=0,
            error=str(error),
        )

    speech_started = perf_counter()
    try:
        speech_response = client.post("/api/speech", json={"text": dialogue_payload["reply"]})
        speech_latency_ms = round((perf_counter() - speech_started) * 1000)
        speech_response.raise_for_status()
        audio = speech_response.content
        duration = round(wav_duration_seconds(audio), 3)
        speech_timing_valid, viseme_count, phrase_boundary_count = _speech_timing_summary(
            speech_response.headers,
            duration,
        )
    except (httpx.HTTPError, ValueError, wave.Error) as error:
        return EvaluationCase(
            id=scenario.id,
            category=scenario.category,
            message=scenario.message,
            expected=expected,
            actual=actual,
            performance_match=performance_match,
            cue_timeline_valid=cue_timeline_valid,
            dialogue_success=True,
            dialogue_latency_ms=dialogue_latency_ms,
            speech_success=False,
            speech_timing_valid=False,
            viseme_count=0,
            phrase_boundary_count=0,
            speech_latency_ms=round((perf_counter() - speech_started) * 1000),
            audio_seconds=None,
            audio_bytes=0,
            error=str(error),
        )

    return EvaluationCase(
        id=scenario.id,
        category=scenario.category,
        message=scenario.message,
        expected=expected,
        actual=actual,
        performance_match=performance_match,
        cue_timeline_valid=cue_timeline_valid,
        dialogue_success=True,
        dialogue_latency_ms=dialogue_latency_ms,
        speech_success=True,
        speech_timing_valid=speech_timing_valid,
        viseme_count=viseme_count,
        phrase_boundary_count=phrase_boundary_count,
        speech_latency_ms=speech_latency_ms,
        audio_seconds=duration,
        audio_bytes=len(audio),
        error=None,
    )


def _median(values: list[int]) -> int:
    return round(statistics.median(values)) if values else 0


def _cue_timeline_is_valid(value: Any) -> bool:
    if not isinstance(value, list) or len(value) > 2:
        return False
    previous_at: float | None = None
    for cue in value:
        if not isinstance(cue, dict):
            return False
        at = cue.get("at")
        intensity = cue.get("intensity")
        gesture = cue.get("gesture")
        if not isinstance(at, (int, float)) or not 0.2 <= at <= 0.82:
            return False
        if not isinstance(intensity, (int, float)) or not 0 <= intensity <= 1:
            return False
        if gesture not in {"small_nod", "head_tilt", "soft_bounce"}:
            return False
        if previous_at is not None and at - previous_at < 0.15:
            return False
        previous_at = at
    return True


def _speech_timing_summary(headers: httpx.Headers, audio_seconds: float) -> tuple[bool, int, int]:
    try:
        if headers.get("x-speech-timing-version") != "1":
            return False, 0, 0
        duration_ms = int(headers["x-speech-duration-ms"])
        if duration_ms <= 0 or abs(duration_ms - round(audio_seconds * 1000)) > 2:
            return False, 0, 0

        boundaries = [int(value) for value in headers.get("x-speech-phrase-boundaries", "").split(",") if value]
        if len(boundaries) > 64 or boundaries != sorted(set(boundaries)):
            return False, 0, 0
        if any(boundary < 0 or boundary >= duration_ms for boundary in boundaries):
            return False, 0, 0

        viseme_tokens = [value for value in headers.get("x-speech-visemes", "").split(",") if value]
        if not viseme_tokens or len(viseme_tokens) > 240:
            return False, 0, 0
        previous_start = -1
        for token in viseme_tokens:
            viseme, start_text, segment_duration_text = token.split(":")
            start_ms = int(start_text)
            segment_duration_ms = int(segment_duration_text)
            if viseme not in {"a", "i", "u", "e", "o"}:
                return False, 0, 0
            if start_ms < previous_start or segment_duration_ms <= 0 or start_ms + segment_duration_ms > duration_ms:
                return False, 0, 0
            previous_start = start_ms
    except (KeyError, TypeError, ValueError):
        return False, 0, 0
    return True, len(viseme_tokens), len(boundaries)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate bounded avatar performance and VOICEVOX output.")
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
    summary = result["summary"]
    complete = (
        summary["dialogue_succeeded"] == summary["attempted"]
        and summary["speech_succeeded"] == summary["attempted"]
        and summary["speech_timings_valid"] == summary["attempted"]
        and summary["performance_matched"] == summary["attempted"]
        and summary["cue_timelines_valid"] == summary["attempted"]
    )
    return 0 if complete else 1


if __name__ == "__main__":
    sys.exit(main())
