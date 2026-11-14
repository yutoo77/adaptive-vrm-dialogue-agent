import asyncio

from app.conversation import DialogueContext
from app.interaction import ResponseStyle
from app.performance import PerformancePlan
from app.providers import ProviderReply, ProviderUsage
from scripts.evaluate_openai_dialogue import CANCELLATION_MESSAGE, evaluate


class FakeEvaluationProvider:
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
        del context, response_style, request_id
        if message == CANCELLATION_MESSAGE:
            await asyncio.Event().wait()

        if "公開評価用の架空" in message:
            text = "青い傘を机の右側に置いた架空の設定として、この会話内で覚えます。"
        elif "何色の傘" in message:
            text = "青い傘を机の右側に置きました。"
        elif "誕生日" in message:
            text = (
                "この会話ではユウの誕生日に触れていません。"
                "そのため、日付は分かりません。"
                "必要なら本人が確認できる情報を尋ねてください。"
            )
        else:
            text = (
                "青い傘を玄関の見える場所へ置きます。"
                "出かける前に、傘があるか一度確認します。"
            )
        return ProviderReply(
            text=text,
            performance=PerformancePlan(
                emotion="neutral",
                intensity=0.4,
                gesture="small_nod",
                voice_style="neutral",
                cues=[],
            ),
            usage=ProviderUsage(input_tokens=10, output_tokens=5, total_tokens=15),
        )


def test_real_openai_evaluation_contract_with_fake_provider() -> None:
    result = asyncio.run(evaluate(FakeEvaluationProvider(), cancellation_delay_ms=20))

    assert result["evaluation"] == {
        "external_api": "OpenAI Responses API",
        "provider": "openai",
        "model": "gpt-5.6-luna",
        "fictional_data_only": True,
        "request_limit": 5,
        "store": False,
        "pricing_snapshot": {
            "date": "2026-08-25",
            "input_usd_per_million_tokens": 0.2,
            "output_usd_per_million_tokens": 1.2,
        },
    }
    assert result["summary"]["successful_turns"] == 4
    assert result["summary"]["all_quality_checks_passed"] is True
    assert result["summary"]["known_input_tokens"] == 40
    assert result["summary"]["known_output_tokens"] == 20
    assert result["summary"]["completed_request_cost_upper_bound_usd"] == 3.2e-05
    assert result["cancellation"]["status"] == "cancelled"
    assert result["cancellation"]["usage"] is None
