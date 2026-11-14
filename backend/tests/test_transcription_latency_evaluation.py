import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from scripts.evaluate_transcription_latency import TEXTS, compare, evaluate, main, normalize


def test_fake_benchmark_is_bounded_and_separates_loading_from_lazy_decode() -> None:
    now = [0.0]

    def load(*_args, **_kwargs):
        now[0] += 2
        return model

    def decode(*args, **_kwargs):
        index = int(args[0].read().decode())

        def segments():
            now[0] += 0.5
            yield SimpleNamespace(text=TEXTS[index])

        return segments(), SimpleNamespace(duration=3)

    speech = SimpleNamespace(
        check_health=AsyncMock(return_value=SimpleNamespace(available=True, engine_version="fake")),
        synthesize=AsyncMock(side_effect=[SimpleNamespace(audio=str(i).encode()) for i in range(5)]),
    )
    model = SimpleNamespace(transcribe=Mock(side_effect=decode))
    factory = Mock(side_effect=load)
    report = asyncio.run(evaluate(speech, factory, lambda: now[0]))
    factory.assert_called_once_with("small", device="cpu", compute_type="int8", local_files_only=True)
    assert speech.synthesize.call_count == 5
    assert model.transcribe.call_count == 10
    assert report["model_init_ms"] == 2000
    assert report["first_decode_ms"] == report["subsequent_median_ms"] == 500
    assert report["normalized_exact_count"] == 10
    assert all(call.kwargs["beam_size"] == 5 for call in model.transcribe.call_args_list)
    assert all("audio" not in row for row in report["rows"])


def test_missing_voicevox_never_loads_model() -> None:
    speech = SimpleNamespace(check_health=AsyncMock(return_value=SimpleNamespace(available=False)))
    factory = Mock()
    with pytest.raises(RuntimeError):
        asyncio.run(evaluate(speech, factory))
    factory.assert_not_called()


def test_normalization_removes_only_spacing_punctuation_and_width() -> None:
    assert normalize("ＡＩ、話そう。\n") == "AI話そう"
    assert normalize("栞") != normalize("しおり")


def test_no_flag_does_not_start_services(monkeypatch, capsys) -> None:
    monkeypatch.setattr("sys.argv", ["evaluate_transcription_latency"])
    factory = Mock()
    monkeypatch.setattr("scripts.evaluate_transcription_latency.VoicevoxSpeechProvider", factory)
    assert main() == 2
    factory.assert_not_called()
    assert "No work performed" in capsys.readouterr().out


def test_paired_comparison_uses_same_clips_and_reverses_order() -> None:
    def decode(audio, **_kwargs):
        return [SimpleNamespace(text=TEXTS[int(audio.read().decode())])], SimpleNamespace(duration=1)

    model = SimpleNamespace(transcribe=Mock(side_effect=decode))
    result = compare(model, [str(index).encode() for index in range(5)], lambda: 0)
    assert model.transcribe.call_count == 20
    assert [call.kwargs["beam_size"] for call in model.transcribe.call_args_list] == [5, 1] * 5 + [1, 5] * 5
    assert result["beam_5_exact_count"] == result["beam_1_exact_count"] == result["same_normalized_count"] == 10
    assert result["median_paired_saving_ms"] == 0
