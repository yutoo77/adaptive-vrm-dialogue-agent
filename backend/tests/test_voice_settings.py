import io
import json
import wave

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.persistent_memory import PersistentMemoryStore
from app.speech import VoicevoxSpeechProvider
from app.voice_settings import prepare_speech_text

CHOICE = {"speaker_id": 3, "speed_scale": 1.25, "pitch_scale": 0.08, "intonation_scale": 1.2}


def make_client(requests: list[httpx.Request]) -> TestClient:
    wav = io.BytesIO()
    with wave.open(wav, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\x00\x00" * 800)

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/speakers":
            return httpx.Response(200, json=[{
                "name": "テスト話者", "styles": [
                    {"id": 14, "name": "標準"},
                    {"id": 3, "name": "別の声", "type": "talk"},
                    {"id": 99, "name": "歌唱専用", "type": "sing"},
                ],
            }])
        if request.url.path == "/audio_query":
            return httpx.Response(200, json={"accent_phrases": []})
        if request.url.path == "/synthesis":
            return httpx.Response(200, content=wav.getvalue(), headers={"content-type": "audio/wav"})
        return httpx.Response(404)

    provider = VoicevoxSpeechProvider(Settings(), transport=httpx.MockTransport(handler))
    return TestClient(create_app(
        settings=Settings(), speech_provider=provider, persistent_memory_store=PersistentMemoryStore(":memory:"),
    ))


def test_catalog_excludes_singing_and_custom_voice_does_not_change_the_default() -> None:
    requests: list[httpx.Request] = []
    with make_client(requests) as client:
        catalog = client.get("/api/speech/voices").json()
        assert [voice["id"] for voice in catalog["voices"]] == [14, 3]
        assert catalog["voices"][1]["credit"] == "VOICEVOX:テスト話者"
        assert catalog["defaults"]["speed_scale"] == 0.96
        custom = client.post("/api/speech", json={"text": "忙しかった分、休もう。", "voice": CHOICE})
        normal = client.post("/api/speech", json={"text": "こんにちは。"})
    assert custom.status_code == normal.status_code == 200
    assert custom.headers["x-speech-speaker-id"] == "3"
    assert normal.headers["x-speech-speaker-id"] == "14"
    assert custom.headers["x-speech-duration-ms"] == "100"
    queries = [request for request in requests if request.url.path == "/audio_query"]
    assert queries[0].url.params["text"] == "忙しかったぶん、休もう。"
    assert [request.url.params["speaker"] for request in queries] == ["3", "14"]
    synthesis = [json.loads(request.content) for request in requests if request.url.path == "/synthesis"]
    assert [item["speedScale"] for item in synthesis] == [1.25, 0.96]
    assert [item["pitchScale"] for item in synthesis] == [0.08, -0.01]
    assert [item["intonationScale"] for item in synthesis] == [1.2, 0.94]
    assert sum(request.url.path == "/speakers" for request in requests) == 1


@pytest.mark.parametrize("field,value", [
    ("speaker_id", True), ("speaker_id", "3"), ("speed_scale", 0),
    ("pitch_scale", 0.16), ("intonation_scale", 1.51), ("engine_url", "http://elsewhere"),
])
def test_bad_voice_settings_are_rejected_before_any_engine_request(field: str, value: object) -> None:
    requests: list[httpx.Request] = []
    with make_client(requests) as client:
        response = client.post("/api/speech", json={"text": "確認", "voice": {**CHOICE, field: value}})
    assert response.status_code == 422
    assert requests == []


def test_unknown_or_singing_voice_is_not_synthesized() -> None:
    requests: list[httpx.Request] = []
    with make_client(requests) as client:
        for voice_id in (99, 100000):
            response = client.post("/api/speech", json={"text": "確認", "voice": {**CHOICE, "speaker_id": voice_id}})
            assert response.status_code == 422
            assert response.json()["detail"]["code"] == "unknown_voice"
    assert all(request.url.path == "/speakers" for request in requests)


def test_reading_fix_is_scoped_to_the_reported_phrase() -> None:
    assert prepare_speech_text("今日は忙しかった分、五分だけ自分の時間を取ろう。") == (
        "今日は忙しかったぶん、五分だけ自分の時間を取ろう。"
    )
    assert prepare_speech_text("十分に分かる。そういう分け方。") == "十分に分かる。そういう分け方。"
