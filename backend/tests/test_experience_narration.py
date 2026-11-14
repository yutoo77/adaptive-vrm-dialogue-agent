from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from app.config import Settings
from app.conversation import DialogueContext, MemorySnippet
from app.experience import FINAL_CLUE, FIRST_CLUE, quiet_performance
from app.experience_narration import (
    EXPERIENCE_PROFILE,
    ExperienceNarrationContext,
    OpenAIExperienceNarrator,
    build_experience_narrator,
)
from app.experience_schemas import ExperienceMessage
from app.performance import StructuredDialogueOutput


class FakeClient:
    def __init__(self) -> None:
        self.responses = self
        self.calls: list[dict] = []
        self.closed = False

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            output_parsed=StructuredDialogueOutput(reply="少し考えてみよう。", performance=quiet_performance())
        )

    async def close(self) -> None:
        self.closed = True


def test_experience_adapter_has_its_own_instructions_and_one_request_without_stored_context() -> None:
    adapter = OpenAIExperienceNarrator(Settings(provider="openai", openai_api_key="fake-test-key"))
    assert adapter._client.max_retries == 0
    original_client = adapter._client
    client = FakeClient()
    adapter._client = client
    context = ExperienceNarrationContext(
        phase="active", inspected=("letter",), hint_level=0, arrangement=(None, None, None),
        revealed_clues=(FIRST_CLUE,),
        messages=(ExperienceMessage(role="user", text="手紙を調べる"),),
    )

    async def run() -> None:
        await original_client.close()
        result = await adapter.narrate("何が読める？", context, "request-experience-001")
        assert result.text == "少し考えてみよう。"
        await adapter.aclose()

    asyncio.run(run())
    assert len(client.calls) == 1 and client.closed
    call = client.calls[0]
    assert call["store"] is False
    assert call["text_format"] is StructuredDialogueOutput
    assert "tools" not in call and "previous_response_id" not in call and "conversation" not in call
    assert call["model"] == Settings().openai_model
    assert call["instructions"] == adapter._instructions("concise")
    assert "soft_bounceは禁止" in call["instructions"]
    assert "0.45以下" in call["instructions"]
    assert "通常の対話とは独立" in call["instructions"]
    assert FINAL_CLUE not in json.dumps(call, default=str, ensure_ascii=False)
    assert FIRST_CLUE in call["input"][0]["content"]
    assert call["input"][-1] == {"role": "user", "content": "何が読める？"}
    assert "long_term_memories" not in str(call["input"])
    assert EXPERIENCE_PROFILE.performance.maximum_intensity == 0.45


def test_transport_ignores_accidentally_provided_ordinary_memory_fields() -> None:
    items = OpenAIExperienceNarrator._input_items(
        "相談", DialogueContext(
            recent_messages=(), session_summary="体験専用データ",
            relevant_memories=(MemorySnippet(id="private", content="通常の個人情報"),),
        )
    )
    assert "通常の個人情報" not in str(items)
    assert "体験専用データ" in str(items)


def test_builder_only_enables_external_narration_with_explicit_real_configuration() -> None:
    assert build_experience_narrator(Settings(), allow_external=True) is None
    assert build_experience_narrator(Settings(provider="openai"), allow_external=True) is None
    assert build_experience_narrator(
        Settings(provider="openai", openai_api_key="fake-test"), allow_external=False
    ) is None
