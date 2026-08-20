from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from time import perf_counter

from app.config import Settings
from app.transcription import FasterWhisperTranscriptionProvider, TranscriptionProviderError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe one local audio file with the configured local model.")
    parser.add_argument("audio", type=Path, help="Path to a local audio file.")
    return parser.parse_args()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = parse_args()
    audio_path: Path = args.audio.resolve()
    if not audio_path.is_file():
        print(json.dumps({"error": "Audio file was not found."}, ensure_ascii=False))
        return 2

    provider = FasterWhisperTranscriptionProvider(Settings.from_env())
    started_at = perf_counter()
    try:
        result = provider.transcribe(audio_path.read_bytes(), "audio/wav", "local-evaluation")
    except TranscriptionProviderError as error:
        print(
            json.dumps(
                {"error": error.public_message, "code": error.code},
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1

    print(
        json.dumps(
            {
                "file": audio_path.name,
                "model": provider.model_name,
                "device": provider.device,
                "compute_type": provider.compute_type,
                "text": result.text,
                "language": result.language,
                "language_probability": result.language_probability,
                "audio_duration_seconds": result.audio_duration_seconds,
                "latency_ms": round((perf_counter() - started_at) * 1000),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
