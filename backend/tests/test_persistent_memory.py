from pathlib import Path

import pytest

from app.persistent_memory import PersistentMemoryStore, extract_explicit_memory


def test_sqlite_memory_persists_across_store_instances(tmp_path: Path) -> None:
    database_path = tmp_path / "memory.sqlite3"
    first_store = PersistentMemoryStore(database_path)
    created, is_new = first_store.create("好きな色は青")
    first_store.close()

    second_store = PersistentMemoryStore(database_path)
    items = second_store.list()

    assert is_new is True
    assert items == (created,)
    second_store.close()


def test_search_uses_japanese_character_overlap_and_tracks_usage() -> None:
    store = PersistentMemoryStore.in_memory()
    blue, _ = store.create("好きな色は青")
    store.create("休日は散歩する")

    results = store.search("青色の好みを覚えてる？")
    store.mark_used(tuple(item.id for item in results))

    assert results[0].id == blue.id
    assert next(item for item in store.list() if item.id == blue.id).use_count == 1


def test_memory_validation_and_explicit_directive() -> None:
    store = PersistentMemoryStore.in_memory()

    assert extract_explicit_memory("覚えておいて：コーヒーはブラック") == "コーヒーはブラック"
    assert extract_explicit_memory("前のこと覚えてる？") is None
    with pytest.raises(ValueError, match="500文字以内"):
        store.create("a" * 501)


def test_memory_store_has_a_bounded_item_count() -> None:
    store = PersistentMemoryStore(":memory:", max_items=1)
    store.create("最初の記憶")

    with pytest.raises(ValueError, match="最大1件"):
        store.create("二つ目の記憶")
