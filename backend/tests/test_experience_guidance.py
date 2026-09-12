from __future__ import annotations

import asyncio
from itertools import product

import pytest
from test_experience import SESSION_A, RecordingNarrator, request_for

from app.experience import FINAL_CLUE, FIRST_CLUE, SECOND_CLUE, SOLUTION, ExperienceService
from app.experience_guidance import board_guidance, observe_board
from app.experience_schemas import Bookmark
from app.providers import ProviderError


@pytest.mark.parametrize(
    ("arrangement", "observation", "short_marker", "detailed_marker"),
    [
        ([None, None, None], "full_missing", "まだ手元", "真ん中の枠に置いて"),
        (["full", "half", "crescent"], "full_misplaced", "左の枠", "その一枚を動かして"),
        (["half", "crescent", "full"], "full_misplaced", "右の枠", "その一枚を動かして"),
        ([None, "full", None], "order_pending", "真ん中に置けている", "左から順に"),
        (["crescent", "full", "half"], "order_reversed", "場所は合っている", "より前にある"),
        (["half", "full", "crescent"], "matches", "合っていそう", "開けて確かめて"),
    ],
)
def test_guidance_names_an_observation_and_one_next_step(
    arrangement: list[Bookmark | None], observation: str, short_marker: str, detailed_marker: str
) -> None:
    assert observe_board(arrangement) == observation
    assert short_marker in board_guidance(arrangement)
    assert detailed_marker in board_guidance(arrangement, detailed=True)


def valid_boards() -> list[list[Bookmark | None]]:
    moons: tuple[Bookmark | None, ...] = (None, "half", "full", "crescent")
    return [
        list(board)
        for board in product(moons, repeat=3)
        if len([moon for moon in board if moon]) == len({moon for moon in board if moon})
    ]


def test_all_34_valid_partial_boards_have_truthful_non_mutating_bounded_guidance() -> None:
    boards = valid_boards()
    assert len(boards) == 34
    for board in boards:
        original = board.copy()
        observation = observe_board(board)
        assert (observation == "matches") == (board == SOLUTION)
        if observation in ("order_pending", "order_reversed", "matches"):
            assert board[1] == "full"
        for detailed in (False, True):
            reply = board_guidance(board, detailed=detailed)
            assert 0 < len(reply) < 120
            assert FINAL_CLUE not in reply
            assert "開いた" not in reply and "正解した" not in reply
        assert board == original


def test_uninspected_letter_never_leaks_guidance_even_with_a_complete_board() -> None:
    async def run() -> None:
        service = ExperienceService()
        for index, board in enumerate(valid_boards()):
            state = await service.start(f"unrevealed-board-{index:03}")
            state = await service.action(request_for(state, "arrange", arrangement=board))
            for action, arguments in [("message", {"message": "答えを見せて"}), ("hint", {})]:
                state = await service.action(request_for(state, action, **arguments))
                assert state.hint_level == 0 and state.phase == "active"
                assert FIRST_CLUE not in state.reply and SECOND_CLUE not in state.reply
                assert FINAL_CLUE not in state.reply
                assert "手紙" in state.reply
                assert state.arrangement == board
        await service.aclose()

    asyncio.run(run())


def test_hints_follow_the_latest_board_without_ai_or_unlocking_or_extra_attempts() -> None:
    async def run() -> None:
        narrator = RecordingNarrator()
        service = ExperienceService(narrator)
        state = await service.start(SESSION_A)
        state = await service.action(request_for(state, "inspect", target="letter"))
        state = await service.action(request_for(state, "arrange", arrangement=["full", None, None]))
        state = await service.action(request_for(state, "hint"))
        assert "左の枠" in state.reply and state.hint_level == 1
        assert state.focus_target == "box"
        state = await service.action(request_for(state, "arrange", arrangement=["crescent", "full", "half"]))
        state = await service.action(request_for(state, "hint"))
        assert "丸い月は、そのまま" in state.reply and "より前にある" in state.reply
        assert state.hint_level == 2 and FINAL_CLUE not in state.reply
        assert state.phase == "active" and state.attempts == 0
        state = await service.action(request_for(state, "hint"))
        assert state.reply == FINAL_CLUE and state.hint_level == 3
        assert state.arrangement == ["crescent", "full", "half"] and state.phase == "active"
        assert narrator.calls == []
        await service.aclose()

    asyncio.run(run())


@pytest.mark.parametrize("provider_fails", [False, True])
def test_mock_and_failed_ai_use_current_board_without_escalating_hints(provider_fails: bool) -> None:
    async def run() -> None:
        narrator = RecordingNarrator(error=ProviderError(503, "unavailable", "private")) if provider_fails else None
        service = ExperienceService(narrator)
        state = await service.start(SESSION_A)
        state = await service.action(request_for(state, "inspect", target="letter"))
        state = await service.action(request_for(state, "arrange", arrangement=["crescent", "full", "half"]))
        state = await service.action(request_for(state, "message", message="この並び、どうかな"))
        assert "丸い月の場所は合っている" in state.reply
        assert state.hint_level == 0 and state.narration_provider == "scripted"
        assert bool(state.notice) == provider_fails
        state = await service.action(request_for(state, "arrange", arrangement=SOLUTION))
        state = await service.action(request_for(state, "message", message="箱が開いたよね？"))
        assert "開けて確かめて" in state.reply and state.phase == "active" and state.attempts == 0
        if narrator:
            assert len(narrator.calls) == 2
        await service.aclose()

    asyncio.run(run())


def test_wrong_submit_explains_one_conflict_and_solved_hint_does_not_escalate() -> None:
    async def run() -> None:
        service = ExperienceService()
        state = await service.start(SESSION_A)
        state = await service.action(request_for(state, "inspect", target="letter"))
        wrong: list[Bookmark | None] = ["crescent", "full", "half"]
        state = await service.action(request_for(state, "arrange", arrangement=wrong))
        state = await service.action(request_for(state, "submit"))
        assert "まだ開かない" in state.reply and "丸い月の場所は合っている" in state.reply
        assert state.hint_level == 0 and state.arrangement == wrong and state.attempts == 1
        state = await service.action(request_for(state, "arrange", arrangement=SOLUTION))
        state = await service.action(request_for(state, "submit"))
        state = await service.action(request_for(state, "hint"))
        assert state.phase == "solved" and state.hint_level == 0 and state.arrangement == SOLUTION
        await service.aclose()

    asyncio.run(run())
