const SENTENCE_ENDINGS = new Set(["。", "！", "？", "!", "?", "\n"]);
const TRAILING_CLOSERS = new Set(["」", "』", "）", ")", "】", "]", "〉", "》", "”", "’"]);
const SOFT_BREAKS = new Set(["、", "，", ",", "；", ";", "：", ":", " "]);

export const MAX_STREAMING_SPEECH_SEGMENT_CHARACTERS = 120;
const MIN_SOFT_BREAK_CHARACTERS = 36;

/**
 * Buffers model deltas until a sentence is closed. This prevents VOICEVOX from
 * speaking an unfinished word while still bounding latency for punctuation-free
 * responses.
 */
export class StreamingSpeechSegmenter {
  private buffer = "";

  public push(delta: string): readonly string[] {
    if (delta) this.buffer += delta;
    return this.drain(false);
  }

  public complete(): readonly string[] {
    return this.drain(true);
  }

  public discard(): void {
    this.buffer = "";
  }

  private drain(flush: boolean): readonly string[] {
    const segments: string[] = [];
    while (this.buffer) {
      const sentenceEnd = findSentenceEnd(this.buffer);
      if (sentenceEnd !== null) {
        this.take(sentenceEnd, segments);
        continue;
      }

      if (this.buffer.length > MAX_STREAMING_SPEECH_SEGMENT_CHARACTERS) {
        this.take(findBoundedBreak(this.buffer), segments);
        continue;
      }

      if (flush) this.take(this.buffer.length, segments);
      break;
    }
    return segments;
  }

  private take(end: number, segments: string[]): void {
    const segment = this.buffer.slice(0, end).trim();
    this.buffer = this.buffer.slice(end).trimStart();
    if (segment) segments.push(segment);
  }
}

function findSentenceEnd(value: string): number | null {
  for (let index = 0; index < value.length; index += 1) {
    if (!SENTENCE_ENDINGS.has(value[index] ?? "")) continue;
    let end = index + 1;
    while (end < value.length && SENTENCE_ENDINGS.has(value[end] ?? "")) end += 1;
    while (end < value.length && TRAILING_CLOSERS.has(value[end] ?? "")) end += 1;
    return end;
  }
  return null;
}

function findBoundedBreak(value: string): number {
  const maximum = Math.min(value.length, MAX_STREAMING_SPEECH_SEGMENT_CHARACTERS);
  for (let index = maximum - 1; index >= MIN_SOFT_BREAK_CHARACTERS; index -= 1) {
    if (SOFT_BREAKS.has(value[index] ?? "")) return index + 1;
  }
  return maximum;
}
