"""Browser-test entrypoint; never open the owner's persistent memory database."""

from unittest.mock import patch

from fastapi import FastAPI

from app.config import Settings
from app.persistent_memory import PersistentMemoryStore


def create_app() -> FastAPI:
    # main also creates its default app at import time. Isolate that instance too.
    with patch(
        "app.persistent_memory.PersistentMemoryStore",
        side_effect=lambda: PersistentMemoryStore(":memory:"),
    ):
        from app.main import create_app as create_application

    return create_application(
        settings=Settings(
            provider="mock",
            voicevox_base_url="http://127.0.0.1:59999",
            voicevox_timeout_seconds=3,
        ),
        persistent_memory_store=PersistentMemoryStore(":memory:"),
    )
