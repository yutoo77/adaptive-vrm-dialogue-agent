import asyncio
import json
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from app.character_profile import DEFAULT_CHARACTER_PROFILE
from app.config import ConfigurationError, Settings
from app.conversation import ConversationMemoryStore, DialogueContext
from app.interaction import ResponseStyle
from app.main import create_app
from app.performance import PerformancePlan
from app.persistent_memory import PersistentMemoryStore
from app.providers import (
    ProviderError,
    ProviderReply,
    ProviderStreamCompleted,
    ProviderStreamEvent,
    ProviderTextDelta,
)
from app.speech import (
    SpeechHealth,
    SpeechProviderError,
    SpeechSynthesisResult,
    SpeechTiming,
    SpeechVisemeSegment,
)

SESSION_A = "session-test-alpha"
SESSION_B = "session-test-bravo"


def dialogue_payload(
    message: str,
    session_id: str = SESSION_A,
    response_style: ResponseStyle | None = None,
) -> dict[str, str]:
    payload = {"message": message, "session_id": session_id}
    if response_style is not None:
        payload["response_style"] = response_style
    return payload


def build_client(settings: Settings | None = None) -> TestClient:
    return TestClient(
        create_app(
            settings=settings or Settings(),
            persistent_memory_store=PersistentMemoryStore.in_memory(),
        )
    )


def test_health_reports_mock_without_exposing_a_secret() -> None:
    response = build_client().get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "provider": "mock",
        "model": "mock-v1",
        "api_key_configured": False,
        "message": "Dialogue Providerは利用可能です。",
        "session_memory_enabled": True,
        "session_memory_max_turns": 10,
        "session_summary_enabled": True,
        "emotional_continuity_enabled": True,
        "emotional_continuity_max_carry_turns": 2,
        "persistent_memory_enabled": True,
        "persistent_memory_count": 0,
        "character": DEFAULT_CHARACTER_PROFILE.model_dump(mode="json"),
    }


def test_mock_dialogue_returns_a_traceable_response() -> None:
    response = build_client().post("/api/dialogue", json=dialogue_payload("こんにちは"))

    assert response.status_code == 200
    payload = response.json()
    assert payload["reply"] == "こんにちは。しずくだよ。今日はどんなことを話そうか？"
    assert payload["response_style"] == "balanced"
    assert payload["performance"] == {
        "emotion": "happy",
        "intensity": 0.64,
        "gesture": "soft_bounce",
        "voice_style": "bright",
        "cues": [
            {"at": 0.217, "gesture": "small_nod", "intensity": 0.378},
        ],
    }
    assert payload["continuity"] == {
        "emotion": "happy",
        "intensity": 0.64,
        "turn_index": 1,
        "turns_held": 1,
        "carried_from_previous": False,
        "gaze_behavior": "engaged",
        "motion_scale": 1.042,
        "gesture_budget": 2,
    }
    assert payload["provider"] == "mock"
    assert payload["model"] == "mock-v1"
    assert len(payload["request_id"]) == 32
    assert payload["latency_ms"] >= 0
    assert payload["session_id"] == SESSION_A
    assert payload["memory_turns"] == 1
    assert payload["memory_max_turns"] == 10
    assert payload["session_summary_available"] is False
    assert payload["relevant_memory_count"] == 0
    assert payload["saved_memory"] is None


def test_mock_dialogue_stream_exposes_deltas_then_commits_one_validated_response() -> None:
    conversation_store = ConversationMemoryStore()
    app = create_app(
        settings=Settings(),
        conversation_store=conversation_store,
        persistent_memory_store=PersistentMemoryStore.in_memory(),
    )

    response = TestClient(app).post("/api/dialogue/stream", json=dialogue_payload("こんにちは"))

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert response.headers["cache-control"] == "no-store"
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["type"] == "start"
    deltas = [event["delta"] for event in events if event["type"] == "text_delta"]
    assert len(deltas) >= 2
    completed = events[-1]
    assert completed["type"] == "complete"
    payload = completed["response"]
    assert "".join(deltas) == payload["reply"]
    assert payload["first_text_ms"] <= payload["text_complete_ms"] <= payload["latency_ms"]
    assert payload["memory_turns"] == 1
    assert len(conversation_store.history(SESSION_A)) == 2


