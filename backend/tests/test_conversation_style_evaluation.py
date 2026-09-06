import asyncio
from unittest.mock import patch

import pytest

from app.providers import MockProvider, ProviderError
from scripts.evaluate_conversation_style import EVALUATION_FLAG, SCENARIOS, evaluate, main


def test_style_evaluation_is_bounded_and_only_carries_the_last_three_turns() -> None:
    result = asyncio.run(evaluate(MockProvider()))
    assert result["request_limit"] == len(SCENARIOS) == 9
    assert result["completed_cases"] == 9
    assert [row["history_messages"] for row in result["cases"]] == [0, 0, 0, 0, 0, 0, 0, 2, 4]
    assert all(row["checks"]["stream_matches_final"] for row in result["cases"])


def test_style_evaluation_stops_after_provider_failure() -> None:
    class FailingProvider(MockProvider):
        async def generate_reply(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            raise ProviderError(503, "test_failure", "not a real failure")

    result = asyncio.run(evaluate(FailingProvider()))
    assert len(result["cases"]) == 1
    assert result["cases"][0]["error"] == "test_failure"
    assert result["completed_cases"] == 0
    assert result["all_checks_passed"] is False


def test_identity_refinement_has_only_two_fixed_independent_cases() -> None:
    result = asyncio.run(evaluate(MockProvider(), identity_only=True))
    assert result["request_limit"] == result["completed_cases"] == 2
    assert [row["id"] for row in result["cases"]] == ["identity", "identity_transfer"]
    assert all(row["history_messages"] == 0 for row in result["cases"])


def test_style_evaluation_gate_precedes_configuration_and_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(EVALUATION_FLAG, raising=False)
    with patch("scripts.evaluate_conversation_style.Settings.from_env") as settings:
        assert main() == 2
        settings.assert_not_called()
