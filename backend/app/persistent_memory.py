from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import uuid4

from app.conversation import MemorySnippet

MemorySource = Literal["manual", "explicit"]
DEFAULT_MEMORY_DB_PATH = Path(__file__).resolve().parents[1] / ".local" / "memory.sqlite3"
_EXPLICIT_MEMORY_PATTERN = re.compile(
    r"^(?:これを)?(?:覚えて(?:おいて)?|記憶して)(?:ね)?\s*[：:、,]\s*(.+)$",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class PersistentMemory:
    id: str
    content: str
    source: MemorySource
    created_at: str
    updated_at: str
    use_count: int


class PersistentMemoryStore:
    """Owner-visible long-term memory stored only in a local SQLite file."""

    def __init__(self, database_path: str | Path = DEFAULT_MEMORY_DB_PATH, max_items: int = 200) -> None:
        if max_items < 1:
            raise ValueError("Persistent memory limit must be positive.")
        self.database_path = str(database_path)
        self.max_items = max_items
        if self.database_path != ":memory:":
            path = Path(self.database_path)
            path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._connection = sqlite3.connect(self.database_path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._connection:
            self._connection.execute("PRAGMA foreign_keys = ON")
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    normalized_content TEXT NOT NULL UNIQUE,
                    source TEXT NOT NULL CHECK(source IN ('manual', 'explicit')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_used_at TEXT,
                    use_count INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS memories_updated_at_idx ON memories(updated_at DESC)"
            )

    @classmethod
    def in_memory(cls) -> PersistentMemoryStore:
        return cls(":memory:")

    def count(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) AS count FROM memories").fetchone()
        return int(row["count"] if row is not None else 0)

    def list(self, limit: int = 200) -> tuple[PersistentMemory, ...]:
        bounded_limit = min(500, max(1, limit))
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?",
                (bounded_limit,),
            ).fetchall()
        return tuple(_row_to_memory(row) for row in rows)

    def create(self, content: str, source: MemorySource = "manual") -> tuple[PersistentMemory, bool]:
        cleaned = _clean_content(content)
        normalized = _normalize(cleaned)
        if not normalized:
            raise ValueError("長期記憶には文字または数字を含めてください。")
        now = _utc_now()
        with self._lock, self._connection:
            existing = self._connection.execute(
                "SELECT * FROM memories WHERE normalized_content = ?",
                (normalized,),
            ).fetchone()
            if existing is not None:
                return _row_to_memory(existing), False
            count_row = self._connection.execute("SELECT COUNT(*) AS count FROM memories").fetchone()
            if count_row is not None and int(count_row["count"]) >= self.max_items:
                raise ValueError(f"長期記憶は最大{self.max_items}件です。不要な項目を削除してください。")
            memory_id = uuid4().hex
            self._connection.execute(
                """
                INSERT INTO memories(id, content, normalized_content, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (memory_id, cleaned, normalized, source, now, now),
            )
            row = self._connection.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        if row is None:
            raise RuntimeError("Created memory could not be read back.")
        return _row_to_memory(row), True

    def update(self, memory_id: str, content: str) -> PersistentMemory | None:
        cleaned = _clean_content(content)
        normalized = _normalize(cleaned)
        now = _utc_now()
        with self._lock, self._connection:
            existing = self._connection.execute(
                "SELECT id FROM memories WHERE normalized_content = ? AND id <> ?",
                (normalized, memory_id),
            ).fetchone()
            if existing is not None:
                raise ValueError("同じ内容の長期記憶がすでにあります。")
            cursor = self._connection.execute(
                "UPDATE memories SET content = ?, normalized_content = ?, updated_at = ? WHERE id = ?",
                (cleaned, normalized, now, memory_id),
            )
            if cursor.rowcount == 0:
                return None
            row = self._connection.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return None if row is None else _row_to_memory(row)

    def delete(self, memory_id: str) -> bool:
        with self._lock, self._connection:
            cursor = self._connection.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        return cursor.rowcount > 0

    def clear(self) -> int:
        with self._lock, self._connection:
            cursor = self._connection.execute("DELETE FROM memories")
        return max(0, cursor.rowcount)

    def search(self, query: str, limit: int = 3) -> tuple[MemorySnippet, ...]:
        memories = self.list(limit=500)
        if not memories:
            return ()
        normalized_query = _normalize(query)
        generic_recall = any(phrase in normalized_query for phrase in ("何を覚えて", "記憶一覧", "長期記憶"))
        scored = [(_relevance_score(normalized_query, memory.content), memory) for memory in memories]
        relevant = [item for score, item in sorted(scored, key=lambda item: item[0], reverse=True) if score > 0]
        selected = (relevant or list(memories) if generic_recall else relevant)[: max(1, min(5, limit))]
        return tuple(MemorySnippet(id=memory.id, content=memory.content) for memory in selected)

    def mark_used(self, memory_ids: tuple[str, ...]) -> None:
        if not memory_ids:
            return
        now = _utc_now()
        with self._lock, self._connection:
            self._connection.executemany(
                "UPDATE memories SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?",
                ((now, memory_id) for memory_id in memory_ids),
            )

    def close(self) -> None:
        with self._lock:
            self._connection.close()


def extract_explicit_memory(message: str) -> str | None:
    match = _EXPLICIT_MEMORY_PATTERN.fullmatch(" ".join(message.split()))
    if match is None:
        return None
    content = match.group(1).strip()
    shortened = content[:500]
    return shortened if _normalize(shortened) else None


def _clean_content(content: str) -> str:
    cleaned = " ".join(content.split())
    if not cleaned:
        raise ValueError("長期記憶の内容を入力してください。")
    if len(cleaned) > 500:
        raise ValueError("長期記憶は500文字以内にしてください。")
    return cleaned


def _normalize(content: str) -> str:
    return re.sub(r"[^0-9a-zぁ-んァ-ヶ一-龠]+", "", content.casefold())


def _relevance_score(query: str, content: str) -> float:
    candidate = _normalize(content)
    if not query or not candidate:
        return 0
    score = 0.0
    if candidate in query or query in candidate:
        score += 3.0
    query_grams = _character_grams(query)
    candidate_grams = _character_grams(candidate)
    if query_grams:
        score += len(query_grams & candidate_grams) / len(query_grams)
    query_characters = set(query)
    candidate_characters = set(candidate)
    shared_characters = query_characters & candidate_characters
    if len(shared_characters) >= 2:
        score += 0.5 * len(shared_characters) / len(query_characters)
    return score


def _character_grams(value: str) -> set[str]:
    if len(value) < 2:
        return {value} if value else set()
    return {value[index : index + 2] for index in range(len(value) - 1)}


def _row_to_memory(row: sqlite3.Row) -> PersistentMemory:
    return PersistentMemory(
        id=str(row["id"]),
        content=str(row["content"]),
        source=str(row["source"]),  # type: ignore[arg-type]
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        use_count=int(row["use_count"]),
    )


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
