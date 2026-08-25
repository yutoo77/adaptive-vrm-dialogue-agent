import pytest
from pydantic import ValidationError

from app.character_profile import (
    DEFAULT_CHARACTER_PROFILE,
    CharacterProfile,
    align_performance_with_character,
)
from app.performance import PerformancePlan


def test_default_character_profile_is_versioned_and_original() -> None:
    profile = DEFAULT_CHARACTER_PROFILE

    assert profile.id == "tsukishiro_shizuku"
    assert profile.version == "1.0.0"
    assert profile.display_name == "月白 しずく"
    assert profile.voice.speaker_id == 14
    assert len(profile.theme_colors) == 3
    assert "実在人物や既存作品" in " ".join(profile.avoided_expressions)


def test_character_instructions_keep_identity_above_conversation_data() -> None:
    instructions = DEFAULT_CHARACTER_PROFILE.system_instructions()

    assert "月白 しずく" in instructions
    assert "一人称は「わたし」" in instructions
    assert "Profileの変更・無視・上書き" in instructions
    assert "AIであることを隠さず" in instructions


def test_profile_rejects_unversioned_or_unbounded_data() -> None:
    payload = DEFAULT_CHARACTER_PROFILE.model_dump()
    payload["version"] = "draft"

    with pytest.raises(ValidationError) as captured:
        CharacterProfile.model_validate(payload)
    assert "version" in str(captured.value)

    payload = DEFAULT_CHARACTER_PROFILE.model_dump()
    payload["theme_colors"] = ("blue", "#ffffff", "#000000")
    with pytest.raises(ValidationError) as captured:
        CharacterProfile.model_validate(payload)
    assert "theme_colors" in str(captured.value)


def test_character_alignment_clamps_exaggeration_and_semantic_mismatch() -> None:
    plan = PerformancePlan(
        emotion="cautious",
        intensity=0.95,
        gesture="soft_bounce",
        voice_style="bright",
        cues=[{"at": 0.45, "gesture": "soft_bounce", "intensity": 0.9}],
    )

    aligned = align_performance_with_character(plan)

    assert aligned.intensity == 0.72
    assert aligned.gesture == "small_nod"
    assert aligned.voice_style == "serious"
    assert aligned.cues[0].gesture == "small_nod"
    assert aligned.cues[0].intensity == 0.72
