import asyncio
from collections.abc import AsyncIterator

from app.conversation import DialogueContext
from app.interaction import ResponseStyle
from app.performance import PerformancePlan
from app.providers import ProviderReply, ProviderStreamCompleted, ProviderStreamEvent, ProviderTextDelta, ProviderUsage
from scripts.evaluate_openai_streaming import CANCELLATION_MESSAGE, evaluate


class FakeStreamingEvaluationProvider:
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
        raise AssertionError("The evaluation must use the streaming provider path.")

    async def stream_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        del context, response_style, request_id
        if message == CANCELLATION_MESSAGE:
            await asyncio.Event().wait()
        yield ProviderTextDelta("青い傘は")
        await asyncio.sleep(0.001)
        yield ProviderTextDelta("見える場所へ置きます。")
        yield ProviderStreamCompleted(
            ProviderReply(
                text="青い傘は見える場所へ置きます。",
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


def test_real_openai_streaming_evaluation_contract_with_fake_provider() -> None:
    result = asyncio.run(evaluate(FakeStreamingEvaluationProvider(), cancellation_delay_ms=20))

    assert result["evaluation"]["request_limit"] == 2
    assert result["evaluation"]["fictional_data_only"] is True
    assert result["streaming"]["delta_count"] == 2
    assert result["streaming"]["lead_time_ms"] >= 1
    assert result["streaming"]["all_checks_passed"] is True
    assert result["streaming"]["completed_request_cost_upper_bound_usd"] == 1.6e-05
    assert result["cancellation"]["status"] == "cancelled"
    assert result["cancellation"]["usage_known"] is False
