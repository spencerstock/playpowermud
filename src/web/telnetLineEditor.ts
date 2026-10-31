/** VT100-style sequences embedded in the command (e.g. say formatting). */
export const CSI = {
  cursorLeft: "\x1b[D",
  cursorRight: "\x1b[C",
  cursorUp: "\x1b[A",
  cursorDown: "\x1b[B",
  backspace: "\x7f",
} as const;

const EMBEDDED_CSI = [CSI.cursorLeft, CSI.cursorRight, CSI.cursorUp, CSI.cursorDown];

function indexBeforeLogicalChar(text: string, index: number): number {
  if (index <= 0) return 0;
  for (const seq of EMBEDDED_CSI) {
    if (index >= seq.length && text.slice(index - seq.length, index) === seq) {
      return index - seq.length;
    }
  }
  return index - 1;
}

function isWhitespaceLogicalChar(text: string, start: number, end: number): boolean {
  const slice = text.slice(start, end);
  if (slice.length === 1) return /\s/.test(slice);
  return EMBEDDED_CSI.includes(slice as (typeof EMBEDDED_CSI)[number]);
}

/**
 * Local line editor for Powermud-style input.
 *
 * Left/right move the cursor within the visible line. Option+Shift+arrow in the Web UI
 * (Alt+arrow / ESC-prefix on some attach TTY setups) inserts cursor-move escapes at the
 * caret (for say/emit layout). Plain
 * up/down recall command history in the Web UI and attach. Powermud's line editor
 * applies DEL for backspace but does not interpret CSI arrows for navigation — only
 * embedded escapes in the final command matter for output positioning.
 */
export class TelnetLineEditor {
  /** Visible line content (may contain embedded CSI bytes). */
  text = "";
  /** Cursor index in `text` (0..text.length). */
  cursor = 0;

  reset(): void {
    this.text = "";
    this.cursor = 0;
  }

  isEmpty(): boolean {
    return this.text.length === 0;
  }

  getWireText(): string {
    return this.text;
  }

  insertChar(ch: string): void {
    if (ch.length !== 1 || ch < " ") return;
    this.text = this.text.slice(0, this.cursor) + ch + this.text.slice(this.cursor);
    this.cursor += 1;
  }

  backspace(): void {
    if (this.cursor <= 0) return;
    const start = indexBeforeLogicalChar(this.text, this.cursor);
    this.deleteRange(start, this.cursor);
  }

  /** macOS Option+Backspace: delete the word or whitespace run before the caret. */
  deleteWordBackward(): void {
    if (this.cursor <= 0) return;
    let start = this.cursor;
    const segmentBeforeIsWhitespace = (pos: number): boolean => {
      const segStart = indexBeforeLogicalChar(this.text, pos);
      return isWhitespaceLogicalChar(this.text, segStart, pos);
    };
    if (segmentBeforeIsWhitespace(start)) {
      while (start > 0 && segmentBeforeIsWhitespace(start)) {
        start = indexBeforeLogicalChar(this.text, start);
      }
    } else {
      while (start > 0 && !segmentBeforeIsWhitespace(start)) {
        start = indexBeforeLogicalChar(this.text, start);
      }
    }
    this.deleteRange(start, this.cursor);
  }

  /** macOS Command+Backspace: delete from line start to the caret. */
  deleteToLineStart(): void {
    if (this.cursor <= 0) return;
    this.deleteRange(0, this.cursor);
  }

  deleteRange(from: number, to: number): void {
    this.text = this.text.slice(0, from) + this.text.slice(to);
    this.cursor = from;
  }

  cursorLeft(): void {
    if (this.cursor <= 0) return;
    this.cursor -= 1;
  }

  cursorRight(): void {
    if (this.cursor >= this.text.length) return;
    this.cursor += 1;
  }

  /** Insert cursor-up escape at the caret (say/emit positioning). */
  insertWireCursorUp(): void {
    this.insertEscapeAtCursor(CSI.cursorUp);
  }

