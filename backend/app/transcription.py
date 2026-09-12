from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from threading import Lock
from typing import Protocol

from faster_whisper import WhisperModel

from app.config import Settings


@dataclass(frozen=True, slots=True)
class TranscriptionResult:
    text: str
    language: str
    language_probability: float
    audio_duration_seconds: float


class TranscriptionProviderError(RuntimeError):
    def __init__(self, status_code: int, code: str, public_message: str) -> None:
        super().__init__(public_message)
        self.status_code = status_code
        self.code = code
        self.public_message = public_message


class TranscriptionProvider(Protocol):
    name: str
    model_name: str
    device: str
    compute_type: str

    @property
    def model_loaded(self) -> bool: ...

    def transcribe(self, audio: bytes, media_type: str, request_id: str) -> TranscriptionResult: ...

    def prepare(self) -> None: ...


class FasterWhisperTranscriptionProvider:
    name = "faster-whisper"

    def __init__(self, settings: Settings) -> None:
        self.model_name = settings.transcription_model
        self.device = settings.transcription_device
        self.compute_type = settings.transcription_compute_type
        self._model: WhisperModel | None = None
        self._model_lock = Lock()
        self._inference_lock = Lock()

    @property
    def model_loaded(self) -> bool:
        return self._model is not None

    def transcribe(self, audio: bytes, media_type: str, request_id: str) -> TranscriptionResult:
        del media_type, request_id
        self._claim_capacity()
        # The worker owns capacity until it actually finishes, even if HTTP is cancelled.
        try:
            model = self._get_model()
            try:
                segments, info = model.transcribe(
                    BytesIO(audio),
                    language="ja",
                    task="transcribe",
                    beam_size=5,
                    vad_filter=True,
                    condition_on_previous_text=False,
                )
                text = "".join(segment.text for segment in segments).strip()
            except Exception as error:
                raise TranscriptionProviderError(
                    422,
                    "invalid_audio",
                    "録音データを音声として読み取れませんでした。もう一度録音してください。",
                ) from error
        finally:
            self._inference_lock.release()

        if not text:
            raise TranscriptionProviderError(
                422,
                "no_speech",
                "音声を認識できませんでした。マイクへ近づいて、もう一度話してください。",
            )

        return TranscriptionResult(
            text=text[:1000],
            language=info.language,
            language_probability=float(info.language_probability),
            audio_duration_seconds=round(float(info.duration), 3),
        )

    def prepare(self) -> None:
        if self.model_loaded:
            return
        self._claim_capacity()
        try:
            self._get_model(local_files_only=True)
        finally:
            self._inference_lock.release()

    def _claim_capacity(self) -> None:
        if not self._inference_lock.acquire(blocking=False):
            raise TranscriptionProviderError(
                429,
                "transcription_busy",
                "前の音声をまだ処理しています。少し待ってから、もう一度録音してください。",
            )

    def _get_model(self, *, local_files_only: bool = False) -> WhisperModel:
        if self._model is not None:
            return self._model
        with self._model_lock:
            if self._model is None:
                try:
                    self._model = WhisperModel(
                        self.model_name,
                        device=self.device,
                        compute_type=self.compute_type,
                        local_files_only=local_files_only,
                    )
                except Exception as error:
                    if local_files_only:
                        raise TranscriptionProviderError(
                            503,
                            "transcription_model_not_cached",
                            "取得済みの音声認識モデルを読み込めません。READMEのモデル準備手順と設定を確認してください。",
                        ) from error
                    raise TranscriptionProviderError(
                        503,
                        "transcription_model_unavailable",
                        "音声認識モデルを準備できませんでした。ネットワーク接続と設定を確認してください。",
                    ) from error
        return self._model


def build_transcription_provider(settings: Settings) -> TranscriptionProvider:
    return FasterWhisperTranscriptionProvider(settings)
