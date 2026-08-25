from __future__ import annotations

from typing import Literal

ResponseStyle = Literal["concise", "balanced", "detailed", "beginner"]

RESPONSE_STYLE_INSTRUCTIONS: dict[ResponseStyle, str] = {
    "concise": (
        "応答スタイルはconciseです。結論を先に、原則1文、長くても2文で返してください。"
        "補足や列挙は、質問へ答えるために不可欠な場合だけにしてください。"
    ),
    "balanced": (
        "応答スタイルはbalancedです。自然で簡潔な1〜3文を基本にし、"
        "結論と必要最小限の理由を返してください。"
    ),
    "detailed": (
        "応答スタイルはdetailedです。最初に結論を示し、その後に理由、手順、注意点を"
        "必要な範囲で3〜6文に整理してください。情報量のためだけの冗長化は避けてください。"
    ),
    "beginner": (
        "応答スタイルはbeginnerです。専門用語をできるだけ避け、必要な用語には短い説明を添え、"
        "前提知識がなくても追える2〜4文で返してください。利用者の能力を推測した表現は避けてください。"
    ),
}


def response_style_instruction(style: ResponseStyle) -> str:
    return RESPONSE_STYLE_INSTRUCTIONS[style]


def apply_mock_response_style(reply: str, style: ResponseStyle) -> str:
    """Make the deterministic Mock visibly demonstrate the selected style."""
    if style == "concise":
        return _first_sentence(reply)
    if style == "detailed":
        return f"{reply} 理由や手順が必要なら、要点を分けて順番に詳しく説明するよ。"
    if style == "beginner":
        simplified = reply
        for source, replacement in (
            ("VOICEVOXの音声再生", "端末内で作った音声の再生"),
            ("VOICEVOX", "端末内の音声機能"),
            ("OpenAI", "外部AI"),
            ("Mock", "無料の簡易応答"),
            ("Text", "文字"),
            ("SQLite", "端末内の保存領域"),
        ):
            simplified = simplified.replace(source, replacement)
        return f"{simplified} はじめて出てくる言葉には、短い説明を添えて話すね。"
    return reply


def _first_sentence(text: str) -> str:
    punctuation_positions = [text.find(mark) for mark in "。！？" if mark in text]
    if not punctuation_positions:
        return text
    end = min(punctuation_positions) + 1
    return text[:end]
