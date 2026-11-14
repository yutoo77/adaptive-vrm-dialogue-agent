import { describe, expect, it } from "vitest";

import {
  MAX_STREAMING_SPEECH_SEGMENT_CHARACTERS,
  StreamingSpeechSegmenter,
} from "./StreamingSpeechSegmenter";

describe("StreamingSpeechSegmenter", () => {
  it("waits for a closed Japanese sentence across arbitrary deltas", () => {
    const segmenter = new StreamingSpeechSegmenter();

    expect(segmenter.push("今日は青い")).toEqual([]);
    expect(segmenter.push("傘を持っていきましょう")).toEqual([]);
    expect(segmenter.push("。次も")).toEqual(["今日は青い傘を持っていきましょう。"]);
    expect(segmenter.complete()).toEqual(["次も"]);
  });

  it("keeps repeated punctuation and a closing quote with the sentence", () => {
    const segmenter = new StreamingSpeechSegmenter();

    expect(segmenter.push("『本当！？』 続きです。")).toEqual(["『本当！？』", "続きです。"]);
  });

  it("treats a newline as a boundary without producing empty speech", () => {
    const segmenter = new StreamingSpeechSegmenter();

    expect(segmenter.push("一行目\n\n二行目。")).toEqual(["一行目", "二行目。"]);
    expect(segmenter.complete()).toEqual([]);
  });

  it("bounds punctuation-free text and prefers a soft break", () => {
    const segmenter = new StreamingSpeechSegmenter();
    const prefix = "あ".repeat(60);
    const suffix = "い".repeat(80);

    const segments = segmenter.push(`${prefix}、${suffix}`);

    expect(segments).toEqual([`${prefix}、`]);
    expect(segments[0]?.length).toBeLessThanOrEqual(MAX_STREAMING_SPEECH_SEGMENT_CHARACTERS);
    expect(segmenter.complete()).toEqual([suffix]);
  });

  it("can discard an uncommitted fragment", () => {
    const segmenter = new StreamingSpeechSegmenter();
    segmenter.push("まだ途中");

    segmenter.discard();

    expect(segmenter.complete()).toEqual([]);
  });
});
