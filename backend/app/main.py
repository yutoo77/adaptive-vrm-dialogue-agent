from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Annotated
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Path, Response, UploadFile

from app.config import Settings
from app.conversation import ConversationMemoryStore
from app.persistent_memory import (
    PersistentMemory,
    PersistentMemoryStore,
    extract_explicit_memory,
)
from app.providers import DialogueProvider, ProviderError, ProviderReply, build_provider
from app.schemas import (
    DialogueCancellationResponse,
    DialogueRequest,
    DialogueResponse,
    HealthResponse,
    PersistentMemoryClearResponse,
    PersistentMemoryCreateRequest,
    PersistentMemoryDeleteResponse,
    PersistentMemoryItem,
    PersistentMemoryListResponse,
    PersistentMemoryMutationResponse,
    PersistentMemoryUpdateRequest,
    SessionResetResponse,
    SpeechHealthResponse,
    SpeechRequest,
    TranscriptionHealthResponse,
    TranscriptionResponse,
)
from app.speech import (
    SpeechProvider,
    SpeechProviderError,
    build_speech_provider,
    speech_timing_headers,
)
from app.transcription import (
    TranscriptionProvider,
    TranscriptionProviderError,
    build_transcription_provider,
)

logger = logging.getLogger("adaptive_vrm.dialogue")
MAX_TRANSCRIPTION_BYTES = 4 * 1024 * 1024
ALLOWED_TRANSCRIPTION_MEDIA_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/mpeg"}


@dataclass
class _ActiveDialogue:
    provider_task: asyncio.Task[ProviderReply] | None = None
    cancel_requested: bool = False
    committing: bool = False


class _DialogueCancelled(Exception):
    pass


