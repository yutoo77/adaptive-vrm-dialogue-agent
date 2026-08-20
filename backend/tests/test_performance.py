import pytest
from pydantic import ValidationError

from app.performance import PerformancePlan, select_mock_performance


@pytest.mark.parametrize(
    ("message", "expected_emotion", "expected_gesture"),
    [
        ("こんにちは", "happy", "soft_bounce"),
        ("今日は少し疲れた", "gentle", "small_nod"),
        ("どうして空は青いの？", "curious", "head_tilt"),
        ("危険性を確認して", "cautious", "small_nod"),
        ("どういう意味かわからない", "confused", "head_tilt"),
        ("続きを話そう", "neutral", "small_nod"),
        ("別に嬉しくないよ", "gentle", "small_nod"),
        ("最高だね。全部壊れたけど。", "cautious", "small_nod"),
    ],
)
def test_mock_performance_is_deterministic_and_bounded(
    message: str,
    expected_emotion: str,
    expected_gesture: str,
) -> None:
    plan = select_mock_performance(message, "応答です。")

    assert plan.emotion == expected_emotion
    assert plan.gesture == expected_gesture
    assert 0 <= plan.intensity <= 1


def test_performance_plan_rejects_arbitrary_commands_and_out_of_range_intensity() -> None:
    with pytest.raises(ValidationError):
        PerformancePlan.model_validate(
            {
                "emotion": "angry",
                "intensity": 3,
                "gesture": "run_shell_command",
                "voice_style": "neutral",
                "cues": [],
                "bone_rotation": 999,
            }
        )


def test_mock_performance_builds_at_most_two_ordered_sentence_boundary_cues() -> None:
    plan = select_mock_performance(
        "何ができるの？",
        "まず入力を受け取るよ。次に内容へ返答するよ。最後に音声と表情を合わせるよ。",
    )

    assert 1 <= len(plan.cues) <= 2
    assert all(0.2 <= cue.at <= 0.82 for cue in plan.cues)
    assert all(cue.gesture != "none" for cue in plan.cues)
    assert all(cue.intensity < plan.intensity for cue in plan.cues)
    assert all(right.at - left.at >= 0.15 for left, right in zip(plan.cues, plan.cues[1:], strict=False))


@pytest.mark.parametrize(
    "cues",
    [
        [{"at": 0.5, "gesture": "none", "intensity": 0.4}],
        [
            {"at": 0.5, "gesture": "small_nod", "intensity": 0.4},
            {"at": 0.55, "gesture": "head_tilt", "intensity": 0.3},
        ],
        [
            {"at": 0.25, "gesture": "small_nod", "intensity": 0.4},
            {"at": 0.5, "gesture": "head_tilt", "intensity": 0.3},
            {"at": 0.75, "gesture": "small_nod", "intensity": 0.3},
        ],
    ],
)
def test_performance_plan_rejects_unsafe_cue_sequences(cues: list[dict[str, object]]) -> None:
    with pytest.raises(ValidationError):
        PerformancePlan.model_validate(
            {
                "emotion": "neutral",
                "intensity": 0.5,
                "gesture": "small_nod",
                "voice_style": "neutral",
                "cues": cues,
            }
        )
