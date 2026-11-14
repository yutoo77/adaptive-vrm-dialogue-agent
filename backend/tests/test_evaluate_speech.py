import io
import wave

import pytest

from scripts.evaluate_speech import percentile, wav_duration_seconds


def create_wav(frame_rate: int = 24_000, frames: int = 12_000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(frame_rate)
        wav_file.writeframes(b"\x00\x00" * frames)
    return output.getvalue()


def test_wav_duration_uses_frame_count_and_rate() -> None:
    assert wav_duration_seconds(create_wav()) == pytest.approx(0.5)


def test_percentile_is_stable_for_the_ten_case_evaluation() -> None:
    values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

    assert percentile(values, 0.95) == 100
    assert percentile([], 0.95) == 0
