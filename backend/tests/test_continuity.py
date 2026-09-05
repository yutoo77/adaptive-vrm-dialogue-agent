from app.continuity import EmotionalContinuityStore
from app.performance import PerformancePlan


def plan(
    emotion: str = "neutral",
    intensity: float = 0.35,
    gesture: str = "small_nod",
) -> PerformancePlan:
    return PerformancePlan.model_validate(
        {
            "emotion": emotion,
            "intensity": intensity,
            "gesture": gesture,
            "voice_style": {
                "neutral": "neutral",
                "happy": "bright",
                "gentle": "gentle",
                "curious": "warm",
                "cautious": "serious",
                "confused": "serious",
            }[emotion],
            "cues": [],
        }
    )


def test_non_neutral_emotion_has_two_turns_of_decaying_residue() -> None:
    store = EmotionalContinuityStore(max_carry_turns=2)

    initial = store.resolve("session-a", plan("gentle", 0.58))
    first_carry = store.resolve("session-a", plan())
    second_carry = store.resolve("session-a", plan())
    expired = store.resolve("session-a", plan())

    assert initial.continuity.emotion == "gentle"
    assert initial.continuity.carried_from_previous is False
    assert first_carry.continuity.emotion == "gentle"
    assert first_carry.continuity.intensity == 0.36
    assert first_carry.continuity.carried_from_previous is True
    assert first_carry.continuity.turns_held == 2
    assert second_carry.continuity.emotion == "gentle"
    assert second_carry.continuity.carried_from_previous is True
    assert expired.continuity.emotion == "neutral"
    assert expired.continuity.carried_from_previous is False
    assert expired.continuity.turns_held == 1


def test_explicit_new_emotion_replaces_residue_immediately() -> None:
    store = EmotionalContinuityStore()
    store.resolve("session-a", plan("gentle", 0.58))

    changed = store.resolve(
        "session-a",
        plan("gentle", 0.4),
        user_message="少し嬉しい。気持ちが軽くなった。",
    )

    assert changed.continuity.emotion == "happy"
    assert changed.continuity.carried_from_previous is False
    assert changed.continuity.gaze_behavior == "engaged"
    assert changed.performance.voice_style == "bright"


def test_repeated_low_intensity_gesture_is_suppressed_between_turns() -> None:
    store = EmotionalContinuityStore()
    first = store.resolve("session-a", plan("gentle", 0.5))
    repeated = store.resolve("session-a", plan("gentle", 0.5))

    assert first.performance.gesture == "small_nod"
    assert repeated.performance.gesture == "none"
    assert repeated.continuity.gesture_budget == 1


def test_quiet_reply_can_carry_a_gentle_expression_without_adding_a_gesture() -> None:
    store = EmotionalContinuityStore()
    store.resolve("session-a", plan("gentle", 0.4))
    quiet = store.resolve("session-a", plan("neutral", 0.2, "none"))

    assert quiet.performance.emotion == "gentle"
    assert quiet.continuity.carried_from_previous is True
    assert quiet.performance.gesture == "none"
    assert quiet.performance.cues == []


def test_sessions_are_isolated_bounded_and_resettable() -> None:
    store = EmotionalContinuityStore(max_sessions=1)
    store.resolve("session-a", plan("gentle", 0.5))
    store.resolve("session-b", plan("curious", 0.5, "head_tilt"))

    assert store.current("session-a") is None
    assert store.current("session-b") is not None
    assert store.reset("session-b") is True
    assert store.reset("session-b") is False
