"""One deterministic cooperative puzzle, with bounded, volatile, isolated sessions."""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from time import monotonic
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Path, Response

from app.experience_guidance import board_guidance
from app.experience_narration import ExperienceNarrationContext, ExperienceNarrator
from app.experience_schemas import (
    ExperienceActionRequest,
    ExperienceCancellationResponse,
    ExperienceMessage,
    ExperienceSessionId,
    ExperienceSnapshot,
    ExperienceStartRequest,
)
from app.performance import PerformanceCue, PerformancePlan
from app.providers import ProviderReply

logger = logging.getLogger("adaptive_vrm.experience")

START_REPLY = "小さな箱と、三枚の月の栞があるね。わたしは手紙の裏を読んでみる。そちらも、見てみてくれる？"
FIRST_CLUE = "丸い月は真ん中に。"
SECOND_CLUE = "細い月は、半分の月より後ろに。"
FOCUS_CLUE = "『真ん中』と『より後ろ』を、別々に見てみよう。まず丸い月の場所から決められそう。"
THINKING_CLUE = "真ん中を決めたら、残った二枚の前後を考えてみよう。左から順番に読むんだね。"
FINAL_CLUE = "左から、半分の月、丸い月、細い月。この順番で並べてみよう。"
SOLUTION = ["half", "full", "crescent"]
SOLVED_REPLY = (
    "開いたね。中には、青い糸を結んだ小さな便箋。"
    "『また、月の見える夜に』って書いてある。いっしょに読めてよかった。"
)
UNAVAILABLE_NOTICE = "相談AIは利用できないため、固定の応答で続けます。調査・配置・ヒントはそのまま使えます。"


def quiet_performance(plan: PerformancePlan | None = None) -> PerformancePlan:
    if plan is None:
        return PerformancePlan(emotion="neutral", intensity=0.25, gesture="none", voice_style="warm", cues=[])
    validated = PerformancePlan.model_validate(plan.model_dump())
    intensity = min(validated.intensity, 0.45)
    return PerformancePlan(
        emotion=validated.emotion,
        intensity=intensity,
        gesture="small_nod" if validated.gesture == "soft_bounce" else validated.gesture,
        voice_style="warm" if validated.voice_style == "bright" else validated.voice_style,
        cues=[
            PerformanceCue(
                at=cue.at,
                gesture="small_nod" if cue.gesture == "soft_bounce" else cue.gesture,
                intensity=min(cue.intensity, intensity),
            )
            for cue in validated.cues
        ],
    )


@dataclass(slots=True)
class _Session:
    snapshot: ExperienceSnapshot
    touched_at: float
    narration_calls: int = 0


@dataclass(slots=True)
class _PendingNarration:
    task: asyncio.Task[ProviderReply]
    cancelled: asyncio.Event


