from fastapi.testclient import TestClient

from app.config import Settings
from app.main import MAX_TRANSCRIPTION_BYTES, create_app
from app.transcription import TranscriptionProviderError, TranscriptionResult


class WorkingTranscriptionProvider:
    name = "faster-whisper"
    model_name = "small"
    device = "cpu"
    compute_type = "int8"
    model_loaded = True

    def transcribe(self, audio: bytes, media_type: str, request_id: str) -> TranscriptionResult:
        assert audio == b"recorded-audio"
        assert media_type == "audio/webm"
        assert len(request_id) == 32
        return TranscriptionResult(
            text="こんにちは",
            language="ja",
            language_probability=0.98,
            audio_duration_seconds=1.25,
        )


class FailingTranscriptionProvider(WorkingTranscriptionProvider):
    def transcribe(self, audio: bytes, media_type: str, request_id: str) -> TranscriptionResult:
        del audio, media_type, request_id
        raise TranscriptionProviderError(422, "no_speech", "音声を認識できませんでした。")


def build_client(provider: WorkingTranscriptionProvider | None = None) -> TestClient:
    return TestClient(
        create_app(
            settings=Settings(),
            transcription_provider=provider or WorkingTranscriptionProvider(),
        )
    )


def test_transcription_health_reports_local_model_without_loading_audio() -> None:
    response = build_client().get("/api/transcription/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "provider": "faster-whisper",
        "model": "small",
        "device": "cpu",
        "compute_type": "int8",
        "model_loaded": True,
        "message": "音声はLocal Backend内で認識し、保存しません。",
    }


def test_transcription_accepts_browser_audio_and_returns_traceable_text() -> None:
    response = build_client().post(
        "/api/transcription",
        files={"audio": ("recording.webm", b"recorded-audio", "audio/webm;codecs=opus")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["text"] == "こんにちは"
    assert payload["language"] == "ja"
    assert payload["language_probability"] == 0.98
    assert payload["audio_duration_seconds"] == 1.25
    assert len(payload["request_id"]) == 32
    assert payload["latency_ms"] >= 0


def test_transcription_rejects_unsupported_empty_and_oversized_audio() -> None:
    client = build_client()

    unsupported = client.post(
        "/api/transcription",
        files={"audio": ("recording.txt", b"audio", "text/plain")},
    )
    empty = client.post(
        "/api/transcription",
        files={"audio": ("recording.webm", b"", "audio/webm")},
    )
    oversized = client.post(
        "/api/transcription",
        files={"audio": ("recording.webm", b"x" * (MAX_TRANSCRIPTION_BYTES + 1), "audio/webm")},
    )

    assert unsupported.status_code == 415
    assert unsupported.json()["detail"]["code"] == "unsupported_audio_type"
    assert empty.status_code == 422
    assert empty.json()["detail"]["code"] == "empty_audio"
    assert oversized.status_code == 413
    assert oversized.json()["detail"]["code"] == "audio_too_large"


def test_transcription_returns_safe_provider_errors() -> None:
    response = build_client(FailingTranscriptionProvider()).post(
        "/api/transcription",
        files={"audio": ("recording.webm", b"recorded-audio", "audio/webm")},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "no_speech"
    assert detail["message"] == "音声を認識できませんでした。"
    assert len(detail["request_id"]) == 32
