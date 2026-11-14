import asyncio

from app.conversation import DialogueContext
from app.interaction import ResponseStyle
from app.performance import PerformancePlan
from app.providers import ProviderReply, ProviderUsage
from scripts.evaluate_openai_embodied_continuity import evaluate


class FakeContinuityProvider:
    name = "openai"
    model = "gpt-5.6-luna"
    ready = True
    configuration_message = None

    def __init__(self) -> None:
        self.contexts: list[DialogueContext] = []

    async def generate_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> ProviderReply:
        del response_style, request_id
        self.contexts.append(context)
        if "失敗が続いて" in message:
            text = "無理に切り替えなくていいよ。まず少し休もう。"
            performance = PerformancePlan(
                emotion="gentle", intensity=0.5, gesture="small_nod", voice_style="gentle", cues=[]
            )
        elif "メモ" in message:
            text = "うん、一枚ずつで大丈夫。"
            performance = PerformancePlan(
                emotion="neutral", intensity=0.35, gesture="small_nod", voice_style="warm", cues=[]
            )
        else:
            text = "少し軽くなったなら、わたしも嬉しいよ。"
            performance = PerformancePlan(
                emotion="happy", intensity=0.58, gesture="soft_bounce", voice_style="bright", cues=[]
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


def test_embodied_continuity_evaluation_contract_with_fake_provider() -> None:
    provider = FakeContinuityProvider()
    result = asyncio.run(evaluate(provider))

    assert result["evaluation"]["request_limit"] == 3
    assert result["evaluation"]["session_persistence"] == "RAM only"
    assert result["summary"]["successful_turns"] == 3
    assert result["summary"]["all_checks_passed"] is True
    assert result["summary"]["known_input_tokens"] == 300
    assert result["summary"]["known_cached_input_tokens"] == 150
    assert result["summary"]["known_output_tokens"] == 60
    assert result["summary"]["completed_request_cost_usd"] == 0.000105
    assert provider.contexts[0].emotional_continuity is None
    assert provider.contexts[1].emotional_continuity is not None
    assert provider.contexts[1].emotional_continuity.emotion == "gentle"
