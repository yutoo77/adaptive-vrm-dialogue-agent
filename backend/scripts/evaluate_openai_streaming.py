from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import asdict, dataclass
from time import perf_counter
from typing import Any
from uuid import uuid4

from app.config import Settings
from app.conversation import DialogueContext
from app.providers import (
    DialogueProvider,
    OpenAIProvider,
    ProviderError,
    ProviderStreamCompleted,
    ProviderTextDelta,
    stream_provider_reply,
)

REAL_STREAMING_EVALUATION_FLAG = "RUN_REAL_OPENAI_STREAMING_EVALUATION"
STREAMING_MESSAGE = (
    "公開評価用の架空設定です。ユウは青い傘を机の右側に置きました。"
    "忘れないための短い助言を、日本語で三文以内にしてください。"
)
CANCELLATION_MESSAGE = (
    "公開評価用の架空設定として、ユウが青い傘を忘れないための案を、"
    "理由と注意点を含めて詳しく説明してください。"
)
LUNA_INPUT_USD_PER_MILLION = 0.20
LUNA_OUTPUT_USD_PER_MILLION = 1.20
PRICING_SNAPSHOT_DATE = "2026-08-25"


@dataclass(frozen=True, slots=True)
class CancellationResult:
    status: str
    requested_after_ms: int
    settle_latency_ms: int
    usage_known: bool


async def evaluate(
    provider: DialogueProvider,
    cancellation_delay_ms: int = 100,
) -> dict[str, Any]:
    context = DialogueContext(recent_messages=(), session_summary=None, relevant_memories=())
    started_at = perf_counter()
    first_text_ms: int | None = None
    visible_text = ""
    delta_count = 0
    completed_reply = None

    async for event in stream_provider_reply(
        provider,
        STREAMING_MESSAGE,
        context,
        "balanced",
        uuid4().hex,
    ):
        if isinstance(event, ProviderTextDelta):
            if event.text and first_text_ms is None:
                first_text_ms = round((perf_counter() - started_at) * 1000)
            if event.text:
                visible_text += event.text
                delta_count += 1
        elif isinstance(event, ProviderStreamCompleted):
            completed_reply = event.reply

    text_complete_ms = round((perf_counter() - started_at) * 1000)
    if completed_reply is None:
        raise RuntimeError("Provider stream ended without a validated completion.")
    resolved_first_text_ms = first_text_ms if first_text_ms is not None else text_complete_ms
    usage = asdict(completed_reply.usage) if completed_reply.usage else None
    cancellation = await _evaluate_cancellation(provider, context, cancellation_delay_ms)
    checks = {
        "multiple_visible_deltas": delta_count >= 2,
        "first_text_before_completion": resolved_first_text_ms < text_complete_ms,
        "visible_text_matches_validated_reply": visible_text == completed_reply.text,
        "raw_structured_json_not_exposed": '"reply"' not in visible_text and '"performance"' not in visible_text,
        "performance_intensity_bounded": 0 <= completed_reply.performance.intensity <= 0.7,
        "performance_cues_bounded": len(completed_reply.performance.cues) <= 2,
    }
    input_tokens = usage["input_tokens"] if usage else 0
    output_tokens = usage["output_tokens"] if usage else 0

    return {
        "evaluation": {
            "external_api": "OpenAI Responses API streaming",
            "provider": provider.name,
            "model": provider.model,
            "fictional_data_only": True,
            "request_limit": 2,
            "store": False,
            "pricing_snapshot": {
                "date": PRICING_SNAPSHOT_DATE,
                "input_usd_per_million_tokens": LUNA_INPUT_USD_PER_MILLION,
                "output_usd_per_million_tokens": LUNA_OUTPUT_USD_PER_MILLION,
            },
        },
        "streaming": {
            "delta_count": delta_count,
            "first_text_ms": resolved_first_text_ms,
            "text_complete_ms": text_complete_ms,
            "lead_time_ms": text_complete_ms - resolved_first_text_ms,
            "reply_characters": len(completed_reply.text),
            "usage": usage,
            "completed_request_cost_upper_bound_usd": _estimate_cost(
                provider.model,
                input_tokens,
                output_tokens,
            ),
            "performance": completed_reply.performance.model_dump(mode="json"),
            "checks": checks,
            "all_checks_passed": all(checks.values()),
        },
        "cancellation": asdict(cancellation),
    }


async def _evaluate_cancellation(
    provider: DialogueProvider,
    context: DialogueContext,
    cancellation_delay_ms: int,
) -> CancellationResult:
    usage_known = False

    async def consume() -> None:
        nonlocal usage_known
        async for event in stream_provider_reply(
            provider,
            CANCELLATION_MESSAGE,
            context,
            "detailed",
            uuid4().hex,
        ):
            if isinstance(event, ProviderStreamCompleted):
                usage_known = event.reply.usage is not None

    task = asyncio.create_task(consume())
    await asyncio.sleep(cancellation_delay_ms / 1000)
    cancel_started_at = perf_counter()
    cancellation_requested = task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        return CancellationResult(
            status="cancelled",
            requested_after_ms=cancellation_delay_ms,
            settle_latency_ms=round((perf_counter() - cancel_started_at) * 1000),
            usage_known=False,
        )
    return CancellationResult(
        status="completed_before_cancel" if not cancellation_requested else "completed_after_cancel_request",
        requested_after_ms=cancellation_delay_ms,
        settle_latency_ms=round((perf_counter() - cancel_started_at) * 1000),
        usage_known=usage_known,
    )


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float | None:
    if model != "gpt-5.6-luna":
        return None
    estimated = (
        input_tokens * LUNA_INPUT_USD_PER_MILLION
        + output_tokens * LUNA_OUTPUT_USD_PER_MILLION
    ) / 1_000_000
    return round(estimated, 8)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one bounded paid OpenAI streaming evaluation with fictional data only."
    )
    parser.add_argument(
        "--cancel-delay-ms",
        type=int,
        default=100,
        choices=range(20, 2001),
        metavar="20..2000",
        help="Delay before cancelling the second and final provider request.",
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
    if os.getenv(REAL_STREAMING_EVALUATION_FLAG, "").strip() != "1":
        print(
            json.dumps(
                {"error": f"Set {REAL_STREAMING_EVALUATION_FLAG}=1 only after explicit owner approval."},
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
    passed = result["streaming"]["all_checks_passed"] and result["cancellation"]["status"] == "cancelled"
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