  /** Insert cursor-down escape at the caret. */
  insertWireCursorDown(): void {
    this.insertEscapeAtCursor(CSI.cursorDown);
  }

  insertWireCursorLeft(): void {
    this.insertEscapeAtCursor(CSI.cursorLeft);
  }

  insertWireCursorRight(): void {
    this.insertEscapeAtCursor(CSI.cursorRight);
  }

  private insertEscapeAtCursor(seq: string): void {
    this.text = this.text.slice(0, this.cursor) + seq + this.text.slice(this.cursor);
    this.cursor += seq.length;
  }
}

export type TelnetKeyAction =
  | { type: "char"; ch: string }
  | { type: "enter" }
  | { type: "backspace" }
  | { type: "left" }
  | { type: "right" }
  | { type: "history-up" }
  | { type: "history-down" }
  | { type: "wire-left" }
  | { type: "wire-right" }
  | { type: "wire-up" }
  | { type: "wire-down" }
  | { type: "ctrl-c" };

function csiArrowAction(third: string, meta: boolean): TelnetKeyAction | null {
  if (third === "D") return meta ? { type: "wire-left" } : { type: "left" };
  if (third === "C") return meta ? { type: "wire-right" } : { type: "right" };
  if (third === "A") return meta ? { type: "wire-up" } : { type: "history-up" };
  if (third === "B") return meta ? { type: "wire-down" } : { type: "history-down" };
  return null;
}

/** Incremental parser for raw terminal input (handles split escape sequences). */
export class TelnetKeyParser {
  private buf = "";

  feed(chunk: string): TelnetKeyAction[] {
    this.buf += chunk;
    const out: TelnetKeyAction[] = [];
    while (this.buf.length > 0) {
      const ch = this.buf[0];
      if (ch === "\r" || ch === "\n") {
        this.buf = this.buf.slice(1);
        if (ch === "\r" && this.buf[0] === "\n") this.buf = this.buf.slice(1);
        out.push({ type: "enter" });
        continue;
      }
      if (ch === "\x7f" || ch === "\b") {
        this.buf = this.buf.slice(1);
        out.push({ type: "backspace" });
        continue;
      }
      if (ch === "\x03") {
        this.buf = this.buf.slice(1);
        out.push({ type: "ctrl-c" });
        continue;
      }
      if (ch === "\x1b") {
        if (this.buf.length < 2) break;
        let meta = false;
        let i = 1;
        if (this.buf[1] === "\x1b") {
          meta = true;
          i = 2;
        }
        const second = this.buf[i];
        if (second === "[") {
          if (this.buf.length < i + 2) break;
          const third = this.buf[i + 1];
          this.buf = this.buf.slice(i + 2);
          const action = csiArrowAction(third, meta);
          if (action) out.push(action);
          continue;
        }
        if (second === "O") {
          if (this.buf.length < i + 2) break;
          const third = this.buf[i + 1];
          this.buf = this.buf.slice(i + 2);
          const action = csiArrowAction(third, meta);
          if (action) out.push(action);
          continue;
        }
        // Unknown escape: treat as literal (rare).
        this.buf = this.buf.slice(1);
        out.push({ type: "char", ch: "\x1b" });
        continue;
      }
      this.buf = this.buf.slice(1);
      if (ch >= " ") out.push({ type: "char", ch });
    }
    return out;
  }
}

export function applyTelnetKeyAction(editor: TelnetLineEditor, action: TelnetKeyAction): void {
  switch (action.type) {
    case "char":
      editor.insertChar(action.ch);
      break;
    case "backspace":
      editor.backspace();
      break;
    case "left":
      editor.cursorLeft();
      break;
    case "right":
      editor.cursorRight();
      break;
    case "wire-left":
      editor.insertWireCursorLeft();
      break;
    case "wire-right":
      editor.insertWireCursorRight();
      break;
    case "wire-up":
      editor.insertWireCursorUp();
      break;
    case "wire-down":
      editor.insertWireCursorDown();
      break;
    default:
      break;
  }
}