class ExperienceService:
    def __init__(
        self,
        narrator: ExperienceNarrator | None = None,
        *,
        timeout_seconds: float = 30,
        max_sessions: int = 32,
        ttl_seconds: float = 4 * 60 * 60,
        max_messages: int = 24,
        max_narration_calls: int = 24,
        max_pending_narrations: int = 4,
        unavailable_notice: str | None = None,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        if not 1 <= max_sessions <= 32 or not 2 <= max_messages <= 24:
            raise ValueError("experience storage limits are out of bounds")
        if not 0 <= max_narration_calls <= 24 or not 1 <= max_pending_narrations <= 4:
            raise ValueError("experience narration limits are out of bounds")
        if not 0 < timeout_seconds <= 120 or not 0 < ttl_seconds <= 24 * 60 * 60:
            raise ValueError("experience time limits are out of bounds")
        self._narrator = narrator
        self._timeout = timeout_seconds
        self._max_sessions = max_sessions
        self._ttl = ttl_seconds
        self._max_messages = max_messages
        self._max_calls = max_narration_calls
        self._max_pending = max_pending_narrations
        self._unavailable_notice = unavailable_notice
        self._clock = clock
        self._sessions: OrderedDict[str, _Session] = OrderedDict()
        self._pending: dict[str, _PendingNarration] = {}
        self._provider_tasks: set[asyncio.Task[ProviderReply]] = set()
        self._lock = asyncio.Lock()

    def _expire(self) -> None:
        for session_id, session in tuple(self._sessions.items()):
            if session_id not in self._pending and self._clock() - session.touched_at >= self._ttl:
                del self._sessions[session_id]

    def _get(self, session_id: str) -> _Session:
        self._expire()
        session = self._sessions.get(session_id)
        if session is None:
            raise _error(404, "experience_not_found", "体験の進行が見つかりません。新しく始めてください。")
        session.touched_at = self._clock()
        self._sessions.move_to_end(session_id)
        return session

    async def start(self, session_id: str) -> ExperienceSnapshot:
        async with self._lock:
            self._expire()
            if session_id in self._sessions:
                return self._get(session_id).snapshot.model_copy(deep=True)
            if len(self._sessions) >= self._max_sessions:
                oldest_idle = next((key for key in self._sessions if key not in self._pending), None)
                if oldest_idle is None:
                    raise _error(503, "experience_capacity", "いまは相談中の体験が多いため、少し待ってください。")
                del self._sessions[oldest_idle]
            snapshot = ExperienceSnapshot(
                session_id=session_id,
                revision=0,
                phase="active",
                inspected=[],
                hint_level=0,
                arrangement=[None, None, None],
                attempts=0,
                reply=START_REPLY,
                performance=quiet_performance(),
                focus_target=None,
                messages=[ExperienceMessage(role="assistant", text=START_REPLY)],
                narration_provider="scripted",
                notice=self._unavailable_notice,
            )
            self._sessions[session_id] = _Session(snapshot, self._clock())
            return snapshot.model_copy(deep=True)

    async def get(self, session_id: str) -> ExperienceSnapshot:
        async with self._lock:
            return self._get(session_id).snapshot.model_copy(deep=True)

    async def cancel(self, session_id: str) -> bool:
        async with self._lock:
            self._get(session_id)
            pending = self._pending.pop(session_id, None)
            if pending is None:
                return False
            pending.cancelled.set()
            pending.task.cancel()
            return True

    async def action(self, request: ExperienceActionRequest) -> ExperienceSnapshot:
        async with self._lock:
            session = self._get(request.session_id)
            if session.snapshot.revision != request.expected_revision:
                raise _error(
                    409, "experience_stale_revision", "進行が更新されています。現在の状態を読み直してください。"
                )
            if request.session_id in self._pending:
                raise _error(409, "experience_in_progress", "この体験では、いま相談の返事を待っています。")
            if request.action != "message":
                return self._fixed_action(session, request)
            notice = self._unavailable_notice
            if session.narration_calls >= self._max_calls:
                notice = "この体験の相談AIの回数上限に達したため、固定の応答で続けます。"
            elif len(self._provider_tasks) >= self._max_pending:
                notice = "相談AIが混み合っているため、固定の応答で続けます。"
            if self._narrator is None or notice is not None:
                return self._commit(session, request.message or "", _scripted_message(session.snapshot), notice=notice)

            task = asyncio.create_task(
                self._narrator.narrate(request.message or "", _narration_context(session.snapshot), uuid4().hex)
            )
            self._provider_tasks.add(task)
            task.add_done_callback(self._provider_done)
            pending = _PendingNarration(task, asyncio.Event())
            self._pending[request.session_id] = pending
            # Count dispatched requests even if cancelled/failed: cancellation does not undo API cost.
            session.narration_calls += 1

        cancelled_wait = asyncio.create_task(pending.cancelled.wait())
        try:
            completed, _ = await asyncio.wait(
                (task, cancelled_wait), timeout=self._timeout, return_when=asyncio.FIRST_COMPLETED
            )
            if pending.cancelled.is_set():
                raise _cancelled_error()
            reply: ProviderReply | None = None
            notice = None
            if task not in completed:
                task.cancel()
                notice = "相談AIの返事が時間内に届かなかったため、固定の応答で続けます。"
            else:
                try:
                    reply = task.result()
                    if not isinstance(reply, ProviderReply) or not reply.text.strip() or len(reply.text) > 1000:
                        raise ValueError("invalid experience narration")
                    performance = quiet_performance(reply.performance)
                except (Exception, asyncio.CancelledError):
                    reply = None
                    notice = UNAVAILABLE_NOTICE
                    # Never log message text, request bodies, provider exception details, or keys.
                    logger.warning("experience_narration_fallback reason=provider_unavailable")

            async with self._lock:
                if (
                    pending.cancelled.is_set()
                    or self._pending.get(request.session_id) is not pending
                    or self._sessions.get(request.session_id) is not session
                    or session.snapshot.revision != request.expected_revision
                ):
                    raise _cancelled_error()
                if reply is None:
                    return self._commit(
                        session, request.message or "", _scripted_message(session.snapshot), notice=notice
                    )
                return self._commit(
                    session, request.message or "", reply.text.strip(), performance=performance, provider="openai"
                )
        except asyncio.CancelledError:
            pending.cancelled.set()
            task.cancel()
            raise
        finally:
            cancelled_wait.cancel()
            async with self._lock:
                if self._pending.get(request.session_id) is pending:
                    self._pending.pop(request.session_id)

    def _provider_done(self, task: asyncio.Task[ProviderReply]) -> None:
        self._provider_tasks.discard(task)
        with suppress(asyncio.CancelledError, Exception):
            task.exception()

    def _fixed_action(self, session: _Session, request: ExperienceActionRequest) -> ExperienceSnapshot:
        state = session.snapshot
        label = ""
        performance = None
        if request.action == "inspect":
            assert request.target is not None
            if request.target not in state.inspected:
                state.inspected.append(request.target)
            state.focus_target = request.target
            label = {"window": "窓を調べる", "letter": "手紙を調べる", "box": "小箱を調べる"}[request.target]
            reply = {
                "window": (
                    "窓のそばに、丸い月、細い月、半分の月の栞があるね。"
                    "月の知識はいらないみたい。形を見ておこう。"
                ),
                "letter": f"裏に短い言葉があるよ。『{FIRST_CLUE}{SECOND_CLUE}』。そちらの栞と、合わせてみよう。",
                "box": "小箱には、左から三つの枠があるね。栞を一枚ずつ置いて、そろったら開けてみよう。",
            }[request.target]
            if state.phase == "solved" and request.target == "box":
                reply = SOLVED_REPLY
        elif request.action == "hint":
            state.focus_target = "letter"
            label = "ヒントを読む"
            performance = PerformancePlan(
                emotion="curious", intensity=0.20, gesture="none", voice_style="warm", cues=[]
            )
            if state.phase == "solved":
                reply = "箱はもう開いているね。この並びを、ここに残しておこう。"
            elif "letter" not in state.inspected:
                reply = "まず、手紙の裏を一緒に調べてみよう。並べ方の手掛かりを読んでから、考えてみるね。"
            else:
                state.hint_level = min(3, state.hint_level + 1)
                state.focus_target = "box"
                reply = FINAL_CLUE if state.hint_level == 3 else board_guidance(
                    state.arrangement, detailed=state.hint_level == 2
                )
        elif request.action == "arrange":
            assert request.arrangement is not None
            label = "栞を並べる"
            state.focus_target = "box"
            if state.phase == "solved":
                reply = "箱はもう開いているね。この並びを、ここに残しておこう。"
            else:
                state.arrangement = list(request.arrangement)
                reply = "その並びを置いてみたよ。手紙と見比べて、よさそうなら箱を開けてみよう。"
        else:  # validated submit only; messages are handled separately
            label = "箱を開けてみる"
            state.focus_target = "box"
            if state.phase == "solved":
                reply = "箱はもう開いているよ。便箋はここに置いておくね。"
            elif "letter" not in state.inspected:
                reply = "開ける前に、手紙の裏を一緒に読んでおこう。並べ方の手掛かりがありそう。"
            elif None in state.arrangement:
                reply = "まだ空いている枠があるね。三枚を置いてから、もう一度試してみよう。"
            else:
                state.attempts += 1
                if state.arrangement == SOLUTION:
                    state.phase = "solved"
                    reply = SOLVED_REPLY
                    performance = PerformancePlan(
                        emotion="happy", intensity=0.30, gesture="small_nod", voice_style="warm", cues=[]
                    )
                else:
                    reply = "まだ開かないね。" + board_guidance(state.arrangement)
                    performance = PerformancePlan(
                        emotion="confused", intensity=0.20, gesture="none", voice_style="gentle", cues=[]
                    )
        return self._commit(session, label, reply, performance=performance)

    def _commit(
        self,
        session: _Session,
        user_text: str,
        reply: str,
        *,
        performance: PerformancePlan | None = None,
        provider: str = "scripted",
        notice: str | None = None,
    ) -> ExperienceSnapshot:
        state = session.snapshot
        state.revision += 1
        state.reply = reply
        state.performance = performance or quiet_performance()
        state.narration_provider = "openai" if provider == "openai" else "scripted"
        state.notice = notice
        state.messages = (
            state.messages
            + [ExperienceMessage(role="user", text=user_text), ExperienceMessage(role="assistant", text=reply)]
        )[-self._max_messages :]
        session.touched_at = self._clock()
        return state.model_copy(deep=True)

    async def aclose(self) -> None:
        async with self._lock:
            for pending in self._pending.values():
                pending.cancelled.set()
            for task in self._provider_tasks:
                task.cancel()
            self._pending.clear()
            self._sessions.clear()
        close = getattr(self._narrator, "aclose", None)
        if close is not None:
            await close()


def _scripted_message(state: ExperienceSnapshot) -> str:
    if state.phase == "solved":
        return "便箋の言葉、静かでいいね。もう少しここを見ていても、対話に戻っても大丈夫だよ。"
    if "letter" not in state.inspected:
        return "わたしは手紙の裏を読めるよ。まず、手紙を一緒に調べてみよう。"
    if state.hint_level < 3:
        return board_guidance(state.arrangement, detailed=state.hint_level == 2)
    return f"{FINAL_CLUE}決まったら、箱を開けてみよう。"


def _narration_context(state: ExperienceSnapshot) -> ExperienceNarrationContext:
    clues: list[str] = []
    if "letter" in state.inspected:
        clues.extend((FIRST_CLUE, SECOND_CLUE))
        if state.hint_level >= 1:
            clues.append(FOCUS_CLUE)
        if state.hint_level >= 2:
            clues.append(THINKING_CLUE)
        if state.hint_level >= 3:
            clues.append(FINAL_CLUE)
    return ExperienceNarrationContext(
        phase=state.phase,
        inspected=tuple(state.inspected),
        hint_level=state.hint_level,
        arrangement=tuple(state.arrangement),
        revealed_clues=tuple(clues),
        messages=tuple(message.model_copy(deep=True) for message in state.messages[-12:]),
    )


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _cancelled_error() -> HTTPException:
    return _error(409, "experience_cancelled", "相談の返事を止めました。進行は変更していません。")


def experience_router(service: ExperienceService) -> APIRouter:
    router = APIRouter(prefix="/api/experience", tags=["experience"])

    @router.post("/sessions", response_model=ExperienceSnapshot)
    async def start(request: ExperienceStartRequest, response: Response) -> ExperienceSnapshot:
        response.headers["Cache-Control"] = "no-store"
        return await service.start(request.session_id)

    @router.get("/sessions/{session_id}", response_model=ExperienceSnapshot)
    async def resume(
        session_id: Annotated[ExperienceSessionId, Path()], response: Response
    ) -> ExperienceSnapshot:
        response.headers["Cache-Control"] = "no-store"
        return await service.get(session_id)

    @router.post("/action", response_model=ExperienceSnapshot)
    async def action(request: ExperienceActionRequest, response: Response) -> ExperienceSnapshot:
        response.headers["Cache-Control"] = "no-store"
        return await service.action(request)

    @router.delete("/sessions/{session_id}/active", response_model=ExperienceCancellationResponse)
    async def cancel(session_id: Annotated[ExperienceSessionId, Path()]) -> ExperienceCancellationResponse:
        return ExperienceCancellationResponse(cancelled=await service.cancel(session_id))

    return router
