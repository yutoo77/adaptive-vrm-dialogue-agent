from pydantic import BaseModel, ConfigDict, Field


class VoiceSettings(BaseModel):
    """A request-local voice choice; it never changes the shared engine's defaults."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    speaker_id: int = Field(ge=0, le=100000, strict=True)
    speed_scale: float = Field(ge=0.6, le=1.6, strict=True)
    pitch_scale: float = Field(ge=-0.15, le=0.15, strict=True)
    intonation_scale: float = Field(ge=0, le=1.5, strict=True)


class VoiceOption(BaseModel):
    id: int
    name: str
    style: str
    credit: str


class VoiceCatalog(BaseModel):
    defaults: VoiceSettings
    voices: list[VoiceOption]


def prepare_speech_text(text: str) -> str:
    # VOICEVOX 0.25.2 reads this phrase as "わけ" before a comma. Scope the
    # correction to the reported phrase, preserving uses such as "五分" and "自分".
    return text.replace("忙しかった分", "忙しかったぶん")
