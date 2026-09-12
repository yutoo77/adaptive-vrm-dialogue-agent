from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.persistent_memory import PersistentMemoryStore
from app.transcription import FasterWhisperTranscriptionProvider, TranscriptionProviderError


def test_preparation_uses_only_cached_model_and_never_transcribes() -> None:
    model = SimpleNamespace(transcribe=Mock())
    provider = FasterWhisperTranscriptionProvider(Settings())
    with patch("app.transcription.WhisperModel", return_value=model) as factory:
        assert not provider.model_loaded
        provider.prepare()
        provider.prepare()
        assert provider.model_loaded
        factory.assert_called_once_with("small", device="cpu", compute_type="int8", local_files_only=True)
        model.transcribe.assert_not_called()


def test_cache_miss_does_not_retry_with_downloads_and_releases_capacity() -> None:
    provider = FasterWhisperTranscriptionProvider(Settings())
    with patch("app.transcription.WhisperModel", side_effect=RuntimeError("private-path")) as factory:
        with pytest.raises(TranscriptionProviderError) as error:
            provider.prepare()
        assert error.value.code == "transcription_model_not_cached"
        assert "private-path" not in error.value.public_message
        assert not provider.model_loaded
        factory.assert_called_once_with("small", device="cpu", compute_type="int8", local_files_only=True)
        factory.side_effect = None
        provider.prepare()
        assert provider.model_loaded


def test_preparation_and_recording_share_capacity_without_queuing() -> None:
    entered, release = Event(), Event()

    def load(*_args, **_kwargs):
        entered.set()
        assert release.wait(5)
        return SimpleNamespace()

    provider = FasterWhisperTranscriptionProvider(Settings())
    with patch("app.transcription.WhisperModel", side_effect=load), ThreadPoolExecutor(1) as pool:
        first = pool.submit(provider.prepare)
        try:
            assert entered.wait(3)
            with pytest.raises(TranscriptionProviderError, match="前の音声"):
                provider.transcribe(b"not-started", "audio/webm", "test")
            with pytest.raises(TranscriptionProviderError) as busy:
                provider.prepare()
            assert busy.value.code == "transcription_busy"
        finally:
            release.set()
        first.result(timeout=3)


@pytest.mark.parametrize("cached", [True, False])
def test_preparation_api_is_explicit_safe_and_does_not_touch_conversation(cached: bool) -> None:
    with patch("app.persistent_memory.PersistentMemoryStore", side_effect=PersistentMemoryStore.in_memory):
        from app.main import create_app
    provider = FasterWhisperTranscriptionProvider(Settings())
    model = SimpleNamespace(transcribe=Mock())
    with patch("app.transcription.WhisperModel", return_value=model) as factory:
        if not cached:
            factory.side_effect = RuntimeError("private-model-path")
        with TestClient(
            create_app(
                settings=Settings(),
                transcription_provider=provider,
                persistent_memory_store=PersistentMemoryStore.in_memory(),
            )
        ) as client:
            health = client.get("/api/transcription/health")
            assert not health.json()["model_loaded"]
            factory.assert_not_called()
            response = client.post("/api/transcription/prepare")
            if cached:
                assert response.status_code == 200
                assert response.json()["model_loaded"]
                assert response.headers["cache-control"] == "no-store"
                assert client.post("/api/transcription/prepare").status_code == 200
            else:
                assert response.status_code == 503
                assert response.json()["detail"]["code"] == "transcription_model_not_cached"
                assert "private-model-path" not in response.text
            assert client.get("/api/transcription/health").json()["model_loaded"] is cached
            assert client.get("/api/health").status_code == 200
            assert factory.call_count == 1
            model.transcribe.assert_not_called()
