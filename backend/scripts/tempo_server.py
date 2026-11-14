"""Opt-in, bounded browser evaluation with fictional inputs and RAM-only memory."""

import os
from collections.abc import AsyncIterator
from dataclasses import asdict
from unittest.mock import patch

from fastapi import FastAPI

from app.config import Settings
from app.conversation import DialogueContext
from app.interaction import ResponseStyle
from app.persistent_memory import PersistentMemoryStore
from app.providers import (
    MockProvider,
    OpenAIProvider,
    ProviderError,
    ProviderReply,
    ProviderStreamCompleted,
    ProviderStreamEvent,
)

EVALUATION_FLAG = "RUN_REAL_TEMPO_EVALUATION"
CASES = (
    ("identity", "こんにちは。あなたの名前と、どんなふうに話してくれるか教えて。"),
    ("gentle", "架空の話だけど、今日は失敗して少し疲れた。解決策より、少し話を聞いてほしい。"),
    ("explanation", "APIって何？初めて聞く人にも分かるように教えて。"),
)
MAX_REQUESTS = len(CASES)


class BoundedTempoProvider(OpenAIProvider):
    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        # One attempt per case, including failure: no hidden retry spend.
        self._client = self._client.with_options(max_retries=0)
        self.attempts = 0
        self.results: list[dict[str, object]] = []

    def reserve(self, message: str, response_style: ResponseStyle) -> None:
        if message not in {text for _, text in CASES} or response_style != "balanced":
            raise ProviderError(400, "evaluation_input_only", "固定の架空評価入力だけを受け付けます。")
        if self.attempts >= MAX_REQUESTS:
            raise ProviderError(429, "evaluation_limit", "評価のAPI呼び出し上限に達しました。")
        self.attempts += 1

    async def generate_reply(
        self, message: str, context: DialogueContext, response_style: ResponseStyle, request_id: str,
    ) -> ProviderReply:
        raise ProviderError(400, "stream_only", "この評価ではStreamingだけを使用します。")

    async def stream_reply(
        self, message: str, context: DialogueContext, response_style: ResponseStyle, request_id: str,
    ) -> AsyncIterator[ProviderStreamEvent]:
        self.reserve(message, response_style)
        async for event in super().stream_reply(message, context, response_style, request_id):
            if isinstance(event, ProviderStreamCompleted):
                reply = event.reply
                self.results.append({
                    "case": next(name for name, text in CASES if text == message),
                    "reply_characters": len(reply.text),
                    "performance": reply.performance.model_dump(),
                    "usage": asdict(reply.usage) if reply.usage else None,
                })
            yield event


def create_app() -> FastAPI:
    if os.getenv(EVALUATION_FLAG) != "1":
        raise RuntimeError(f"Set {EVALUATION_FLAG}=1 only after owner approval.")
    settings = Settings.from_env()
    if settings.provider != "openai" or not settings.api_key_configured:
        raise RuntimeError("OpenAI provider and Backend API key are required.")
    if settings.max_output_tokens > 240:
        raise RuntimeError("Tempo evaluation requires an output cap of at most 240 tokens.")
    return _create_application(settings, BoundedTempoProvider(settings))


def create_mock_app() -> FastAPI:
    """Local speech/browser integration only; never construct an OpenAI client."""
    return _create_application(Settings(), MockProvider())


def _create_application(settings: Settings, provider: BoundedTempoProvider | MockProvider) -> FastAPI:
    with patch(
        "app.persistent_memory.PersistentMemoryStore",
        side_effect=lambda: PersistentMemoryStore(":memory:"),
    ), patch("app.config.Settings.from_env", return_value=settings):
        from app.main import create_app as create_application

    app = create_application(settings=settings, provider=provider,
                             persistent_memory_store=PersistentMemoryStore(":memory:"))

    @app.get("/api/evaluation/tempo")
    async def evaluation_summary() -> dict[str, object]:
        return {"cases": [{"id": name, "message": text} for name, text in CASES],
                "provider": provider.name, "model": provider.model,
                "attempts": getattr(provider, "attempts", 0),
                "max_requests": MAX_REQUESTS, "results": getattr(provider, "results", [])}

    return app
