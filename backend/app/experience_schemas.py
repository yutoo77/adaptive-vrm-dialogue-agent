from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.performance import PerformancePlan

ExperienceSessionId = Annotated[str, Field(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
ExperienceTarget = Literal["window", "letter", "box"]
Bookmark = Literal["half", "full", "crescent"]
Arrangement = Annotated[list[Bookmark | None], Field(min_length=3, max_length=3)]


class ExperienceStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    session_id: ExperienceSessionId


class ExperienceActionRequest(ExperienceStartRequest):
    expected_revision: int = Field(ge=0)
    action: Literal["inspect", "hint", "arrange", "submit", "message"]
    target: ExperienceTarget | None = None
    arrangement: Arrangement | None = None
    message: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("message must contain text")
        return value

    @model_validator(mode="after")
    def validate_action_arguments(self) -> ExperienceActionRequest:
        required = {"inspect": "target", "arrange": "arrangement", "message": "message"}.get(self.action)
        optional_fields = self.model_fields_set - {"session_id", "expected_revision", "action"}
        if optional_fields != ({required} if required else set()):
            raise ValueError("provide exactly the arguments required by the action")
        if required and getattr(self, required) is None:
            raise ValueError(f"{required} is required")
        if self.arrangement is not None:
            placed = [item for item in self.arrangement if item is not None]
            if len(set(placed)) != len(placed):
                raise ValueError("a bookmark may only occupy one slot")
        return self


class ExperienceMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=1000)


class ExperienceSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: ExperienceSessionId
    revision: int = Field(ge=0)
    phase: Literal["active", "solved"]
    inspected: list[ExperienceTarget] = Field(max_length=3)
    hint_level: int = Field(ge=0, le=3)
    arrangement: Arrangement
    attempts: int = Field(ge=0)
    reply: str = Field(min_length=1, max_length=1000)
    performance: PerformancePlan
    focus_target: ExperienceTarget | None
    messages: list[ExperienceMessage] = Field(max_length=24)
    narration_provider: Literal["scripted", "openai"]
    notice: str | None


class ExperienceCancellationResponse(BaseModel):
    cancelled: bool