def test_mock_capability_reply_matches_current_voice_features() -> None:
    response = build_client().post("/api/dialogue", json=dialogue_payload("何ができる？"))

    assert response.status_code == 200
    assert "VOICEVOXの音声再生と口の動き" in response.json()["reply"]
    assert "次の段階" not in response.json()["reply"]


def test_mock_response_styles_are_explicit_bounded_and_visibly_different() -> None:
    client = build_client()
    replies: dict[ResponseStyle, str] = {}

    for style in ("concise", "balanced", "detailed", "beginner"):
        response = client.post(
            "/api/dialogue",
            json=dialogue_payload("何ができる？", f"session-style-{style}", style),
        )
        assert response.status_code == 200
        assert response.json()["response_style"] == style
        replies[style] = response.json()["reply"]

    assert len(replies["concise"]) < len(replies["balanced"]) < len(replies["detailed"])
    assert "端末内で作った音声の再生" in replies["beginner"]
    assert "短い説明" in replies["beginner"]


def test_dialogue_rejects_an_unknown_response_style() -> None:
    response = build_client().post(
        "/api/dialogue",
        json={**dialogue_payload("テスト"), "response_style": "auto-detect"},
    )

    assert response.status_code == 422


class BlockingProvider:
    name = "mock"
    model = "blocking-mock"
    ready = True
    configuration_message = None

    def __init__(self) -> None:
        self.started = Event()
        self.cancelled = Event()

    async def generate_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> ProviderReply:
        del message, context, response_style, request_id
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise


class PartialBlockingStreamProvider:
    name = "mock"
    model = "partial-blocking-mock"
    ready = True
    configuration_message = None

    def __init__(self) -> None:
        self.started = Event()
        self.cancelled = Event()

    async def generate_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> ProviderReply:
        del message, context, response_style, request_id
        raise AssertionError("The streaming endpoint must use stream_reply.")

    async def stream_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        del message, context, response_style, request_id
        yield ProviderTextDelta("保存前の途中Text")
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise
        yield ProviderStreamCompleted(
            ProviderReply(
                text="到達しない返答",
                performance=PerformancePlan(
                    emotion="neutral",
                    intensity=0.3,
                    gesture="none",
                    voice_style="neutral",
                    cues=[],
                ),
            )
        )


def test_active_dialogue_can_be_cancelled_without_saving_conversation_or_memory() -> None:
    provider = BlockingProvider()
    conversation_store = ConversationMemoryStore()
    memory_store = PersistentMemoryStore.in_memory()
    app = create_app(
        settings=Settings(),
        provider=provider,
        conversation_store=conversation_store,
        persistent_memory_store=memory_store,
    )

    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
        pending_response = executor.submit(
            client.post,
            "/api/dialogue",
            json=dialogue_payload("覚えておいて：保存しない"),
        )
        assert provider.started.wait(timeout=2)

        duplicate = client.post(
            "/api/dialogue",
            json=dialogue_payload("同じ会話へ二重送信"),
        )
        cancellation = client.delete(f"/api/dialogue/sessions/{SESSION_A}/active")
        dialogue_response = pending_response.result(timeout=5)
        second_cancellation = client.delete(f"/api/dialogue/sessions/{SESSION_A}/active")

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "dialogue_in_progress"
    assert cancellation.status_code == 200
    assert cancellation.json() == {"session_id": SESSION_A, "cancelled": True}
    assert dialogue_response.status_code == 409
    assert dialogue_response.json()["detail"]["code"] == "dialogue_cancelled"
    assert provider.cancelled.is_set()
    assert conversation_store.history(SESSION_A) == ()
    assert memory_store.count() == 0
    assert second_cancellation.json() == {"session_id": SESSION_A, "cancelled": False}


def test_streamed_partial_text_is_cancelled_without_committing_memory() -> None:
    provider = PartialBlockingStreamProvider()
    conversation_store = ConversationMemoryStore()
    memory_store = PersistentMemoryStore.in_memory()
    app = create_app(
        settings=Settings(),
        provider=provider,
        conversation_store=conversation_store,
        persistent_memory_store=memory_store,
    )

    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
        pending_response = executor.submit(
            client.post,
            "/api/dialogue/stream",
            json=dialogue_payload("覚えておいて：保存しない"),
        )
        assert provider.started.wait(timeout=2)
        cancellation = client.delete(f"/api/dialogue/sessions/{SESSION_A}/active")
        stream_response = pending_response.result(timeout=5)

    events = [json.loads(line) for line in stream_response.text.splitlines()]
    assert cancellation.json() == {"session_id": SESSION_A, "cancelled": True}
    assert any(event["type"] == "text_delta" for event in events)
    assert events[-1]["type"] == "error"
    assert events[-1]["error"]["code"] == "dialogue_cancelled"
    assert provider.cancelled.is_set()
    assert conversation_store.history(SESSION_A) == ()
    assert memory_store.count() == 0


