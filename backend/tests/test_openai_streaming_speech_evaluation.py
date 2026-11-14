from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from app.conversation import DialogueContext
from app.interaction import ResponseStyle
from app.performance import PerformancePlan
from app.providers import (
    ProviderReply,
    ProviderStreamCompleted,
    ProviderStreamEvent,
    ProviderTextDelta,
    ProviderUsage,
)
from app.speech import SpeechHealth, SpeechSynthesisResult, SpeechTiming
from scripts.evaluate_openai_streaming_speech import _first_closed_sentence, evaluate

WAV = b"RIFF\x00\x00\x00\x00WAVE"


class FakeDialogueProvider:
    name = "openai"
    model = "gpt-5.6-luna"
    ready = True
    configuration_message = None

    async def generate_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> ProviderReply:
        del message, context, response_style, request_id
        raise AssertionError("The evaluation must use streaming.")

    async def stream_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        del message, context, response_style, request_id
        yield ProviderTextDelta("傘は玄関に置きます。")
        await asyncio.sleep(0.05)
        yield ProviderTextDelta("出発前に声に出して確認します。")
        yield ProviderStreamCompleted(
            ProviderReply(
                text="傘は玄関に置きます。出発前に声に出して確認します。",
                performance=PerformancePlan(
                    emotion="gentle",
                    intensity=0.4,
                    gesture="small_nod",
                    voice_style="warm",
                    cues=[],
                ),
                usage=ProviderUsage(input_tokens=20, output_tokens=10, total_tokens=30),
            )
        )


class FakeSpeechProvider:
    name = "voicevox"
    speaker_id = 14

    async def check_health(self) -> SpeechHealth:
        return SpeechHealth(available=True, engine_version="test", message="ready")

    async def synthesize(self, text: str, request_id: str) -> SpeechSynthesisResult:
        del request_id
        await asyncio.sleep(0.002)
        return SpeechSynthesisResult(
            audio=WAV,
            timing=SpeechTiming(
                duration_ms=len(text) * 100,
                phrase_boundaries_ms=(),
                visemes=(),
            ),
        )


def test_streaming_speech_evaluation_contract_with_fake_providers() -> None:
    result = asyncio.run(evaluate(FakeDialogueProvider(), FakeSpeechProvider()))

    assert result["evaluation"]["external_request_limit"] == 1
    assert result["evaluation"]["local_speech_requests"] == 2
    assert result["pipeline"]["first_sentence_characters"] < result["pipeline"]["reply_characters"]
    assert result["pipeline"]["all_checks_passed"] is True
    assert result["completed_request_cost_upper_bound_usd"] == 1.6e-05


def test_first_closed_sentence_keeps_repeated_punctuation_and_quote() -> None:
    assert _first_closed_sentence("『本当！？』 続き") == "『本当！？』"
    assert _first_closed_sentence("まだ途中") is None
