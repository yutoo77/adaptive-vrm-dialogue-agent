import io
import json
import wave

import httpx

from scripts.evaluate_performance import SCENARIOS, evaluate


def _wav_bytes() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24_000)
        wav_file.writeframes(b"\x00\x00" * 2_400)
    return output.getvalue()


def test_performance_evaluator_counts_schema_matches_and_valid_wav() -> None:
    scenarios_by_message = {scenario.message: scenario for scenario in SCENARIOS}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/speech/health":
            return httpx.Response(200, json={"status": "ready"})
        if request.url.path == "/api/dialogue":
            payload = json.loads(request.content)
            scenario = scenarios_by_message[payload["message"]]
            return httpx.Response(
                200,
                json={
                    "reply": "評価用の返答です。",
                    "performance": {
                        "emotion": scenario.expected_emotion,
                        "intensity": 0.5,
                        "gesture": scenario.expected_gesture,
                        "voice_style": scenario.expected_voice_style,
                        "cues": [],
                    },
                },
            )
        if request.url.path == "/api/speech":
            return httpx.Response(
                200,
                content=_wav_bytes(),
                headers={
                    "content-type": "audio/wav",
                    "x-speech-timing-version": "1",
                    "x-speech-duration-ms": "100",
                    "x-speech-visemes": "a:0:100",
                },
            )
        return httpx.Response(404)

    result = evaluate("http://testserver", 1, transport=httpx.MockTransport(handler))

    assert result["summary"]["attempted"] == len(SCENARIOS)
    assert result["summary"]["performance_matched"] == len(SCENARIOS)
    assert result["summary"]["cue_timelines_valid"] == len(SCENARIOS)
    assert result["summary"]["speech_succeeded"] == len(SCENARIOS)
    assert result["summary"]["speech_timings_valid"] == len(SCENARIOS)
    assert all(case["audio_seconds"] == 0.1 for case in result["cases"])