def test_mock_remembers_recent_context_within_one_session() -> None:
    client = build_client()

    first = client.post("/api/dialogue", json=dialogue_payload("青い鳥の話をしよう"))
    follow_up = client.post("/api/dialogue", json=dialogue_payload("さっきの話を覚えてる？"))

    assert first.status_code == 200
    assert follow_up.status_code == 200
    assert "青い鳥の話をしよう" in follow_up.json()["reply"]
    assert follow_up.json()["memory_turns"] == 2


def test_mock_carries_emotional_residue_for_two_neutral_turns_then_decays() -> None:
    client = build_client()

    initial = client.post("/api/dialogue", json=dialogue_payload("今日は疲れた"))
    first_carry = client.post("/api/dialogue", json=dialogue_payload("そうなんだ"))
    second_carry = client.post("/api/dialogue", json=dialogue_payload("なるほど"))
    expired = client.post("/api/dialogue", json=dialogue_payload("わかった"))

    assert initial.json()["continuity"]["emotion"] == "gentle"
    assert first_carry.json()["continuity"]["emotion"] == "gentle"
    assert first_carry.json()["continuity"]["carried_from_previous"] is True
    assert first_carry.json()["performance"]["gesture"] == "none"
    assert second_carry.json()["continuity"]["carried_from_previous"] is True
    assert expired.json()["continuity"]["emotion"] == "neutral"
    assert expired.json()["continuity"]["carried_from_previous"] is False


def test_dialogue_sessions_are_isolated_and_can_be_reset() -> None:
    client = build_client()
    client.post("/api/dialogue", json=dialogue_payload("星空について話そう", SESSION_A))

    isolated = client.post("/api/dialogue", json=dialogue_payload("さっきの話を覚えてる？", SESSION_B))
    reset = client.delete(f"/api/dialogue/sessions/{SESSION_A}")
    after_reset = client.post("/api/dialogue", json=dialogue_payload("さっきの話を覚えてる？", SESSION_A))

    assert "まだ前の話題はない" in isolated.json()["reply"]
    assert reset.status_code == 200
    assert reset.json() == {
        "session_id": SESSION_A,
        "cleared_turns": 1,
        "cleared_emotional_state": True,
    }
    assert "まだ前の話題はない" in after_reset.json()["reply"]


def test_dialogue_memory_keeps_only_the_latest_ten_turns() -> None:
    store = ConversationMemoryStore(max_turns=10)
    client = TestClient(
        create_app(
            settings=Settings(),
            conversation_store=store,
            persistent_memory_store=PersistentMemoryStore.in_memory(),
        )
    )

    for index in range(12):
        response = client.post("/api/dialogue", json=dialogue_payload(f"話題{index}"))
        assert response.status_code == 200

    history = store.history(SESSION_A)
    assert len(history) == 20
    assert history[0].content == "話題2"
    assert history[-2].content == "話題11"
    assert response.json()["memory_turns"] == 10
    assert response.json()["session_summary_available"] is True
    assert store.summary(SESSION_A) is not None
    assert "話題0" in (store.summary(SESSION_A) or "")


class RecordingProvider:
    name = "mock"
    model = "recording-mock"
    ready = True
    configuration_message = None

    def __init__(self) -> None:
        self.contexts: list[DialogueContext] = []
        self.response_styles: list[ResponseStyle] = []

    async def generate_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> ProviderReply:
        del message, request_id
        self.contexts.append(context)
        self.response_styles.append(response_style)
        return ProviderReply(
            text="記録しました。",
            performance=PerformancePlan(
                emotion="neutral",
                intensity=0.35,
                gesture="small_nod",
                voice_style="neutral",
                cues=[],
            ),
        )


