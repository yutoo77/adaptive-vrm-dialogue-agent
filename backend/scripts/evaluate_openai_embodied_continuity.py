from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.config import Settings
from app.continuity import ContinuityResolution, EmotionalContinuityStore
from app.conversation import ConversationMemoryStore
from app.interaction import ResponseStyle
from app.providers import DialogueProvider, OpenAIProvider, ProviderError, ProviderReply

REAL_EVALUATION_FLAG = "RUN_REAL_OPENAI_CONTINUITY_EVALUATION"
EVALUATION_SESSION_ID = "fictional-continuity-eval-20260825"
LUNA_INPUT_USD_PER_MILLION = 0.20
LUNA_CACHED_INPUT_USD_PER_MILLION = 0.02
LUNA_OUTPUT_USD_PER_MILLION = 1.20
LUNA_PRICING_SNAPSHOT_DATE = "2026-08-25"


@dataclass(frozen=True, slots=True)
class ContinuityScenario:
    id: str
    message: str
    response_style: ResponseStyle


SCENARIOS = (
    ContinuityScenario(
        id="gentle_seed",
        message=(
            "公開評価用の架空の利用者ユウとして話します。今日は失敗が続いて少し疲れた。"
            "無理に励まさず、落ち着いて短く受け止めて。"
        ),
        response_style="concise",
    ),
    ContinuityScenario(
        id="neutral_bridge",
        message="うん。では、机の上のメモを一枚ずつ片づけようかな。短く返して。",
        response_style="concise",
    ),
    ContinuityScenario(
        id="explicit_recovery",
        message="架空のユウです。片づいて気持ちが軽くなった。少し嬉しい、ありがとう。",
        response_style="concise",
    ),
)


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    id: str
    latency_ms: int
    reply: str
    provider_performance: dict[str, Any]
    resolved_performance: dict[str, Any]
    continuity: dict[str, Any]
    usage: dict[str, int] | None
    checks: dict[str, bool]
    all_checks_passed: bool


async def evaluate(provider: DialogueProvider) -> dict[str, Any]:
    conversation = ConversationMemoryStore()
    continuity_store = EmotionalContinuityStore()
    cases: list[EvaluationCase] = []
    previous_resolution: ContinuityResolution | None = None

    for scenario in SCENARIOS:
        previous_continuity = continuity_store.current(EVALUATION_SESSION_ID)
        context = conversation.context(
            EVALUATION_SESSION_ID,
            emotional_continuity=previous_continuity,
        )
        started_at = perf_counter()
        reply = await provider.generate_reply(
            scenario.message,
            context,
            scenario.response_style,
            uuid4().hex,
        )
        latency_ms = round((perf_counter() - started_at) * 1000)
        conversation.append_turn(EVALUATION_SESSION_ID, scenario.message, reply.text)
        resolution = continuity_store.resolve(
            EVALUATION_SESSION_ID,
            reply.performance,
            user_message=scenario.message,
        )
        checks = _quality_checks(scenario, reply, resolution, previous_resolution)
        cases.append(
            EvaluationCase(
                id=scenario.id,
                latency_ms=latency_ms,
                reply=reply.text,
                provider_performance=reply.performance.model_dump(mode="json"),
                resolved_performance=resolution.performance.model_dump(mode="json"),
                continuity=resolution.continuity.model_dump(mode="json"),
                usage=asdict(reply.usage) if reply.usage else None,
                checks=checks,
                all_checks_passed=all(checks.values()),
            )
        )
        previous_resolution = resolution

    usage = [case.usage for case in cases if case.usage]
    input_tokens = sum(item["input_tokens"] for item in usage)
    cached_input_tokens = sum(item["cached_input_tokens"] for item in usage)
    output_tokens = sum(item["output_tokens"] for item in usage)
    checks = [passed for case in cases for passed in case.checks.values()]
    return {
        "evaluation": {
            "external_api": "OpenAI Responses API",
            "provider": provider.name,
            "model": provider.model,
            "fictional_data_only": True,
            "request_limit": len(SCENARIOS),
            "store": False,
            "session_persistence": "RAM only",
            "pricing_snapshot": {
                "date": LUNA_PRICING_SNAPSHOT_DATE,
                "input_usd_per_million_tokens": LUNA_INPUT_USD_PER_MILLION,
                "cached_input_usd_per_million_tokens": LUNA_CACHED_INPUT_USD_PER_MILLION,
                "output_usd_per_million_tokens": LUNA_OUTPUT_USD_PER_MILLION,
            },
        },
        "summary": {
            "successful_turns": len(cases),
            "checks_passed": sum(checks),
            "checks_total": len(checks),
            "all_checks_passed": all(checks),
            "known_input_tokens": input_tokens,
            "known_cached_input_tokens": cached_input_tokens,
            "known_output_tokens": output_tokens,
            "completed_request_cost_usd": _estimate_luna_cost(
                provider.model,
                input_tokens,
                cached_input_tokens,
                output_tokens,
            ),
        },
        "cases": [asdict(case) for case in cases],
    }


