from __future__ import annotations

import sys
from time import perf_counter

from faster_whisper import WhisperModel

from app.config import Settings


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    settings = Settings.from_env()
    started_at = perf_counter()
    print(
        f"Preparing faster-whisper model={settings.transcription_model} "
        f"device={settings.transcription_device} compute_type={settings.transcription_compute_type}"
    )
    WhisperModel(
        settings.transcription_model,
        device=settings.transcription_device,
        compute_type=settings.transcription_compute_type,
    )
    elapsed_seconds = perf_counter() - started_at
    print(f"Model is ready. elapsed_seconds={elapsed_seconds:.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
