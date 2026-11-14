from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.character_profile import (
    DEFAULT_CHARACTER_PROFILE,
    CharacterProfile,
    align_performance_with_character,
)
from app.performance import PerformanceEmotion, PerformanceGesture, PerformancePlan

GazeBehavior = Literal["responsive", "engaged", "soft", "curious", "steady", "searching"]


class EmotionalContinuity(BaseModel):
    """Short-lived, presentation-only emotional residue for one RAM session."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    emotion: PerformanceEmotion
    intensity: float = Field(ge=0, le=1)
    turn_index: int = Field(ge=1)
    turns_held: int = Field(ge=1)
    carried_from_previous: bool
    gaze_behavior: GazeBehavior
    motion_scale: float = Field(ge=0.4, le=1.2)
    gesture_budget: int = Field(ge=0, le=3)


@dataclass(frozen=True, slots=True)
class ContinuityResolution:
    performance: PerformancePlan
    continuity: EmotionalContinuity


@dataclass(frozen=True, slots=True)
class _StoredContinuity:
    public: EmotionalContinuity
    carry_count: int
    last_gesture: PerformanceGesture


class EmotionalContinuityStore:
    """Bounded per-session affect with deterministic decay and no disk persistence."""

    def __init__(self, max_sessions: int = 32, max_carry_turns: int = 2) -> None:
        if max_sessions < 1 or max_carry_turns < 0:
            raise ValueError("Emotional continuity limits must be valid.")
        self.max_sessions = max_sessions
        self.max_carry_turns = max_carry_turns
        self._sessions: OrderedDict[str, _StoredContinuity] = OrderedDict()

    def current(self, session_id: str) -> EmotionalContinuity | None:
        state = self._sessions.get(session_id)
        if state is None:
            return None
        self._sessions.move_to_end(session_id)
        return state.public

    def resolve(
        self,
        session_id: str,
        plan: PerformancePlan,
        profile: CharacterProfile = DEFAULT_CHARACTER_PROFILE,
        user_message: str | None = None,
    ) -> ContinuityResolution:
        previous = self._sessions.get(session_id)
        if previous is not None:
            self._sessions.move_to_end(session_id)

        emotion = plan.emotion
        intensity = plan.intensity
        carried = False
        carry_count = 0
        turns_held = 1
        explicit_emotion = _explicit_user_emotion(user_message)

        if explicit_emotion is not None and explicit_emotion != emotion:
            emotion = explicit_emotion
            intensity = max(intensity, 0.48 if explicit_emotion == "happy" else 0.42)
        elif previous is not None:
            previous_public = previous.public
            if (
                emotion == "neutral"
                and previous_public.emotion != "neutral"
                and previous_public.intensity >= 0.28
                and previous.carry_count < self.max_carry_turns
            ):
                emotion = previous_public.emotion
                intensity = max(plan.intensity * 0.72, previous_public.intensity * 0.62)
                carried = True
                carry_count = previous.carry_count + 1
                turns_held = previous_public.turns_held + 1
            elif emotion == previous_public.emotion:
                intensity = plan.intensity * 0.76 + previous_public.intensity * 0.24
                turns_held = previous_public.turns_held + 1

        aligned = align_performance_with_character(
            plan.model_copy(update={"emotion": emotion, "intensity": round(intensity, 3)}),
            profile,
            scale_cues=False,
        )
        gesture_budget = _gesture_budget(aligned.emotion, aligned.intensity, carried)
        aligned = _apply_gesture_rhythm(aligned, previous, gesture_budget)
        continuity = EmotionalContinuity(
            emotion=aligned.emotion,
            intensity=aligned.intensity,
            turn_index=(previous.public.turn_index + 1) if previous else 1,
            turns_held=turns_held,
            carried_from_previous=carried,
            gaze_behavior=_gaze_behavior(aligned.emotion),
            motion_scale=_motion_scale(aligned.emotion, aligned.intensity),
            gesture_budget=gesture_budget,
        )

        if len(self._sessions) >= self.max_sessions and session_id not in self._sessions:
            self._sessions.popitem(last=False)
        self._sessions[session_id] = _StoredContinuity(
            public=continuity,
            carry_count=carry_count,
            last_gesture=aligned.gesture,
        )
        return ContinuityResolution(performance=aligned, continuity=continuity)

    def reset(self, session_id: str) -> bool:
        return self._sessions.pop(session_id, None) is not None


def _gesture_budget(emotion: PerformanceEmotion, intensity: float, carried: bool) -> int:
    if intensity < 0.25:
        return 0
    if carried or emotion in ("neutral", "gentle", "cautious", "confused"):
        return 1
    if emotion in ("happy", "curious") and intensity >= 0.48:
        return 2
    return 1


def _apply_gesture_rhythm(
    plan: PerformancePlan,
    previous: _StoredContinuity | None,
    gesture_budget: int,
) -> PerformancePlan:
    gesture = plan.gesture
    if gesture_budget == 0:
        gesture = "none"
    elif (
        previous is not None
        and gesture != "none"
        and gesture == previous.last_gesture
        and plan.intensity < 0.65
    ):
        gesture = "none"

    remaining = max(0, gesture_budget - (0 if gesture == "none" else 1))
    cues = []
    for cue in plan.cues:
        if len(cues) >= remaining:
            break
        if cue.gesture == gesture or (previous is not None and cue.gesture == previous.last_gesture):
            continue
        cues.append(cue)
    return plan.model_copy(update={"gesture": gesture, "cues": cues})


def _gaze_behavior(emotion: PerformanceEmotion) -> GazeBehavior:
    return {
        "neutral": "responsive",
        "happy": "engaged",
        "gentle": "soft",
        "curious": "curious",
        "cautious": "steady",
        "confused": "searching",
    }[emotion]


def _motion_scale(emotion: PerformanceEmotion, intensity: float) -> float:
    base = {
        "neutral": 0.82,
        "happy": 0.94,
        "gentle": 0.62,
        "curious": 0.82,
        "cautious": 0.54,
        "confused": 0.68,
    }[emotion]
    return round(min(1.2, max(0.4, base + intensity * 0.16)), 3)


def _explicit_user_emotion(message: str | None) -> PerformanceEmotion | None:
    if not message:
        return None
    normalized = message.casefold()
    if any(
        marker in normalized
        for marker in (
            "嬉しい",
            "うれしい",
            "楽しい",
            "気持ちが軽く",
            "元気が出",
            "ほっとした",
            "安心した",
        )
    ):
        return "happy"
    if any(
        marker in normalized
        for marker in ("疲れた", "疲れて", "つらい", "悲しい", "しんどい", "寂しい")
    ):
        return "gentle"
    return None
