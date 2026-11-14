from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import asdict
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
from app.speech import (
    SpeechProvider,
    SpeechProviderError,
    SpeechSynthesisResult,
    VoicevoxSpeechProvider,
)
from scripts.evaluate_openai_streaming import _estimate_cost

REAL_STREAMING_SPEECH_EVALUATION_FLAG = "RUN_REAL_OPENAI_SPEECH_EVALUATION"
STREAMING_SPEECH_MESSAGE = (
    "公開評価用の架空設定です。ユウが青い傘を忘れないための助言を、"
    "一文目だけでも意味が完結する自然な日本語二文で返してください。"
)
SENTENCE_ENDINGS = frozenset("。！？!?\n")
TRAILING_CLOSERS = frozenset("」』）)】]〉》”’")


async def evaluate(
    dialogue_provider: DialogueProvider,
    speech_provider: SpeechProvider,
) -> dict[str, Any]:
    health = await speech_provider.check_health()
    if not health.available:
        raise RuntimeError(health.message)

    context = DialogueContext(recent_messages=(), session_summary=None, relevant_memories=())
    started_at = perf_counter()
    first_text_ms: int | None = None
    first_sentence_ms: int | None = None
    visible_text = ""
    delta_count = 0
    completed_reply = None
    first_sentence = ""
    first_speech_task: asyncio.Task[tuple[SpeechSynthesisResult, int]] | None = None

    async def synthesize_first(text: str) -> tuple[SpeechSynthesisResult, int]:
        result = await speech_provider.synthesize(text, uuid4().hex)
        return result, _elapsed_ms(started_at)

    async for event in stream_provider_reply(
        dialogue_provider,
        STREAMING_SPEECH_MESSAGE,
        context,
        "balanced",
        uuid4().hex,
    ):
        if isinstance(event, ProviderTextDelta):
            if not event.text:
                continue
            if first_text_ms is None:
                first_text_ms = _elapsed_ms(started_at)
            visible_text += event.text
            delta_count += 1
            if first_speech_task is None:
                first_sentence = _first_closed_sentence(visible_text) or ""
                if first_sentence:
                    first_sentence_ms = _elapsed_ms(started_at)
                    first_speech_task = asyncio.create_task(synthesize_first(first_sentence))
        elif isinstance(event, ProviderStreamCompleted):
            completed_reply = event.reply

    text_complete_ms = _elapsed_ms(started_at)
    if completed_reply is None:
        raise RuntimeError("Provider stream ended without a validated completion.")
    if first_speech_task is None or first_sentence_ms is None:
        raise RuntimeError("The response did not produce a closed first sentence.")

    first_speech, first_speech_ready_ms = await first_speech_task
    full_synthesis_started_at = perf_counter()
    full_speech = await speech_provider.synthesize(completed_reply.text, uuid4().hex)
    full_synthesis_ms = _elapsed_ms(full_synthesis_started_at)
    baseline_full_speech_ready_ms = text_complete_ms + full_synthesis_ms
    usage = asdict(completed_reply.usage) if completed_reply.usage else None
    input_tokens = usage["input_tokens"] if usage else 0
    output_tokens = usage["output_tokens"] if usage else 0
    checks = {
        "multiple_visible_deltas": delta_count >= 2,
        "visible_text_matches_validated_reply": visible_text == completed_reply.text,
        "first_sentence_before_completion": first_sentence_ms < text_complete_ms,
        "first_sentence_is_strict_prefix": completed_reply.text.startswith(first_sentence)
        and len(first_sentence) < len(completed_reply.text),
        "first_sentence_wav_valid": _is_wav(first_speech.audio),
        "full_reply_wav_valid": _is_wav(full_speech.audio),
    }

    return {
        "evaluation": {
            "external_api": "OpenAI Responses API streaming",
            "external_request_limit": 1,
            "local_speech_requests": 2,
            "provider": dialogue_provider.name,
            "model": dialogue_provider.model,
            "speech_provider": speech_provider.name,
            "speaker_id": speech_provider.speaker_id,
            "fictional_data_only": True,
            "store": False,
        },
        "pipeline": {
            "delta_count": delta_count,
            "first_text_ms": first_text_ms,
            "first_sentence_closed_ms": first_sentence_ms,
            "first_sentence_synthesis_ms": first_speech_ready_ms - first_sentence_ms,
            "first_sentence_speech_ready_ms": first_speech_ready_ms,
            "text_complete_ms": text_complete_ms,
            "full_reply_synthesis_ms": full_synthesis_ms,
            "baseline_full_speech_ready_ms": baseline_full_speech_ready_ms,
            "projected_speech_ready_lead_ms": baseline_full_speech_ready_ms - first_speech_ready_ms,
            "first_sentence_characters": len(first_sentence),
            "reply_characters": len(completed_reply.text),
            "first_sentence_audio_duration_ms": getattr(first_speech.timing, "duration_ms", None),
            "full_reply_audio_duration_ms": getattr(full_speech.timing, "duration_ms", None),
            "checks": checks,
            "all_checks_passed": all(checks.values()),
        },
        "usage": usage,
        "completed_request_cost_upper_bound_usd": _estimate_cost(
            dialogue_provider.model,
            input_tokens,
            output_tokens,
        ),
    }


def _first_closed_sentence(value: str) -> str | None:
    for index, character in enumerate(value):
        if character not in SENTENCE_ENDINGS:
            continue
        end = index + 1
        while end < len(value) and value[end] in SENTENCE_ENDINGS:
            end += 1
        while end < len(value) and value[end] in TRAILING_CLOSERS:
            end += 1
        sentence = value[:end].strip()
        return sentence or None
    return None


def _elapsed_ms(started_at: float) -> int:
    return max(0, round((perf_counter() - started_at) * 1000))


def _is_wav(value: bytes) -> bool:
    return len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WAVE"


def parse_args() -> argparse.Namespace:
    return argparse.ArgumentParser(
        description="Run one bounded OpenAI plus local VOICEVOX streaming-speech evaluation."
    ).parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parse_args()
    if os.getenv(REAL_STREAMING_SPEECH_EVALUATION_FLAG, "").strip() != "1":
        print(
            json.dumps(
                {
                    "error": (
                        f"Set {REAL_STREAMING_SPEECH_EVALUATION_FLAG}=1 only after explicit owner approval."
                    )
                },
                ensure_ascii=False,
            )
        )
        return 2
    settings = Settings.from_env()
    if settings.provider != "openai" or not settings.openai_api_key:
        print(json.dumps({"error": "OpenAI provider and Backend API key are required."}, ensure_ascii=False))
        return 2

    try:
        result = asyncio.run(_evaluate_with_owned_speech(settings))
    except (ProviderError, SpeechProviderError) as error:
        print(
            json.dumps(
                {
                    "error": getattr(error, "code", type(error).__name__),
                    "message": getattr(error, "public_message", str(error)),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 2
    except Exception as error:
        print(json.dumps({"error": type(error).__name__}, ensure_ascii=False, indent=2))
        return 2

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["pipeline"]["all_checks_passed"] else 1


async def _evaluate_with_owned_speech(settings: Settings) -> dict[str, Any]:
    speech = VoicevoxSpeechProvider(settings)
    try:
        return await evaluate(OpenAIProvider(settings), speech)
    finally:
        await speech.aclose()


if __name__ == "__main__":
    sys.exit(main())
