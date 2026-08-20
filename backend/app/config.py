from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal, cast
from urllib.parse import urlparse

ProviderName = Literal["mock", "openai"]
TranscriptionDevice = Literal["cpu", "cuda"]


class ConfigurationError(ValueError):
    """Raised when an environment setting cannot be used safely."""


def _read_number(name: str, default: str, minimum: float, maximum: float) -> float:
    raw_value = os.getenv(name, default).strip()
    try:
        value = float(raw_value)
    except ValueError as error:
        raise ConfigurationError(f"{name} must be a number.") from error
    if not minimum <= value <= maximum:
        raise ConfigurationError(f"{name} must be between {minimum} and {maximum}.")
    return value


def _read_local_http_url(name: str, default: str) -> str:
    raw_value = os.getenv(name, default).strip().rstrip("/")
    parsed = urlparse(raw_value)
    try:
        _ = parsed.port
    except ValueError as error:
        raise ConfigurationError(f"{name} must contain a valid port.") from error
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ConfigurationError(f"{name} must be a local HTTP URL.")
    if parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ConfigurationError(
            f"{name} must not contain credentials, a path, a query, or a fragment."
        )
    return raw_value


@dataclass(frozen=True, slots=True)
class Settings:
    provider: ProviderName = "mock"
    openai_api_key: str | None = field(default=None, repr=False)
    openai_model: str = "gpt-5.6-luna"
    request_timeout_seconds: float = 30.0
    max_output_tokens: int = 240
    voicevox_base_url: str = "http://127.0.0.1:50021"
    voicevox_speaker_id: int = 14
    voicevox_timeout_seconds: float = 30.0
    transcription_model: str = "small"
    transcription_device: TranscriptionDevice = "cpu"
    transcription_compute_type: str = "int8"

    @property
    def api_key_configured(self) -> bool:
        return bool(self.openai_api_key)

    @classmethod
    def from_env(cls) -> Settings:
        raw_provider = os.getenv("DIALOGUE_PROVIDER", "mock").strip().lower()
        if raw_provider not in {"mock", "openai"}:
            raise ConfigurationError("DIALOGUE_PROVIDER must be either 'mock' or 'openai'.")

        model = os.getenv("OPENAI_MODEL", "gpt-5.6-luna").strip()
        if not model:
            raise ConfigurationError("OPENAI_MODEL must not be empty.")

        timeout = _read_number("DIALOGUE_TIMEOUT_SECONDS", "30", 1, 120)
        max_output_tokens = int(_read_number("DIALOGUE_MAX_OUTPUT_TOKENS", "240", 32, 2000))
        voicevox_base_url = _read_local_http_url(
            "VOICEVOX_BASE_URL",
            "http://127.0.0.1:50021",
        )
        voicevox_speaker_id = int(_read_number("VOICEVOX_SPEAKER_ID", "14", 0, 100000))
        voicevox_timeout = _read_number("VOICEVOX_TIMEOUT_SECONDS", "30", 1, 120)
        transcription_model = os.getenv("TRANSCRIPTION_MODEL", "small").strip()
        if transcription_model not in {"tiny", "base", "small", "medium", "large-v3", "turbo"}:
            raise ConfigurationError("TRANSCRIPTION_MODEL is not supported.")
        raw_transcription_device = os.getenv("TRANSCRIPTION_DEVICE", "cpu").strip().lower()
        if raw_transcription_device not in {"cpu", "cuda"}:
            raise ConfigurationError("TRANSCRIPTION_DEVICE must be either 'cpu' or 'cuda'.")
        transcription_compute_type = os.getenv("TRANSCRIPTION_COMPUTE_TYPE", "int8").strip().lower()
        if transcription_compute_type not in {"int8", "float16", "int8_float16"}:
            raise ConfigurationError("TRANSCRIPTION_COMPUTE_TYPE is not supported.")
        api_key = os.getenv("OPENAI_API_KEY", "").strip() or None

        return cls(
            provider=cast(ProviderName, raw_provider),
            openai_api_key=api_key,
            openai_model=model,
            request_timeout_seconds=timeout,
            max_output_tokens=max_output_tokens,
            voicevox_base_url=voicevox_base_url,
            voicevox_speaker_id=voicevox_speaker_id,
            voicevox_timeout_seconds=voicevox_timeout,
            transcription_model=transcription_model,
            transcription_device=cast(TranscriptionDevice, raw_transcription_device),
            transcription_compute_type=transcription_compute_type,
        )