def test_compacted_summary_is_given_to_the_provider_with_recent_turns() -> None:
    provider = RecordingProvider()
    client = TestClient(
        create_app(
            settings=Settings(),
            provider=provider,
            persistent_memory_store=PersistentMemoryStore.in_memory(),
        )
    )

    for index in range(12):
        assert client.post("/api/dialogue", json=dialogue_payload(f"話題{index}")).status_code == 200

    latest_context = provider.contexts[-1]
    assert latest_context.session_summary is not None
    assert "話題0" in latest_context.session_summary
    assert latest_context.recent_messages[0].content == "話題1"
    assert provider.response_styles[-1] == "balanced"


def test_explicit_memory_is_saved_recalled_and_not_removed_by_session_reset() -> None:
    memory_store = PersistentMemoryStore.in_memory()
    client = TestClient(create_app(settings=Settings(), persistent_memory_store=memory_store))

    saved = client.post("/api/dialogue", json=dialogue_payload("覚えておいて：好きな色は青"))
    client.delete(f"/api/dialogue/sessions/{SESSION_A}")
    recalled = client.post("/api/dialogue", json=dialogue_payload("好きな色を覚えてる？"))

    assert saved.status_code == 200
    assert saved.json()["saved_memory"]["content"] == "好きな色は青"
    assert saved.json()["saved_memory"]["source"] == "explicit"
    assert recalled.status_code == 200
    assert "好きな色は青" in recalled.json()["reply"]
    assert recalled.json()["relevant_memory_count"] == 1


def test_persistent_memory_crud_and_clear() -> None:
    client = build_client()

    created = client.post("/api/memories", json={"content": "青い鳥が好き"})
    memory_id = created.json()["item"]["id"]
    duplicate = client.post("/api/memories", json={"content": "青い鳥が好き"})
    listed = client.get("/api/memories")
    updated = client.patch(f"/api/memories/{memory_id}", json={"content": "青い鳥と星空が好き"})
    deleted = client.delete(f"/api/memories/{memory_id}")
    cleared = client.delete("/api/memories")

    assert created.status_code == 200
    assert created.json()["created"] is True
    assert duplicate.json()["created"] is False
    assert listed.json()["total"] == 1
    assert updated.json()["item"]["content"] == "青い鳥と星空が好き"
    assert deleted.json() == {"id": memory_id, "deleted": True}
    assert cleared.json() == {"deleted_count": 0}


def test_dialogue_rejects_blank_and_oversized_messages() -> None:
    client = build_client()

    assert client.post("/api/dialogue", json=dialogue_payload("   ")).status_code == 422
    assert client.post("/api/dialogue", json=dialogue_payload("a" * 1001)).status_code == 422
    assert client.post("/api/dialogue", json={"message": "test", "session_id": "short"}).status_code == 422


def test_openai_mode_without_key_stays_up_but_reports_configuration_error() -> None:
    client = build_client(Settings(provider="openai", openai_api_key=None))

    health = client.get("/api/health")
    response = client.post("/api/dialogue", json=dialogue_payload("テスト"))

    assert health.status_code == 200
    assert health.json()["status"] == "configuration_error"
    assert health.json()["api_key_configured"] is False
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "provider_not_configured"


class FailingProvider:
    name = "mock"
    model = "failing-mock"
    ready = True
    configuration_message = None

    async def generate_reply(
        self,
        message: str,
        context: DialogueContext,
        response_style: ResponseStyle,
        request_id: str,
    ) -> ProviderReply:
        del message, context, response_style, request_id
        raise ProviderError(504, "provider_timeout", "時間内に応答できませんでした。")


def test_provider_errors_use_a_safe_public_payload() -> None:
    memory_store = PersistentMemoryStore.in_memory()
    app = create_app(settings=Settings(), provider=FailingProvider(), persistent_memory_store=memory_store)
    response = TestClient(app).post("/api/dialogue", json=dialogue_payload("テスト"))

    assert response.status_code == 504
    detail = response.json()["detail"]
    assert detail["code"] == "provider_timeout"
    assert detail["message"] == "時間内に応答できませんでした。"
    assert len(detail["request_id"]) == 32
    failed_memory = TestClient(app).post("/api/dialogue", json=dialogue_payload("覚えておいて：保存しない"))
    assert failed_memory.status_code == 504
    assert memory_store.count() == 0


