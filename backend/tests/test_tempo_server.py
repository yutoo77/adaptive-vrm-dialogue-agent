from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.providers import ProviderError
from scripts.tempo_server import (
    CASES,
    EVALUATION_FLAG,
    MAX_REQUESTS,
    BoundedTempoProvider,
    create_app,
    create_mock_app,
)


def test_tempo_gate_precedes_configuration_and_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(EVALUATION_FLAG, raising=False)
    with patch("scripts.tempo_server.Settings.from_env") as settings:
        with pytest.raises(RuntimeError, match="owner approval"):
            create_app()
        settings.assert_not_called()


def test_tempo_rejects_missing_key_and_excessive_output_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(EVALUATION_FLAG, "1")
    for settings in (Settings(), Settings(provider="openai", openai_api_key="fake", max_output_tokens=1000)):
        with patch("scripts.tempo_server.Settings.from_env", return_value=settings):
            with patch("scripts.tempo_server.BoundedTempoProvider") as provider:
                with pytest.raises(RuntimeError):
                    create_app()
                provider.assert_not_called()


def test_tempo_only_reserves_fixed_inputs_and_bounds_attempts() -> None:
    with patch("app.providers.AsyncOpenAI", return_value=MagicMock()):
        provider = BoundedTempoProvider(Settings(openai_api_key="fake"))
    with pytest.raises(ProviderError, match="固定"):
        provider.reserve("unapproved input", "balanced")
    with pytest.raises(ProviderError, match="固定"):
        provider.reserve(CASES[0][1], "detailed")
    assert provider.attempts == 0
    for _, message in CASES:
        provider.reserve(message, "balanced")
    with pytest.raises(ProviderError, match="上限"):
        provider.reserve(CASES[0][1], "balanced")
    assert provider.attempts == MAX_REQUESTS


def test_mock_tempo_ignores_openai_environment_and_uses_empty_ram_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIALOGUE_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-be-used")
    with patch("app.providers.AsyncOpenAI") as sdk:
        with TestClient(create_mock_app()) as client:
            assert client.get("/api/health").json()["provider"] == "mock"
            assert client.get("/api/evaluation/tempo").json()["provider"] == "mock"
            assert client.get("/api/memories").json()["items"] == []
        sdk.assert_not_called()
