from __future__ import annotations

from collections import OrderedDict, deque
from dataclasses import dataclass, field
from typing import Literal

ConversationRole = Literal["user", "assistant"]


@dataclass(frozen=True, slots=True)
class ConversationMessage:
    role: ConversationRole
    content: str


@dataclass(frozen=True, slots=True)
class MemorySnippet:
    id: str
    content: str


@dataclass(frozen=True, slots=True)
class DialogueContext:
    recent_messages: tuple[ConversationMessage, ...]
    session_summary: str | None = None
    relevant_memories: tuple[MemorySnippet, ...] = ()


@dataclass(slots=True)
class _SessionState:
    messages: deque[ConversationMessage]
    summary_fragments: deque[str] = field(default_factory=lambda: deque(maxlen=8))
    summarized_turns: int = 0


class ConversationMemoryStore:
    """Bounded session memory with deterministic local compaction and no disk persistence."""

    def __init__(self, max_turns: int = 10, max_sessions: int = 32) -> None:
        if max_turns < 1 or max_sessions < 1:
            raise ValueError("Conversation memory limits must be positive.")
        self.max_turns = max_turns
        self.max_sessions = max_sessions
        self._sessions: OrderedDict[str, _SessionState] = OrderedDict()

    def history(self, session_id: str) -> tuple[ConversationMessage, ...]:
        state = self._sessions.get(session_id)
        if state is None:
            return ()
        self._sessions.move_to_end(session_id)
        return tuple(state.messages)

    def summary(self, session_id: str) -> str | None:
        state = self._sessions.get(session_id)
        if state is None or not state.summary_fragments:
            return None
        self._sessions.move_to_end(session_id)
        return " / ".join(state.summary_fragments)

    def context(
        self,
        session_id: str,
        relevant_memories: tuple[MemorySnippet, ...] = (),
    ) -> DialogueContext:
        return DialogueContext(
            recent_messages=self.history(session_id),
            session_summary=self.summary(session_id),
            relevant_memories=relevant_memories,
        )

    def append_turn(self, session_id: str, user_message: str, assistant_message: str) -> int:
        state = self._sessions.get(session_id)
        if state is None:
            if len(self._sessions) >= self.max_sessions:
                self._sessions.popitem(last=False)
            state = _SessionState(messages=deque())
            self._sessions[session_id] = state
        else:
            self._sessions.move_to_end(session_id)

        if len(state.messages) >= self.max_turns * 2:
            oldest_user = state.messages.popleft()
            oldest_assistant = state.messages.popleft()
            state.summary_fragments.append(_compact_turn(oldest_user.content, oldest_assistant.content))
            state.summarized_turns += 1

        state.messages.extend(
            (
                ConversationMessage(role="user", content=user_message),
                ConversationMessage(role="assistant", content=assistant_message),
            )
        )
        return len(state.messages) // 2

    def reset(self, session_id: str) -> int:
        state = self._sessions.pop(session_id, None)
        if state is None:
            return 0
        return state.summarized_turns + len(state.messages) // 2


def _compact_turn(user_message: str, assistant_message: str) -> str:
    user = " ".join(user_message.split())[:120]
    assistant = " ".join(assistant_message.split())[:120]
    return f"利用者: {user} -> 応答: {assistant}"
