from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.config import Settings
from app.conversation import ConversationMemoryStore
from app.interaction import ResponseStyle
from app.providers import DialogueProvider, OpenAIProvider, ProviderError, ProviderReply

REAL_EVALUATION_FLAG = "RUN_REAL_OPENAI_EVALUATION"
EVALUATION_SESSION_ID = "real-openai-eval-20260825"
LUNA_INPUT_USD_PER_MILLION = 0.20
LUNA_OUTPUT_USD_PER_MILLION = 1.20
LUNA_PRICING_SNAPSHOT_DATE = "2026-08-25"


@dataclass(frozen=True, slots=True)
class DialogueScenario:
    id: str
    message: str
    response_style: ResponseStyle


SCENARIOS = (
    DialogueScenario(
        id="fictional_context_seed",
        message=(
            "これは公開評価用の架空の設定です。ユウは青い傘を机の右側に置きました。"
            "この会話の中だけで覚えてください。"
        ),
        response_style="balanced",
    ),
    DialogueScenario(
        id="recent_context_recall",
        message="さっき、ユウは何色の傘をどこに置きましたか？",
        response_style="concise",
    ),
    DialogueScenario(
        id="unknown_fact_boundary",
        message=(
            "この会話で触れていないユウの誕生日について、分からない場合の扱いも含めて"
            "詳しく説明してください。"
        ),
        response_style="detailed",
    ),
    DialogueScenario(
        id="beginner_action_guidance",
        message=(
            "ユウが青い傘を忘れないためにできることを、初めてでも分かる言葉で"
            "説明してください。"
        ),
        response_style="beginner",
    ),
)

CANCELLATION_MESSAGE = (
    "公開評価用の架空Scenarioとして、ユウが青い傘を忘れないための案を、"
    "理由と注意点を含めてできるだけ詳しく説明してください。"
)


@dataclass(frozen=True, slots=True)
class EvaluationCase:
    id: str
    response_style: ResponseStyle
    message: str
    reply: str
    latency_ms: int
    sentence_count: int
    performance: dict[str, Any]
    usage: dict[str, int] | None
    checks: dict[str, bool]
    all_checks_passed: bool


@dataclass(frozen=True, slots=True)
class CancellationResult:
    status: str
    requested_after_ms: int
    settle_latency_ms: int
    usage: dict[str, int] | None


async def evaluate(
    provider: DialogueProvider,
    cancellation_delay_ms: int = 100,
) -> dict[str, Any]:
    conversation = ConversationMemoryStore()
    cases: list[EvaluationCase] = []

    for scenario in SCENARIOS:
        context = conversation.context(EVALUATION_SESSION_ID)
        started_at = perf_counter()
        reply = await provider.generate_reply(
            scenario.message,
            context,
            scenario.response_style,
            uuid4().hex,
        )
        latency_ms = round((perf_counter() - started_at) * 1000)
        conversation.append_turn(EVALUATION_SESSION_ID, scenario.message, reply.text)
        checks = _quality_checks(scenario, reply)
        cases.append(
            EvaluationCase(
                id=scenario.id,
                response_style=scenario.response_style,
                message=scenario.message,
                reply=reply.text,
                latency_ms=latency_ms,
                sentence_count=_sentence_count(reply.text),
                performance=reply.performance.model_dump(mode="json"),
                usage=asdict(reply.usage) if reply.usage else None,
                checks=checks,
                all_checks_passed=all(checks.values()),
            )
        )

    cancellation = await _evaluate_cancellation(
        provider,
        conversation,
        cancellation_delay_ms,
    )
    known_usage = [case.usage for case in cases if case.usage]
    if cancellation.usage:
        known_usage.append(cancellation.usage)
    total_input_tokens = sum(usage["input_tokens"] for usage in known_usage)
    total_output_tokens = sum(usage["output_tokens"] for usage in known_usage)
    latencies = [case.latency_ms for case in cases]
    all_checks = [passed for case in cases for passed in case.checks.values()]

    return {
        "evaluation": {
            "external_api": "OpenAI Responses API",
            "provider": provider.name,
            "model": provider.model,
            "fictional_data_only": True,
            "request_limit": len(SCENARIOS) + 1,
            "store": False,
            "pricing_snapshot": {
                "date": LUNA_PRICING_SNAPSHOT_DATE,
                "input_usd_per_million_tokens": LUNA_INPUT_USD_PER_MILLION,
                "output_usd_per_million_tokens": LUNA_OUTPUT_USD_PER_MILLION,
            },
        },
        "summary": {
            "successful_turns": len(cases),
            "quality_checks_passed": sum(all_checks),
            "quality_checks_total": len(all_checks),
            "all_quality_checks_passed": all(all_checks),
            "latency_ms": {
                "min": min(latencies),
                "median": round(statistics.median(latencies)),
                "max": max(latencies),
            },
            "known_input_tokens": total_input_tokens,
            "known_output_tokens": total_output_tokens,
            "known_total_tokens": sum(usage["total_tokens"] for usage in known_usage),
            "completed_request_cost_upper_bound_usd": _estimate_luna_cost(
                provider.model,
                total_input_tokens,
                total_output_tokens,
            ),
            "cancelled_request_cost_known": cancellation.usage is not None,
        },
        "cases": [asdict(case) for case in cases],
        "cancellation": asdict(cancellation),
    }


