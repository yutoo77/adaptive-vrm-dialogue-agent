"""Read-only guidance from the two revealed rules, never an unlock decision."""

from collections.abc import Sequence
from typing import Literal

from app.experience_schemas import Bookmark

BoardObservation = Literal["full_missing", "full_misplaced", "order_pending", "order_reversed", "matches"]


def observe_board(arrangement: Sequence[Bookmark | None]) -> BoardObservation:
    """Input has already passed the unique, three-slot request schema."""
    if "full" not in arrangement:
        return "full_missing"
    if arrangement[1] != "full":
        return "full_misplaced"
    if "half" not in arrangement or "crescent" not in arrangement:
        return "order_pending"
    if arrangement.index("crescent") < arrangement.index("half"):
        return "order_reversed"
    return "matches"


def board_guidance(arrangement: Sequence[Bookmark | None], *, detailed: bool = False) -> str:
    """Call only after the letter is inspected. Mention one next step, not the final sequence."""
    observation = observe_board(arrangement)
    if observation == "full_missing":
        return (
            "丸い月は、まだ手元にあるね。まず真ん中の枠に置いて、それから残りを考えてみよう。"
            if detailed
            else "丸い月は、まだ手元にあるね。手紙の『真ん中』は、どの枠だと思う？"
        )
    if observation == "full_misplaced":
        position = "左" if arrangement[0] == "full" else "右"
        return (
            f"丸い月は今、{position}の枠にあるね。手紙では真ん中だったから、まずその一枚を動かしてみよう。"
            if detailed
            else f"丸い月は今、{position}の枠にあるね。手紙では、どの場所だったかな。"
        )
    if observation == "order_pending":
        return (
            "丸い月は、手紙どおり真ん中に置けているね。残りは左から順に、半分の月より後に細い月が来るように考えてみよう。"
            if detailed
            else "丸い月は、手紙どおり真ん中に置けているね。残り二枚の前後を、一緒に確かめよう。"
        )
    if observation == "order_reversed":
        return (
            "丸い月は、そのままでよさそう。今は細い月が半分の月より前にあるから、この二枚の前後を見直してみよう。"
            if detailed
            else "丸い月の場所は合っているね。残り二枚は、『より後ろ』の条件と見比べてみよう。"
        )
    return "二つの手掛かりには合っていそうだね。この並びで、箱を開けて確かめてみよう。"