def create_app(
    settings: Settings | None = None,
    provider: DialogueProvider | None = None,
    speech_provider: SpeechProvider | None = None,
    transcription_provider: TranscriptionProvider | None = None,
    conversation_store: ConversationMemoryStore | None = None,
    persistent_memory_store: PersistentMemoryStore | None = None,
) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    resolved_provider = provider or build_provider(resolved_settings)
    resolved_speech_provider = speech_provider or build_speech_provider(resolved_settings)
    resolved_transcription_provider = transcription_provider or build_transcription_provider(resolved_settings)
    resolved_conversation_store = conversation_store or ConversationMemoryStore()
    resolved_persistent_memory_store = persistent_memory_store or PersistentMemoryStore()
    state_lock = asyncio.Lock()
    active_dialogue_lock = asyncio.Lock()
    active_dialogues: dict[str, _ActiveDialogue] = {}

    app = FastAPI(
        title="Adaptive VRM Dialogue API",
        version="0.4.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    @app.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        ready = resolved_provider.ready
        return HealthResponse(
            status="ready" if ready else "configuration_error",
            provider=resolved_provider.name,
            model=resolved_provider.model,
            api_key_configured=resolved_settings.provider == "openai" and resolved_settings.api_key_configured,
            message=resolved_provider.configuration_message or "Dialogue Providerは利用可能です。",
            session_memory_enabled=True,
            session_memory_max_turns=resolved_conversation_store.max_turns,
            session_summary_enabled=True,
            persistent_memory_enabled=True,
            persistent_memory_count=resolved_persistent_memory_store.count(),
        )

    @app.post("/api/dialogue", response_model=DialogueResponse)
    async def dialogue(request: DialogueRequest) -> DialogueResponse:
        request_id = uuid4().hex
        started_at = perf_counter()
        active_dialogue = _ActiveDialogue()

        async with active_dialogue_lock:
            if request.session_id in active_dialogues:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "dialogue_in_progress",
                        "message": "この会話では既に応答を生成しています。",
                        "request_id": request_id,
                    },
                )
            active_dialogues[request.session_id] = active_dialogue

        try:
            try:
                async with state_lock:
                    relevant_memories = resolved_persistent_memory_store.search(request.message)
                    context = resolved_conversation_store.context(request.session_id, relevant_memories)

                async with active_dialogue_lock:
                    if active_dialogue.cancel_requested:
                        raise _DialogueCancelled
                    provider_task = asyncio.create_task(
                        resolved_provider.generate_reply(
                            request.message,
                            context,
                            request.response_style,
                            request_id,
                        )
                    )
                    active_dialogue.provider_task = provider_task

                try:
                    result = await provider_task
                except asyncio.CancelledError:
                    if active_dialogue.cancel_requested:
                        raise _DialogueCancelled from None
                    raise

                async with active_dialogue_lock:
                    if active_dialogue.cancel_requested:
                        raise _DialogueCancelled
                    active_dialogue.committing = True

                async with state_lock:
                    explicit_memory = extract_explicit_memory(request.message)
                    saved_memory = None
                    if explicit_memory:
                        saved_memory, _ = resolved_persistent_memory_store.create(
                            explicit_memory,
                            source="explicit",
                        )
                    resolved_persistent_memory_store.mark_used(
                        tuple(memory.id for memory in relevant_memories)
                    )
                    memory_turns = resolved_conversation_store.append_turn(
                        request.session_id,
                        request.message,
                        result.text,
                    )
                    session_summary_available = resolved_conversation_store.summary(request.session_id) is not None
            except _DialogueCancelled:
                latency_ms = round((perf_counter() - started_at) * 1000)
                logger.info(
                    "dialogue_cancelled request_id=%s provider=%s latency_ms=%s",
                    request_id,
                    resolved_provider.name,
                    latency_ms,
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "dialogue_cancelled",
                        "message": "応答生成を停止しました。",
                        "request_id": request_id,
                    },
                ) from None
            except ProviderError as error:
                latency_ms = round((perf_counter() - started_at) * 1000)
                logger.warning(
                    "dialogue_failed request_id=%s provider=%s code=%s latency_ms=%s",
                    request_id,
                    resolved_provider.name,
                    error.code,
                    latency_ms,
                )
                raise HTTPException(
                    status_code=error.status_code,
                    detail={"code": error.code, "message": error.public_message, "request_id": request_id},
                ) from error
            except Exception as error:
                latency_ms = round((perf_counter() - started_at) * 1000)
                logger.exception(
                    "dialogue_failed request_id=%s provider=%s code=unexpected latency_ms=%s",
                    request_id,
                    resolved_provider.name,
                    latency_ms,
                )
                raise HTTPException(
                    status_code=500,
                    detail={
                        "code": "unexpected_error",
                        "message": "予期しないエラーが発生しました。",
                        "request_id": request_id,
                    },
                ) from error

            latency_ms = round((perf_counter() - started_at) * 1000)
            logger.info(
                "dialogue_completed request_id=%s provider=%s model=%s latency_ms=%s "
                "response_style=%s memory_turns=%s upstream_request_id=%s",
                request_id,
                resolved_provider.name,
                resolved_provider.model,
                latency_ms,
                request.response_style,
                memory_turns,
                result.upstream_request_id or "none",
            )
            return DialogueResponse(
                reply=result.text,
                response_style=request.response_style,
                performance=result.performance,
                provider=resolved_provider.name,
                model=resolved_provider.model,
                request_id=request_id,
                latency_ms=latency_ms,
                session_id=request.session_id,
                memory_turns=memory_turns,
                memory_max_turns=resolved_conversation_store.max_turns,
                session_summary_available=session_summary_available,
                relevant_memory_count=len(relevant_memories),
                saved_memory=_memory_item(saved_memory) if saved_memory else None,
            )
        finally:
            async with active_dialogue_lock:
                if active_dialogues.get(request.session_id) is active_dialogue:
                    active_dialogues.pop(request.session_id, None)

    @app.delete(
        "/api/dialogue/sessions/{session_id}/active",
        response_model=DialogueCancellationResponse,
    )
    async def cancel_active_dialogue(
        session_id: Annotated[
            str,
            Path(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
        ],
    ) -> DialogueCancellationResponse:
        async with active_dialogue_lock:
            active_dialogue = active_dialogues.get(session_id)
            if active_dialogue is None or active_dialogue.committing:
                return DialogueCancellationResponse(session_id=session_id, cancelled=False)
            active_dialogue.cancel_requested = True
            provider_task = active_dialogue.provider_task
            if provider_task is not None and not provider_task.done():
                provider_task.cancel()

        settled = provider_task is None or provider_task.done()
        if provider_task is not None and not provider_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(provider_task), timeout=5)
                settled = provider_task.done()
            except asyncio.CancelledError:
                if not provider_task.cancelled():
                    raise
                settled = True
            except TimeoutError:
                settled = False

        logger.info("dialogue_cancel_requested accepted=true provider_settled=%s", settled)
        return DialogueCancellationResponse(session_id=session_id, cancelled=True)

    @app.delete("/api/dialogue/sessions/{session_id}", response_model=SessionResetResponse)
    async def reset_dialogue_session(
        session_id: Annotated[
            str,
            Path(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
        ],
    ) -> SessionResetResponse:
        async with state_lock:
            cleared_turns = resolved_conversation_store.reset(session_id)
        logger.info("dialogue_session_reset cleared_turns=%s", cleared_turns)
        return SessionResetResponse(session_id=session_id, cleared_turns=cleared_turns)

    @app.get("/api/memories", response_model=PersistentMemoryListResponse)
    async def list_persistent_memories() -> PersistentMemoryListResponse:
        async with state_lock:
            items = resolved_persistent_memory_store.list()
        return PersistentMemoryListResponse(
            items=[_memory_item(item) for item in items],
            total=resolved_persistent_memory_store.count(),
        )

    @app.post("/api/memories", response_model=PersistentMemoryMutationResponse)
    async def create_persistent_memory(
        request: PersistentMemoryCreateRequest,
    ) -> PersistentMemoryMutationResponse:
        try:
            async with state_lock:
                item, created = resolved_persistent_memory_store.create(request.content)
        except ValueError as error:
            raise HTTPException(status_code=422, detail={"code": "invalid_memory", "message": str(error)}) from error
        return PersistentMemoryMutationResponse(item=_memory_item(item), created=created)

    @app.patch("/api/memories/{memory_id}", response_model=PersistentMemoryMutationResponse)
    async def update_persistent_memory(
        memory_id: Annotated[str, Path(min_length=32, max_length=32, pattern=r"^[a-f0-9]{32}$")],
        request: PersistentMemoryUpdateRequest,
    ) -> PersistentMemoryMutationResponse:
        try:
            async with state_lock:
                item = resolved_persistent_memory_store.update(memory_id, request.content)
        except ValueError as error:
            raise HTTPException(status_code=409, detail={"code": "duplicate_memory", "message": str(error)}) from error
        if item is None:
            raise HTTPException(
                status_code=404,
                detail={"code": "memory_not_found", "message": "指定された長期記憶は見つかりません。"},
            )
        return PersistentMemoryMutationResponse(item=_memory_item(item), created=False)

    @app.delete("/api/memories/{memory_id}", response_model=PersistentMemoryDeleteResponse)
    async def delete_persistent_memory(
        memory_id: Annotated[str, Path(min_length=32, max_length=32, pattern=r"^[a-f0-9]{32}$")],
    ) -> PersistentMemoryDeleteResponse:
        async with state_lock:
            deleted = resolved_persistent_memory_store.delete(memory_id)
        if not deleted:
            raise HTTPException(
                status_code=404,
                detail={"code": "memory_not_found", "message": "指定された長期記憶は見つかりません。"},
            )
        return PersistentMemoryDeleteResponse(id=memory_id, deleted=True)

    @app.delete("/api/memories", response_model=PersistentMemoryClearResponse)
    async def clear_persistent_memories() -> PersistentMemoryClearResponse:
        async with state_lock:
            deleted_count = resolved_persistent_memory_store.clear()
        return PersistentMemoryClearResponse(deleted_count=deleted_count)

    @app.get("/api/speech/health", response_model=SpeechHealthResponse)
    async def speech_health() -> SpeechHealthResponse:
        health_result = await resolved_speech_provider.check_health()
        return SpeechHealthResponse(
            status="ready" if health_result.available else "unavailable",
            provider=resolved_speech_provider.name,
            speaker_id=resolved_speech_provider.speaker_id,
            engine_version=health_result.engine_version,
            speaker_name=health_result.speaker_name,
            style_name=health_result.style_name,
            credit=health_result.credit,
            message=health_result.message,
        )

    @app.post("/api/speech")
    async def speech(request: SpeechRequest) -> Response:
        request_id = uuid4().hex
        started_at = perf_counter()
        try:
            synthesis = await resolved_speech_provider.synthesize(request.text, request_id)
        except SpeechProviderError as error:
            latency_ms = round((perf_counter() - started_at) * 1000)
            logger.warning(
                "speech_failed request_id=%s provider=%s speaker_id=%s code=%s latency_ms=%s",
                request_id,
                resolved_speech_provider.name,
                resolved_speech_provider.speaker_id,
                error.code,
                latency_ms,
            )
            raise HTTPException(
                status_code=error.status_code,
                detail={"code": error.code, "message": error.public_message, "request_id": request_id},
            ) from error
        except Exception as error:
            latency_ms = round((perf_counter() - started_at) * 1000)
            logger.exception(
                "speech_failed request_id=%s provider=%s speaker_id=%s code=unexpected latency_ms=%s",
                request_id,
                resolved_speech_provider.name,
                resolved_speech_provider.speaker_id,
                latency_ms,
            )
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "unexpected_error",
                    "message": "音声生成中に予期しないエラーが発生しました。",
                    "request_id": request_id,
                },
            ) from error

        latency_ms = round((perf_counter() - started_at) * 1000)
        logger.info(
            "speech_completed request_id=%s provider=%s speaker_id=%s latency_ms=%s bytes=%s",
            request_id,
            resolved_speech_provider.name,
            resolved_speech_provider.speaker_id,
            latency_ms,
            len(synthesis.audio),
        )
        response_headers = {"X-Request-Id": request_id, "Cache-Control": "no-store"}
        response_headers.update(speech_timing_headers(synthesis.timing))
        return Response(
            content=synthesis.audio,
            media_type="audio/wav",
            headers=response_headers,
        )

    @app.get("/api/transcription/health", response_model=TranscriptionHealthResponse)
    async def transcription_health() -> TranscriptionHealthResponse:
        return TranscriptionHealthResponse(
            status="ready",
            provider="faster-whisper",
            model=resolved_transcription_provider.model_name,
            device=resolved_transcription_provider.device,
            compute_type=resolved_transcription_provider.compute_type,
            model_loaded=resolved_transcription_provider.model_loaded,
            message="音声はLocal Backend内で認識し、保存しません。",
        )

    @app.post("/api/transcription", response_model=TranscriptionResponse)
    async def transcription(audio: Annotated[UploadFile, File()]) -> TranscriptionResponse:
        request_id = uuid4().hex
        started_at = perf_counter()
        media_type = (audio.content_type or "").split(";", 1)[0].strip().lower()
        if media_type not in ALLOWED_TRANSCRIPTION_MEDIA_TYPES:
            await audio.close()
            raise HTTPException(
                status_code=415,
                detail={
                    "code": "unsupported_audio_type",
                    "message": "この音声形式には対応していません。Browserの録音形式を確認してください。",
                    "request_id": request_id,
                },
            )

        try:
            audio_bytes = await audio.read(MAX_TRANSCRIPTION_BYTES + 1)
        finally:
            await audio.close()
        if not audio_bytes:
            raise HTTPException(
                status_code=422,
                detail={"code": "empty_audio", "message": "録音Dataが空です。", "request_id": request_id},
            )
        if len(audio_bytes) > MAX_TRANSCRIPTION_BYTES:
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "audio_too_large",
                    "message": "録音Dataが大きすぎます。15秒以内で録音してください。",
                    "request_id": request_id,
                },
            )

        try:
            result = await asyncio.to_thread(
                resolved_transcription_provider.transcribe,
                audio_bytes,
                media_type,
                request_id,
            )
        except TranscriptionProviderError as error:
            latency_ms = round((perf_counter() - started_at) * 1000)
            logger.warning(
                "transcription_failed request_id=%s provider=%s model=%s code=%s latency_ms=%s bytes=%s",
                request_id,
                resolved_transcription_provider.name,
                resolved_transcription_provider.model_name,
                error.code,
                latency_ms,
                len(audio_bytes),
            )
            raise HTTPException(
                status_code=error.status_code,
                detail={"code": error.code, "message": error.public_message, "request_id": request_id},
            ) from error

        latency_ms = round((perf_counter() - started_at) * 1000)
        logger.info(
            "transcription_completed request_id=%s provider=%s model=%s latency_ms=%s bytes=%s duration_seconds=%s",
            request_id,
            resolved_transcription_provider.name,
            resolved_transcription_provider.model_name,
            latency_ms,
            len(audio_bytes),
            result.audio_duration_seconds,
        )
        return TranscriptionResponse(
            text=result.text,
            language=result.language,
            language_probability=result.language_probability,
            audio_duration_seconds=result.audio_duration_seconds,
            request_id=request_id,
            latency_ms=latency_ms,
        )

    return app


def _memory_item(memory: PersistentMemory) -> PersistentMemoryItem:
    return PersistentMemoryItem(
        id=memory.id,
        content=memory.content,
        source=memory.source,
        created_at=memory.created_at,
        updated_at=memory.updated_at,
        use_count=memory.use_count,
    )


app = create_app()