def test_streaming_provider_error_uses_a_typed_safe_event_without_saving() -> None:
    memory_store = PersistentMemoryStore.in_memory()
    app = create_app(settings=Settings(), provider=FailingProvider(), persistent_memory_store=memory_store)

    response = TestClient(app).post(
        "/api/dialogue/stream",
        json=dialogue_payload("覚えておいて：保存しない"),
    )

    events = [json.loads(line) for line in response.text.splitlines()]
    assert response.status_code == 200
    assert events[0]["type"] == "start"
    assert events[-1]["type"] == "error"
    assert events[-1]["error"]["code"] == "provider_timeout"
    assert events[-1]["error"]["message"] == "時間内に応答できませんでした。"
    assert len(events[-1]["error"]["request_id"]) == 32
    assert memory_store.count() == 0


class WorkingSpeechProvider:
    name = "voicevox"
    speaker_id = 7

    async def check_health(self) -> SpeechHealth:
        return SpeechHealth(True, "0.25.2", "VOICEVOX Engineは利用可能です。")

    async def synthesize(self, text: str, request_id: str) -> SpeechSynthesisResult:
        del text, request_id
        return SpeechSynthesisResult(
            audio=b"RIFF\x00\x00\x00\x00WAVEfmt ",
            timing=SpeechTiming(
                duration_ms=1200,
                phrase_boundaries_ms=(480,),
                visemes=(SpeechVisemeSegment("a", 100, 180),),
            ),
        )


class FailingSpeechProvider:
    name = "voicevox"
    speaker_id = 7

    async def check_health(self) -> SpeechHealth:
        return SpeechHealth(False, None, "VOICEVOX Engineへ接続できません。")

    async def synthesize(self, text: str, request_id: str) -> SpeechSynthesisResult:
        del text, request_id
        raise SpeechProviderError(
            503,
            "voicevox_unreachable",
            "VOICEVOX Engineへ接続できません。起動してから再試行してください。",
        )


def test_speech_health_reports_engine_status_without_breaking_dialogue() -> None:
    app = create_app(settings=Settings(), speech_provider=WorkingSpeechProvider())
    client = TestClient(app)

    speech_health = client.get("/api/speech/health")
    dialogue = client.post("/api/dialogue", json=dialogue_payload("こんにちは"))

    assert speech_health.status_code == 200
    assert speech_health.json() == {
        "status": "ready",
        "provider": "voicevox",
        "speaker_id": 7,
        "engine_version": "0.25.2",
        "speaker_name": None,
        "style_name": None,
        "credit": None,
        "message": "VOICEVOX Engineは利用可能です。",
    }
    assert dialogue.status_code == 200


def test_speech_returns_wav_with_trace_headers() -> None:
    app = create_app(settings=Settings(), speech_provider=WorkingSpeechProvider())
    response = TestClient(app).post("/api/speech", json={"text": "こんにちは"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["cache-control"] == "no-store"
    assert len(response.headers["x-request-id"]) == 32
    assert response.headers["x-speech-timing-version"] == "1"
    assert response.headers["x-speech-duration-ms"] == "1200"
    assert response.headers["x-speech-phrase-boundaries"] == "480"
    assert response.headers["x-speech-visemes"] == "a:100:180"
    assert response.content.startswith(b"RIFF")
    assert response.content[8:12] == b"WAVE"


def test_speech_rejects_blank_and_oversized_text() -> None:
    app = create_app(settings=Settings(), speech_provider=WorkingSpeechProvider())
    client = TestClient(app)

    assert client.post("/api/speech", json={"text": "   "}).status_code == 422
    assert client.post("/api/speech", json={"text": "a" * 1001}).status_code == 422


def test_speech_errors_use_a_safe_public_payload() -> None:
    app = create_app(settings=Settings(), speech_provider=FailingSpeechProvider())
    response = TestClient(app).post("/api/speech", json={"text": "テスト"})

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["code"] == "voicevox_unreachable"
    assert detail["message"] == "VOICEVOX Engineへ接続できません。起動してから再試行してください。"
    assert len(detail["request_id"]) == 32


def test_voicevox_base_url_must_stay_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VOICEVOX_BASE_URL", "https://example.com")

    with pytest.raises(ConfigurationError, match="local HTTP URL"):
        Settings.from_env()


def test_transcription_configuration_rejects_unknown_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRANSCRIPTION_MODEL", "../../untrusted-model")

    with pytest.raises(ConfigurationError, match="TRANSCRIPTION_MODEL"):
        Settings.from_env()