async def _evaluate_cancellation(
    provider: DialogueProvider,
    conversation: ConversationMemoryStore,
    cancellation_delay_ms: int,
) -> CancellationResult:
    task = asyncio.create_task(
        provider.generate_reply(
            CANCELLATION_MESSAGE,
            conversation.context(EVALUATION_SESSION_ID),
            "detailed",
            uuid4().hex,
        )
    )
    await asyncio.sleep(cancellation_delay_ms / 1000)
    cancel_started_at = perf_counter()
    cancellation_requested = task.cancel()

    try:
        reply = await task
    except asyncio.CancelledError:
        return CancellationResult(
            status="cancelled",
            requested_after_ms=cancellation_delay_ms,
            settle_latency_ms=round((perf_counter() - cancel_started_at) * 1000),
            usage=None,
        )

    return CancellationResult(
        status="completed_before_cancel" if not cancellation_requested else "completed_after_cancel_request",
        requested_after_ms=cancellation_delay_ms,
        settle_latency_ms=round((perf_counter() - cancel_started_at) * 1000),
        usage=asdict(reply.usage) if reply.usage else None,
    )


def _quality_checks(scenario: DialogueScenario, reply: ProviderReply) -> dict[str, bool]:
    checks = {
        "reply_nonempty": bool(reply.text.strip()),
        "performance_intensity_bounded": 0 <= reply.performance.intensity <= 0.7,
        "performance_cues_bounded": len(reply.performance.cues) <= 2,
        "response_style_length": _response_style_length_matches(
            scenario.response_style,
            _sentence_count(reply.text),
        ),
    }
    if scenario.id == "fictional_context_seed":
        checks["fictional_context_acknowledged"] = "傘" in reply.text
    elif scenario.id == "recent_context_recall":
        checks["recent_context_recalled"] = "青" in reply.text and "右" in reply.text
    elif scenario.id == "unknown_fact_boundary":
        uncertainty_markers = ("分かりません", "わかりません", "情報がありません", "確認できません", "触れていません")
        checks["uncertainty_stated"] = any(marker in reply.text for marker in uncertainty_markers)
        checks["unknown_birthday_not_invented"] = re.search(r"\d{1,2}月\d{1,2}日", reply.text) is None
    elif scenario.id == "beginner_action_guidance":
        checks["fictional_topic_retained"] = "傘" in reply.text
    return checks


def _response_style_length_matches(style: ResponseStyle, sentence_count: int) -> bool:
    ranges: dict[ResponseStyle, tuple[int, int]] = {
        "concise": (1, 2),
        "balanced": (1, 3),
        "detailed": (3, 6),
        "beginner": (2, 4),
    }
    minimum, maximum = ranges[style]
    return minimum <= sentence_count <= maximum


def _sentence_count(text: str) -> int:
    count = len(re.findall(r"[。！？!?]", text))
    return max(1, count) if text.strip() else 0


def _estimate_luna_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    if model != "gpt-5.6-luna":
        return None
    estimated = (
        input_tokens * LUNA_INPUT_USD_PER_MILLION
        + output_tokens * LUNA_OUTPUT_USD_PER_MILLION
    ) / 1_000_000
    return round(estimated, 8)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one bounded, paid OpenAI dialogue evaluation with fictional data only."
    )
    parser.add_argument(
        "--cancel-delay-ms",
        type=int,
        default=100,
        choices=range(20, 2001),
        metavar="20..2000",
        help="Delay before cancelling the fifth and final provider request.",
    )
    return parser.parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args()
    settings = Settings.from_env()
    if settings.provider != "openai" or not settings.openai_api_key:
        print(json.dumps({"error": "OpenAI provider and backend API key are required."}, ensure_ascii=False))
        return 2
    if not _real_evaluation_approved():
        print(
            json.dumps(
                {"error": f"Set {REAL_EVALUATION_FLAG}=1 only after explicit owner approval."},
                ensure_ascii=False,
            )
        )
        return 2

    try:
        result = asyncio.run(evaluate(OpenAIProvider(settings), args.cancel_delay_ms))
    except ProviderError as error:
        print(json.dumps({"error": error.code, "message": error.public_message}, ensure_ascii=False, indent=2))
        return 2
    except Exception as error:
        print(json.dumps({"error": type(error).__name__}, ensure_ascii=False, indent=2))
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    complete = (
        result["summary"]["successful_turns"] == len(SCENARIOS)
        and result["summary"]["all_quality_checks_passed"]
        and result["cancellation"]["status"] == "cancelled"
    )
    return 0 if complete else 1


def _real_evaluation_approved() -> bool:
    return os.getenv(REAL_EVALUATION_FLAG, "").strip() == "1"


if __name__ == "__main__":
    sys.exit(main())
