from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.interaction import ResponseStyle
from app.performance import PerformancePlan


class DialogueRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    message: str = Field(min_length=1, max_length=1000)
    session_id: str = Field(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    response_style: ResponseStyle = "balanced"


class SpeechRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=1000)


class DialogueResponse(BaseModel):
    reply: str
    response_style: ResponseStyle
    performance: PerformancePlan
    provider: Literal["mock", "openai"]
    model: str
    request_id: str
    latency_ms: int
    session_id: str
    memory_turns: int
    memory_max_turns: int
    session_summary_available: bool
    relevant_memory_count: int
    saved_memory: PersistentMemoryItem | None = None


class SessionResetResponse(BaseModel):
    session_id: str
    cleared_turns: int


class DialogueCancellationResponse(BaseModel):
    session_id: str
    cancelled: bool


class HealthResponse(BaseModel):
    status: Literal["ready", "configuration_error"]
    provider: Literal["mock", "openai"]
    model: str
    api_key_configured: bool
    message: str
    session_memory_enabled: bool
    session_memory_max_turns: int
    session_summary_enabled: bool
    persistent_memory_enabled: bool
    persistent_memory_count: int


class PersistentMemoryItem(BaseModel):
    id: str
    content: str
    source: Literal["manual", "explicit"]
    created_at: str
    updated_at: str
    use_count: int


class PersistentMemoryListResponse(BaseModel):
    items: list[PersistentMemoryItem]
    total: int


class PersistentMemoryCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    content: str = Field(min_length=1, max_length=500)


class PersistentMemoryUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    content: str = Field(min_length=1, max_length=500)


class PersistentMemoryMutationResponse(BaseModel):
    item: PersistentMemoryItem
    created: bool


class PersistentMemoryDeleteResponse(BaseModel):
    id: str
    deleted: bool


class PersistentMemoryClearResponse(BaseModel):
    deleted_count: int


class SpeechHealthResponse(BaseModel):
    status: Literal["ready", "unavailable"]
    provider: Literal["voicevox"]
    speaker_id: int
    engine_version: str | None
    speaker_name: str | None
    style_name: str | None
    credit: str | None
    message: str


class TranscriptionHealthResponse(BaseModel):
    status: Literal["ready"]
    provider: Literal["faster-whisper"]
    model: str
    device: str
    compute_type: str
    model_loaded: bool
    message: str


class TranscriptionResponse(BaseModel):
    text: str
    language: str
    language_probability: float
    audio_duration_seconds: float
    request_id: str
    latency_ms: int