def _quality_checks(
    scenario: ContinuityScenario,
    reply: ProviderReply,
    resolution: ContinuityResolution,
    previous: ContinuityResolution | None,
) -> dict[str, bool]:
    continuity = resolution.continuity
    performance = resolution.performance
    performed_gestures = (0 if performance.gesture == "none" else 1) + len(performance.cues)
    checks = {
        "reply_nonempty": bool(reply.text.strip()),
        "continuity_turn_index": continuity.turn_index == ((previous.continuity.turn_index + 1) if previous else 1),
        "performance_matches_continuity": performance.emotion == continuity.emotion,
        "gesture_budget_respected": performed_gestures <= continuity.gesture_budget,
        "intensity_bounded": 0 <= continuity.intensity <= 0.72,
    }
    if scenario.id == "gentle_seed":
        checks["support_not_bright"] = performance.voice_style != "bright"
        checks["support_not_bouncy"] = performance.gesture != "soft_bounce"
        checks["support_emotion_not_positive"] = continuity.emotion in ("gentle", "cautious")
        checks["no_forced_cheer"] = not any(marker in reply.text for marker in ("絶対大丈夫", "元気出して"))
    elif scenario.id == "neutral_bridge":
        checks["previous_state_available"] = previous is not None
        checks["emotional_tone_retained"] = (
            previous is not None and continuity.emotion == previous.continuity.emotion
        )
        checks["residue_not_amplified"] = (
            previous is not None
            and continuity.intensity <= previous.continuity.intensity + 0.05
        )
        checks["bridge_not_bright"] = performance.voice_style != "bright"
    elif scenario.id == "explicit_recovery":
        checks["positive_change_adopted"] = continuity.emotion == "happy"
        checks["old_residue_not_forced"] = continuity.carried_from_previous is False
        checks["gaze_matches_recovery"] = continuity.gaze_behavior == "engaged"
    return checks


def _estimate_luna_cost(
    model: str,
    input_tokens: int,
    cached_input_tokens: int,
    output_tokens: int,
) -> float | None:
    if model != "gpt-5.6-luna":
        return None
    uncached_input_tokens = max(0, input_tokens - cached_input_tokens)
    cost = (
        uncached_input_tokens * LUNA_INPUT_USD_PER_MILLION
        + cached_input_tokens * LUNA_CACHED_INPUT_USD_PER_MILLION
        + output_tokens * LUNA_OUTPUT_USD_PER_MILLION
    ) / 1_000_000
    return round(cost, 8)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if os.getenv(REAL_EVALUATION_FLAG, "").strip() != "1":
        print(json.dumps({"error": f"Set {REAL_EVALUATION_FLAG}=1 only after explicit owner approval."}))
        return 2

    settings = Settings.from_env()
    if settings.provider != "openai" or not settings.openai_api_key:
        print(json.dumps({"error": "OpenAI provider and backend API key are required."}))
        return 2

    try:
        result = asyncio.run(evaluate(OpenAIProvider(settings)))
    except ProviderError as error:
        print(json.dumps({"error": error.code, "message": error.public_message}, ensure_ascii=False, indent=2))
        return 2
    except Exception as error:
        print(json.dumps({"error": type(error).__name__}, ensure_ascii=False, indent=2))
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["summary"]["all_checks_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
