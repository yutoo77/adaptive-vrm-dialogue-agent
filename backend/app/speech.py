from __future__ import annotations

import io
import math
import wave
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx

from app.character_profile import DEFAULT_CHARACTER_PROFILE, CharacterProfile
from app.config import Settings

SpeechProviderName = Literal["voicevox"]
SpeechViseme = Literal["a", "i", "u", "e", "o"]
MAX_VISEME_SEGMENTS = 240
MAX_PHRASE_BOUNDARIES = 64


@dataclass(frozen=True, slots=True)
class SpeechHealth:
    available: bool
    engine_version: str | None
    message: str
    speaker_name: str | None = None
    style_name: str | None = None
    credit: str | None = None


@dataclass(frozen=True, slots=True)
class SpeechVisemeSegment:
    viseme: SpeechViseme
    start_ms: int
    duration_ms: int


@dataclass(frozen=True, slots=True)
class SpeechTiming:
    duration_ms: int
    phrase_boundaries_ms: tuple[int, ...]
    visemes: tuple[SpeechVisemeSegment, ...]


@dataclass(frozen=True, slots=True)
class SpeechSynthesisResult:
    audio: bytes
    timing: SpeechTiming | None


class SpeechProviderError(RuntimeError):
    def __init__(self, status_code: int, code: str, public_message: str) -> None:
        super().__init__(public_message)
        self.status_code = status_code
        self.code = code
        self.public_message = public_message


class SpeechProvider(Protocol):
    name: SpeechProviderName
    speaker_id: int

    async def check_health(self) -> SpeechHealth: ...

    async def synthesize(self, text: str, request_id: str) -> SpeechSynthesisResult: ...


class VoicevoxSpeechProvider:
    name: SpeechProviderName = "voicevox"

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
        profile: CharacterProfile = DEFAULT_CHARACTER_PROFILE,
    ) -> None:
        self.speaker_id = settings.voicevox_speaker_id
        self._base_url = settings.voicevox_base_url
        self._timeout = settings.voicevox_timeout_seconds
        self._transport = transport
        self._voice_profile = profile.voice

    async def check_health(self) -> SpeechHealth:
        speaker_name: str | None = None
        style_name: str | None = None
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                transport=self._transport,
            ) as client:
                response = await client.get("/version")
                response.raise_for_status()
                version = response.json()
                if not isinstance(version, str) or not version.strip():
                    raise ValueError("VOICEVOX returned an invalid version.")

                try:
                    speakers_response = await client.get("/speakers")
                    speakers_response.raise_for_status()
                    speaker_name, style_name = _find_speaker_details(
                        speakers_response.json(),
                        self.speaker_id,
                    )
                except (httpx.HTTPError, TypeError, ValueError):
                    pass
        except (httpx.HTTPError, ValueError):
            return SpeechHealth(
                available=False,
                engine_version=None,
                message="VOICEVOX Engineへ接続できません。起動状態と接続先を確認してください。",
            )

        return SpeechHealth(
            available=True,
            engine_version=version,
            message="VOICEVOX Engineは利用可能です。",
            speaker_name=speaker_name,
            style_name=style_name,
            credit=f"VOICEVOX:{speaker_name}" if speaker_name else None,
        )

    async def synthesize(self, text: str, request_id: str) -> SpeechSynthesisResult:
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                transport=self._transport,
            ) as client:
                query_response = await client.post(
                    "/audio_query",
                    params={"text": text, "speaker": self.speaker_id},
                    headers={"X-Client-Request-Id": request_id},
                )
                query_response.raise_for_status()
                audio_query = query_response.json()
                if not isinstance(audio_query, dict):
                    raise ValueError("VOICEVOX returned an invalid audio query.")
                audio_query["speedScale"] = self._voice_profile.speed_scale
                audio_query["pitchScale"] = self._voice_profile.pitch_scale
                audio_query["intonationScale"] = self._voice_profile.intonation_scale

                audio_response = await client.post(
                    "/synthesis",
                    params={"speaker": self.speaker_id},
                    json=audio_query,
                    headers={"Accept": "audio/wav", "X-Client-Request-Id": request_id},
                )
                audio_response.raise_for_status()
        except httpx.TimeoutException as error:
            raise SpeechProviderError(
                504,
                "voicevox_timeout",
                "VOICEVOXの音声生成が時間内に完了しませんでした。",
            ) from error
        except httpx.ConnectError as error:
            raise SpeechProviderError(
                503,
                "voicevox_unreachable",
                "VOICEVOX Engineへ接続できません。起動してから再試行してください。",
            ) from error
        except httpx.HTTPStatusError as error:
            raise SpeechProviderError(
                502,
                "voicevox_error",
                "VOICEVOX Engineで音声を生成できませんでした。話者設定を確認してください。",
            ) from error
        except httpx.RequestError as error:
            raise SpeechProviderError(
                503,
                "voicevox_unreachable",
                "VOICEVOX Engineとの通信に失敗しました。",
            ) from error
        except (TypeError, ValueError) as error:
            raise SpeechProviderError(
                502,
                "invalid_voicevox_response",
                "VOICEVOX Engineから不正な応答が返りました。",
            ) from error

        audio = audio_response.content
        if len(audio) < 12 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
            raise SpeechProviderError(
                502,
                "invalid_voicevox_audio",
                "VOICEVOX Engineから有効なWAV音声が返りませんでした。",
            )
        return SpeechSynthesisResult(audio=audio, timing=build_voicevox_timing(audio_query, audio))


def build_speech_provider(
    settings: Settings,
    profile: CharacterProfile = DEFAULT_CHARACTER_PROFILE,
) -> SpeechProvider:
    return VoicevoxSpeechProvider(settings, profile=profile)


