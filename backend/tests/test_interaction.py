from __future__ import annotations

import pytest

from app.interaction import (
    RESPONSE_STYLE_INSTRUCTIONS,
    ResponseStyle,
    apply_mock_response_style,
    response_style_instruction,
)


@pytest.mark.parametrize("style", ["concise", "balanced", "detailed", "beginner"])
def test_every_response_style_has_an_explicit_instruction(style: ResponseStyle) -> None:
    instruction = response_style_instruction(style)

    assert f"応答スタイルは{style}" in instruction
    assert set(RESPONSE_STYLE_INSTRUCTIONS) == {"concise", "balanced", "detailed", "beginner"}


def test_mock_response_style_changes_length_without_hiding_the_base_answer() -> None:
    reply = "結論です。これは補足です。"

    concise = apply_mock_response_style(reply, "concise")
    balanced = apply_mock_response_style(reply, "balanced")
    detailed = apply_mock_response_style(reply, "detailed")
    beginner = apply_mock_response_style(reply, "beginner")

    assert concise == "結論です。"
    assert balanced == reply
    assert detailed.startswith(reply)
    assert len(detailed) > len(balanced)
    assert beginner.startswith(reply)
    assert "短い説明" in beginner
