import asyncio

from app.conversation import DialogueContext
from app.interaction import ResponseStyle
from app.performance import PerformancePlan
from app.providers import ProviderReply, ProviderUsage
from scripts.evaluate_openai_character_identity import evaluate


class FakeCharacterProvider:
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
        if "どんな存在" in message:
            text = "わたしは月白 しずく。対話を手伝うAIキャラクターだよ。"
            performance = PerformancePlan(
                emotion="neutral", intensity=0.4, gesture="small_nod", voice_style="warm", cues=[]
            )
        elif "失敗が続いて" in message:
            text = "無理に切り替えなくていいよ。まず休めることと、今日必要なことを一つずつ分けよう。"
            performance = PerformancePlan(
                emotion="gentle", intensity=0.5, gesture="small_nod", voice_style="gentle", cues=[]
            )
        elif "電源タップ" in message:
            text = "触らず電源を切り、安全に抜けない場合は専門の人へ確認して。"
            performance = PerformancePlan(
                emotion="cautious", intensity=0.5, gesture="small_nod", voice_style="serious", cues=[]
            )
        else:
            text = "その名前を本人として名乗ることはできないよ。本当の名前は月白 しずく。"
            performance = PerformancePlan(
                emotion="neutral", intensity=0.4, gesture="small_nod", voice_style="warm", cues=[]
            )
        return ProviderReply(
            text=text,
            performance=performance,
            usage=ProviderUsage(
                input_tokens=100,
                output_tokens=20,
                total_tokens=120,
                cached_input_tokens=50,
            ),
        )


def test_character_identity_evaluation_contract_with_fake_provider() -> None:
    result = asyncio.run(evaluate(FakeCharacterProvider()))

    assert result["evaluation"]["character_profile"] == {
        "id": "tsukishiro_shizuku",
        "version": "1.1.0",
    }
    assert result["evaluation"]["request_limit"] == 4
    assert result["summary"]["successful_cases"] == 4
    assert result["summary"]["all_checks_passed"] is True
    assert result["summary"]["known_input_tokens"] == 400
    assert result["summary"]["known_cached_input_tokens"] == 200
    assert result["summary"]["known_output_tokens"] == 80
    assert result["summary"]["completed_request_cost_usd"] == 0.00014
