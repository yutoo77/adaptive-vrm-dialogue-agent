import io
import json
import wave

import httpx
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.speech import VoicevoxSpeechProvider


def _wav_bytes(duration_seconds: float = 1.0) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24_000)
        wav_file.writeframes(b"\x00\x00" * round(24_000 * duration_seconds))
    return output.getvalue()


WAV_BYTES = _wav_bytes()
AUDIO_QUERY = {
    "prePhonemeLength": 0.1,
    "postPhonemeLength": 0.1,
    "accent_phrases": [
        {
            "moras": [
                {"consonant_length": 0.05, "vowel": "o", "vowel_length": 0.1},
                {"consonant_length": None, "vowel": "N", "vowel_length": 0.1},
                {"consonant_length": 0.05, "vowel": "i", "vowel_length": 0.1},
            ],
            "pause_mora": {"consonant_length": None, "vowel": "pau", "vowel_length": 0.3},
        },
        {
            "moras": [{"consonant_length": 0.05, "vowel": "a", "vowel_length": 0.05}],
            "pause_mora": None,
        },
    ],
}


def test_voicevox_provider_uses_audio_query_then_synthesis() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/version":
            return httpx.Response(200, json="0.25.2")
        if request.url.path == "/speakers":
            return httpx.Response(
                200,
                json=[{"name": "テスト話者", "styles": [{"name": "ノーマル", "id": 7}]}],
            )
        if request.url.path == "/audio_query":
            return httpx.Response(200, json=AUDIO_QUERY)
        if request.url.path == "/synthesis":
            return httpx.Response(200, content=WAV_BYTES, headers={"content-type": "audio/wav"})
        return httpx.Response(404)

    settings = Settings(voicevox_speaker_id=7)
    speech_provider = VoicevoxSpeechProvider(settings, transport=httpx.MockTransport(handler))
    client = TestClient(create_app(settings=settings, speech_provider=speech_provider))

    health = client.get("/api/speech/health")
    response = client.post("/api/speech", json={"text": "こんにちは"})

    assert health.json()["status"] == "ready"
    assert health.json()["engine_version"] == "0.25.2"
    assert health.json()["speaker_name"] == "テスト話者"
    assert health.json()["style_name"] == "ノーマル"
    assert health.json()["credit"] == "VOICEVOX:テスト話者"
    assert response.status_code == 200
    assert response.content == WAV_BYTES
    assert response.headers["x-speech-timing-version"] == "1"
    assert response.headers["x-speech-duration-ms"] == "1000"
    assert response.headers["x-speech-phrase-boundaries"] == "500"
    assert response.headers["x-speech-visemes"] == "o:100:150,i:350:150,a:800:100"
    assert [request.url.path for request in requests] == [
        "/version",
        "/speakers",
        "/audio_query",
        "/synthesis",
    ]
    assert requests[2].url.params["text"] == "こんにちは"
    assert requests[2].url.params["speaker"] == "7"
    assert requests[3].url.params["speaker"] == "7"
    synthesis_query = json.loads(requests[3].content)
    assert synthesis_query["speedScale"] == 0.96
    assert synthesis_query["pitchScale"] == -0.01
    assert synthesis_query["intonationScale"] == 0.94


def test_voicevox_connection_failure_is_reported_without_response_details() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("private diagnostic", request=request)

    settings = Settings()
    speech_provider = VoicevoxSpeechProvider(settings, transport=httpx.MockTransport(handler))
    client = TestClient(create_app(settings=settings, speech_provider=speech_provider))

    health = client.get("/api/speech/health")
    response = client.post("/api/speech", json={"text": "テスト"})

    assert health.status_code == 200
    assert health.json()["status"] == "unavailable"
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "voicevox_unreachable"
    assert "private diagnostic" not in response.text
