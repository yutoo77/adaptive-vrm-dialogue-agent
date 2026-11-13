import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { DialogueRole } from "../dialogue/types";
import { icon } from "./icons";

interface Line {
  readonly id: number;
  readonly role: DialogueRole;
  readonly text: string;
}

const HISTORY_LIMIT = 20;

/** Connects the existing dialogue callbacks to the React-owned presentation. */
export class DialoguePresentation {
  private readonly root: Root;
  private lines: readonly Line[] = [];
  private partial: Line | null = null;
  private nextId = 0;
  private speaker = "しずく";
  private busy = false;

  public constructor(container: HTMLElement) {
    this.root = createRoot(container);
    this.render();
  }

  public append(role: DialogueRole, text: string): void {
    this.remember({ id: this.nextId++, role, text });
    this.render();
  }

  public stream(text: string): void {
    const firstChunk = this.partial === null;
    this.partial = { id: this.partial?.id ?? this.nextId++, role: "assistant", text };
    // Commit the start of the provisional line before the dialogue controller starts speech.
    if (firstChunk) flushSync(() => this.render());
    else this.render();
  }

  public complete(text: string): void {
    this.remember({ id: this.partial?.id ?? this.nextId++, role: "assistant", text });
    this.partial = null;
    this.render();
  }

  public discard(): void {
    if (!this.partial) return;
    this.partial = null;
    this.render();
  }

  public reset(): void {
    this.lines = [];
    this.partial = null;
    this.render();
  }

  public setSpeaker(speaker: string): void {
    this.speaker = speaker;
    this.render();
  }

  public setBusy(busy: boolean): void {
    this.busy = busy;
    this.render();
  }

  public dispose(): void { this.root.unmount(); }

  private remember(line: Line): void {
    this.lines = [...this.lines, line].slice(-HISTORY_LIMIT);
  }

  private render(): void {
    this.root.render(<DialogueScene lines={this.lines} partial={this.partial} speaker={this.speaker} busy={this.busy} />);
  }
}

interface SceneProps {
  readonly lines: readonly Line[];
  readonly partial: Line | null;
  readonly speaker: string;
  readonly busy: boolean;
}

function DialogueScene({ lines, partial, speaker, busy }: SceneProps) {
  const history = useRef<HTMLDialogElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const latestReply = useRef<HTMLElement>(null);
  const historyButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const lastReply = lines.findLast((line) => line.role === "assistant");
  const current = partial ?? lastReply;
  const recent = lines.filter((line) => line.id !== current?.id).slice(-3);
  const displayed = partial ? [...lines, partial] : lines;

  function openHistory(button: HTMLButtonElement, readCurrent = false) {
    if (!history.current || history.current.open) return;
    opener.current = button;
    history.current.showModal();
    const transcript = log.current;
    if (!transcript) return;
    const finalLine = latestReply.current;
    transcript.scrollTop = readCurrent && finalLine
      ? transcript.scrollTop + finalLine.getBoundingClientRect().top - transcript.getBoundingClientRect().top
      : transcript.scrollHeight;
  }

  function restoreFocus() {
    const target = opener.current?.isConnected ? opener.current : historyButton.current;
    target?.focus();
    opener.current = null;
  }

  return <>
    <CurrentUtterance line={current} speaker={speaker} busy={busy} provisional={partial !== null}
      onRead={(button) => openHistory(button, true)} />
    <aside id="recent-dialogue" className="scene-recent" aria-label="最近の会話" hidden={!recent.length}>
      {recent.map((line) => <div className={`recent-line is-${line.role}`} key={line.id}>
        <span>{line.role === "user" ? "あなた" : speaker}</span>
        <p>{line.text}</p>
      </div>)}
    </aside>
    <button id="history-open" ref={historyButton} type="button" className="quiet-button" aria-label="会話履歴を開く" title="会話履歴を開く" aria-haspopup="dialog"
      onClick={(event) => openHistory(event.currentTarget)}>
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon("conversation") }} />
    </button>
    <div className="visually-hidden" role="status" aria-atomic="true">{lastReply && <span key={lastReply.id}>{speaker}：{lastReply.text}</span>}</div>
    <dialog id="history-dialog" className="history-dialog" aria-labelledby="history-title" ref={history} onClose={restoreFocus}>
      <header>
        <h2 id="history-title">会話履歴</h2>
        <button id="history-close" className="icon-button" type="button" aria-label="履歴を閉じる" autoFocus
          onClick={() => history.current?.close()}>
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon("close") }} />
        </button>
      </header>
      <div id="dialogue-log" className="dialogue-log" aria-label="会話履歴" aria-busy={busy} ref={log} tabIndex={0}>
        {!displayed.length && <p className="history-empty">会話はまだありません。</p>}
        {displayed.map((line) => <article key={line.id} ref={line.id === lastReply?.id ? latestReply : undefined}
          className={`dialogue-message is-${line.role}${line === partial ? " is-streaming" : ""}`}
          aria-hidden={line === partial ? true : undefined} data-streaming-assistant={line === partial ? "true" : undefined}>
          <span>{line.role === "user" ? "あなた" : speaker}</span>
          <p>{line.text}</p>
        </article>)}
      </div>
    </dialog>
  </>;
}

interface UtteranceProps {
  readonly line: Line | undefined;
  readonly speaker: string;
  readonly busy: boolean;
  readonly provisional: boolean;
  readonly onRead: (button: HTMLButtonElement) => void;
}

function CurrentUtterance({ line, speaker, busy, provisional, onRead }: UtteranceProps) {
  const body = useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = useState(false);

  useLayoutEffect(() => {
    const paragraph = body.current;
    if (!paragraph) return;
    const measure = () => setClipped(paragraph.scrollHeight > paragraph.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);
    measure();
    return () => observer.disconnect();
  }, [line?.text]);

  return <section id="current-utterance" className="scene-utterance" data-empty={line ? undefined : "true"}>
    {line ? <>
      <div aria-hidden={provisional || undefined}>
        <span className="scene-speaker">{busy && !provisional ? "考え中…" : speaker}</span>
        <p ref={body}>{line.text}</p>
      </div>
      {clipped && !provisional && <button id="read-reply" type="button" className="text-button" aria-haspopup="dialog"
        onClick={(event) => onRead(event.currentTarget)}>全文を読む</button>}
    </> : <h3>{busy ? "考え中…" : "何から話そう？"}</h3>}
  </section>;
}
