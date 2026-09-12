import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pytest

from app.config import Settings
from app.persistent_memory import PersistentMemoryStore
from app.transcription import FasterWhisperTranscriptionProvider, TranscriptionProviderError


def model_result(text: str = "架空のテスト文") -> tuple[list[SimpleNamespace], SimpleNamespace]:
    return [SimpleNamespace(text=text)], SimpleNamespace(language="ja", language_probability=1, duration=1)


@pytest.mark.parametrize("stage", ["load", "decode", "segments"])
def test_busy_rejects_instead_of_queuing_at_every_expensive_stage(stage: str) -> None:
    entered, release = Event(), Event()

    def wait() -> None:
        entered.set()
        assert release.wait(5), "Test must release its fake worker"

    def decode(*_args: object, **_kwargs: object) -> tuple[object, SimpleNamespace]:
        if stage == "decode":
            wait()
        segments, info = model_result()
        if stage == "segments":
            def iterate():
                wait()
                yield from segments
            return iterate(), info
        return segments, info

    model = SimpleNamespace(transcribe=Mock(side_effect=decode))

    def load(*_args: object, **_kwargs: object) -> object:
        if stage == "load":
            wait()
        return model

    provider = FasterWhisperTranscriptionProvider(Settings())
    with patch("app.transcription.WhisperModel", side_effect=load) as factory, ThreadPoolExecutor(2) as pool:
        first = pool.submit(provider.transcribe, b"first", "audio/webm", "first")
        try:
            assert entered.wait(3)
            extra = pool.submit(provider.transcribe, b"discard", "audio/webm", "second")
            with pytest.raises(TranscriptionProviderError) as error:
                extra.result(timeout=1)
            assert error.value.status_code == 429
            assert error.value.code == "transcription_busy"
            assert factory.call_count == 1
            assert model.transcribe.call_count == (0 if stage == "load" else 1)
        finally:
            release.set()
        assert first.result(timeout=3).text == "架空のテスト文"
        assert provider.transcribe(b"next", "audio/webm", "next").text == "架空のテスト文"
        assert factory.call_count == 1


@pytest.mark.parametrize("failure", ["load", "decode", "empty"])
def test_failed_recognition_releases_capacity_for_retry(failure: str) -> None:
    model = SimpleNamespace(transcribe=Mock(return_value=model_result()))
    provider = FasterWhisperTranscriptionProvider(Settings())
    with patch("app.transcription.WhisperModel", return_value=model) as factory:
        if failure == "load":
            factory.side_effect = [RuntimeError("internal-path-not-for-user"), model]
        elif failure == "decode":
            model.transcribe.side_effect = [RuntimeError("internal-path-not-for-user"), model_result()]
        else:
            model.transcribe.side_effect = [model_result(""), model_result()]
        with pytest.raises(TranscriptionProviderError) as error:
            provider.transcribe(b"bad", "audio/webm", "bad")
        expected_code = {"load": "transcription_model_unavailable", "decode": "invalid_audio", "empty": "no_speech"}
        assert error.value.code == expected_code[failure]
        assert "internal-path" not in error.value.public_message
        assert provider.transcribe(b"good", "audio/webm", "good").text == "架空のテスト文"


def test_cancelling_http_await_does_not_release_running_worker_capacity() -> None:
    entered, release, finished = Event(), Event(), Event()
    calls = 0

    def decode(*_args: object, **_kwargs: object):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            assert release.wait(5)
            finished.set()
        return model_result()

    async def run() -> None:
        # Import-time default app must not open the owner's DB in this isolated test.
        with patch("app.persistent_memory.PersistentMemoryStore", side_effect=PersistentMemoryStore.in_memory):
            from app.main import create_app
        app = create_app(settings=Settings(), transcription_provider=FasterWhisperTranscriptionProvider(Settings()),
                         persistent_memory_store=PersistentMemoryStore.in_memory())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def post():
                return await client.post("/api/transcription", files={"audio": ("fake.webm", b"fake", "audio/webm")})

            first = asyncio.create_task(post())
            try:
                assert await asyncio.to_thread(entered.wait, 3)
                first.cancel()
                with suppress(asyncio.CancelledError):
                    await first
                busy = await asyncio.wait_for(post(), timeout=1)
                assert busy.status_code == 429
                assert busy.json()["detail"]["code"] == "transcription_busy"
                assert len(busy.json()["detail"]["request_id"]) == 32
                assert calls == 1
                health = await client.get("/api/transcription/health")
                assert health.status_code == 200
            finally:
                release.set()
                first.cancel()
                with suppress(asyncio.CancelledError):
                    await first
            assert await asyncio.to_thread(finished.wait, 3)
            # Completion flag is set just before the worker returns; allow that return to finish.
            for _attempt in range(100):
                response = await post()
                if response.status_code != 429:
                    break
                await asyncio.sleep(0.01)
            assert response.status_code == 200
            assert calls == 2

    with patch("app.transcription.WhisperModel", return_value=SimpleNamespace(transcribe=decode)):
        asyncio.run(run())