def _find_speaker_details(payload: object, speaker_id: int) -> tuple[str | None, str | None]:
    if not isinstance(payload, list):
        return None, None

    for speaker in payload:
        if not isinstance(speaker, dict):
            continue
        speaker_name = speaker.get("name")
        styles = speaker.get("styles")
        if not isinstance(speaker_name, str) or not isinstance(styles, list):
            continue
        for style in styles:
            if not isinstance(style, dict) or style.get("id") != speaker_id:
                continue
            style_name = style.get("name")
            return speaker_name, style_name if isinstance(style_name, str) else None
    return None, None


def build_voicevox_timing(audio_query: object, audio: bytes) -> SpeechTiming | None:
    """Convert VOICEVOX mora lengths into a bounded timeline scaled to the actual WAV."""

    duration_ms = _wav_duration_ms(audio)
    if duration_ms is None or not isinstance(audio_query, dict):
        return None

    phrases = audio_query.get("accent_phrases")
    if not isinstance(phrases, list):
        return SpeechTiming(duration_ms=duration_ms, phrase_boundaries_ms=(), visemes=())

    cursor_seconds = _non_negative_seconds(audio_query.get("prePhonemeLength"))
    raw_visemes: list[tuple[SpeechViseme, float, float]] = []
    raw_boundaries: list[float] = []
    for phrase_index, phrase in enumerate(phrases):
        if not isinstance(phrase, dict):
            continue
        moras = phrase.get("moras")
        if isinstance(moras, list):
            for mora in moras:
                if not isinstance(mora, dict):
                    continue
                segment_start = cursor_seconds
                cursor_seconds += _non_negative_seconds(mora.get("consonant_length"))
                cursor_seconds += _non_negative_seconds(mora.get("vowel_length"))
                viseme = _voicevox_vowel_to_viseme(mora.get("vowel"))
                if viseme and cursor_seconds > segment_start:
                    raw_visemes.append((viseme, segment_start, cursor_seconds))

        if phrase_index < len(phrases) - 1:
            raw_boundaries.append(cursor_seconds)
        pause_mora = phrase.get("pause_mora")
        if isinstance(pause_mora, dict):
            cursor_seconds += _non_negative_seconds(pause_mora.get("consonant_length"))
            cursor_seconds += _non_negative_seconds(pause_mora.get("vowel_length"))

    cursor_seconds += _non_negative_seconds(audio_query.get("postPhonemeLength"))
    if cursor_seconds <= 0:
        return SpeechTiming(duration_ms=duration_ms, phrase_boundaries_ms=(), visemes=())

    scale = duration_ms / (cursor_seconds * 1000)
    return SpeechTiming(
        duration_ms=duration_ms,
        phrase_boundaries_ms=_scaled_boundaries(raw_boundaries, scale, duration_ms),
        visemes=_scaled_visemes(raw_visemes, scale, duration_ms),
    )


def speech_timing_headers(timing: SpeechTiming | None) -> dict[str, str]:
    if timing is None:
        return {}
    headers = {
        "X-Speech-Timing-Version": "1",
        "X-Speech-Duration-Ms": str(timing.duration_ms),
    }
    if timing.phrase_boundaries_ms:
        headers["X-Speech-Phrase-Boundaries"] = ",".join(map(str, timing.phrase_boundaries_ms))
    if timing.visemes:
        headers["X-Speech-Visemes"] = ",".join(
            f"{segment.viseme}:{segment.start_ms}:{segment.duration_ms}" for segment in timing.visemes
        )
    return headers


def _wav_duration_ms(audio: bytes) -> int | None:
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav_file:
            frame_rate = wav_file.getframerate()
            if frame_rate <= 0:
                return None
            return max(1, round(wav_file.getnframes() / frame_rate * 1000))
    except (EOFError, wave.Error):
        return None


def _non_negative_seconds(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    result = float(value)
    return result if math.isfinite(result) and result >= 0 else 0


def _voicevox_vowel_to_viseme(value: object) -> SpeechViseme | None:
    if not isinstance(value, str):
        return None
    normalized = value.casefold()
    if normalized == "a":
        return "a"
    if normalized == "i":
        return "i"
    if normalized == "u":
        return "u"
    if normalized == "e":
        return "e"
    if normalized == "o":
        return "o"
    return None


def _scaled_boundaries(values: list[float], scale: float, duration_ms: int) -> tuple[int, ...]:
    result: list[int] = []
    for value in values:
        boundary = round(value * 1000 * scale)
        if boundary < 150 or boundary > duration_ms - 150:
            continue
        if result and boundary - result[-1] < 80:
            continue
        result.append(boundary)
        if len(result) == MAX_PHRASE_BOUNDARIES:
            break
    return tuple(result)


def _scaled_visemes(
    values: list[tuple[SpeechViseme, float, float]],
    scale: float,
    duration_ms: int,
) -> tuple[SpeechVisemeSegment, ...]:
    segments: list[SpeechVisemeSegment] = []
    for viseme, raw_start, raw_end in values:
        start_ms = max(0, min(duration_ms - 1, round(raw_start * 1000 * scale)))
        end_ms = max(start_ms + 1, min(duration_ms, round(raw_end * 1000 * scale)))
        if segments and segments[-1].viseme == viseme and start_ms - (
            segments[-1].start_ms + segments[-1].duration_ms
        ) <= 30:
            previous = segments[-1]
            segments[-1] = SpeechVisemeSegment(
                viseme=viseme,
                start_ms=previous.start_ms,
                duration_ms=end_ms - previous.start_ms,
            )
        else:
            segments.append(SpeechVisemeSegment(viseme=viseme, start_ms=start_ms, duration_ms=end_ms - start_ms))
        if len(segments) > MAX_VISEME_SEGMENTS:
            return ()
    return tuple(segments)
