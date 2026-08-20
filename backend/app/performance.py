from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PerformanceEmotion = Literal["neutral", "happy", "gentle", "curious", "cautious", "confused"]
PerformanceGesture = Literal["none", "small_nod", "head_tilt", "soft_bounce"]
VoiceStyle = Literal["neutral", "warm", "bright", "gentle", "serious"]


class PerformanceCue(BaseModel):
    """A single bounded gesture scheduled at a normalized point in speech playback."""

    model_config = ConfigDict(extra="forbid")

    at: float = Field(ge=0.2, le=0.82, description="音声の20%から82%の間で再生する位置。")
    gesture: PerformanceGesture = Field(description="途中で一度だけ行う固定一覧内の小さなしぐさ。")
    intensity: float = Field(ge=0, le=1, description="途中しぐさの強さ。通常は全体より弱くする。")


class PerformancePlan(BaseModel):
    """A bounded, presentation-only plan. It never contains arbitrary animation commands."""

    model_config = ConfigDict(extra="forbid")

    emotion: PerformanceEmotion = Field(description="返答全体の感情。誇張せず最も近いものを1つ選ぶ。")
    intensity: float = Field(ge=0, le=1, description="演技の強さ。通常は0.3から0.7に収める。")
    gesture: PerformanceGesture = Field(description="返答開始時に一度だけ行う小さなしぐさ。")
    voice_style: VoiceStyle = Field(description="音声再生時の控えめなテンポのニュアンス。")
    cues: list[PerformanceCue] = Field(
        min_length=0,
        max_length=2,
        description="発話途中の追加しぐさ。開始しぐさと合わせて最大3回に制限する。",
    )

    @model_validator(mode="after")
    def validate_cue_sequence(self) -> PerformancePlan:
        previous_at: float | None = None
        for cue in self.cues:
            if cue.gesture == "none":
                raise ValueError("performance cues must contain an actual gesture")
            if previous_at is not None and cue.at - previous_at < 0.15:
                raise ValueError("performance cues must be ordered and at least 0.15 apart")
            previous_at = cue.at
        return self


class StructuredDialogueOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reply: str = Field(min_length=1, max_length=1000)
    performance: PerformancePlan


def select_mock_performance(message: str, reply: str) -> PerformancePlan:
    """Choose a deterministic local performance so Mock mode remains free and testable."""

    text = f"{message}\n{reply}".casefold()
    negated_positive_words = ("嬉しくない", "楽しくない", "喜べない", "よくなかった")
    if _contains_any(text, negated_positive_words):
        plan = PerformancePlan(
            emotion="gentle", intensity=0.52, gesture="small_nod", voice_style="gentle", cues=[]
        )
    elif _contains_any(text, ("つら", "悲し", "落ち込", "疲れ", "不安", "怖", "しんど", "寂し")):
        plan = PerformancePlan(
            emotion="gentle", intensity=0.58, gesture="small_nod", voice_style="gentle", cues=[]
        )
    elif _contains_any(
        text,
        (
            "危険",
            "注意",
            "確認して",
            "慎重",
            "リスク",
            "できません",
            "無理",
            "壊れた",
            "壊れちゃ",
            "故障",
            "事故",
            "失敗した",
        ),
    ):
        plan = PerformancePlan(
            emotion="cautious", intensity=0.5, gesture="small_nod", voice_style="serious", cues=[]
        )
    elif _contains_any(text, ("わからない", "分からない", "意味不明", "どういう意味", "聞き返")):
        plan = PerformancePlan(
            emotion="confused", intensity=0.48, gesture="head_tilt", voice_style="serious", cues=[]
        )
    elif _contains_any(
        text,
        ("こんにちは", "こんばんは", "おはよう", "ありがとう", "嬉しい", "楽しい", "最高", "やった"),
    ):
        plan = PerformancePlan(
            emotion="happy", intensity=0.64, gesture="soft_bounce", voice_style="bright", cues=[]
        )
    elif "?" in text or "？" in text or _contains_any(text, ("なぜ", "どうして", "どんな", "何が", "なにが")):
        plan = PerformancePlan(
            emotion="curious", intensity=0.52, gesture="head_tilt", voice_style="warm", cues=[]
        )
    else:
        plan = PerformancePlan(
            emotion="neutral", intensity=0.35, gesture="small_nod", voice_style="neutral", cues=[]
        )
    return plan.model_copy(update={"cues": _select_mock_cues(reply, plan)})


def _select_mock_cues(reply: str, plan: PerformancePlan) -> list[PerformanceCue]:
    """Use sentence boundaries as deterministic pacing hints, never arbitrary animation data."""

    clauses = [clause.strip() for clause in re.split(r"[。！？!?]+", reply) if clause.strip()]
    if len(clauses) < 2:
        return []

    total_length = sum(len(clause) for clause in clauses)
    if total_length == 0:
        return []

    gestures: tuple[PerformanceGesture, PerformanceGesture]
    if plan.emotion in ("curious", "confused"):
        gestures = ("small_nod", "head_tilt")
    elif plan.gesture == "soft_bounce":
        gestures = ("small_nod", "head_tilt")
    else:
        gestures = ("small_nod", "small_nod")

    cues: list[PerformanceCue] = []
    consumed = 0
    for boundary_index, clause in enumerate(clauses[:-1]):
        consumed += len(clause)
        at = consumed / total_length
        if at < 0.2 or at > 0.82:
            continue
        if cues and at - cues[-1].at < 0.15:
            continue
        cue_index = len(cues)
        cues.append(
            PerformanceCue(
                at=round(at, 3),
                gesture=gestures[cue_index],
                intensity=round(max(0.25, min(0.65, plan.intensity * (0.72 - cue_index * 0.1))), 3),
            )
        )
        if len(cues) == 2 or boundary_index == len(clauses) - 2:
            break
    return cues


def _contains_any(text: str, words: tuple[str, ...]) -> bool:
    return any(word in text for word in words)
