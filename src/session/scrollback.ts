/** Strip common ANSI SGR/CSI sequences from MUD output. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export type ScrollbackLine = { n: number; text: string };

export class ScrollbackBuffer {
  private lines: ScrollbackLine[] = [];
  private nextLine = 1;

  constructor(private readonly maxLines: number) {}

  append(text: string): void {
    if (!text) return;
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      const piece = parts[i] ?? "";
      const isLast = i === parts.length - 1;
      if (isLast && !text.endsWith("\n")) {
        this.appendPartial(piece);
        continue;
      }
      if (piece === "" && isLast) continue;
      this.pushCompleteLine(piece);
    }
  }

  private partial = "";

  private appendPartial(piece: string): void {
    if (this.partial === "" && piece === "") return;
    if (this.partial === "") {
      this.partial = piece;
      return;
    }
    this.pushCompleteLine(this.partial + piece);
    this.partial = "";
  }

  private pushCompleteLine(text: string): void {
    const line: ScrollbackLine = { n: this.nextLine++, text };
    this.lines.push(line);
    while (this.lines.length > this.maxLines) this.lines.shift();
  }

  /** Flush a trailing partial line as its own entry (e.g. before read). */
  flushPartial(): void {
    if (this.partial === "") return;
    this.pushCompleteLine(this.partial);
    this.partial = "";
  }

  tailLines(count: number, opts?: { stripAnsi?: boolean }): ScrollbackLine[] {
    this.flushPartial();
    const n = Math.max(1, Math.min(count, this.maxLines));
    const slice = this.lines.slice(-n);
    if (!opts?.stripAnsi) return slice.map((l) => ({ ...l }));
    return slice.map((l) => ({ n: l.n, text: stripAnsi(l.text) }));
  }

  tailText(count: number, opts?: { stripAnsi?: boolean }): string {
    return this.tailLines(count, opts)
      .map((l) => l.text)
      .join("\n");
  }

  /** Line number of the last complete scrollback line (0 when empty). */
  lastLineNo(): number {
    this.flushPartial();
    return this.lines.at(-1)?.n ?? 0;
  }

  /** Lines after `sinceLine` (exclusive), capped to the most recent `maxLines`. */
  tailTextSince(sinceLine: number, maxLines: number, opts?: { stripAnsi?: boolean }): string {
    this.flushPartial();
    const cap = Math.max(1, maxLines);
    const slice = this.lines.filter((l) => l.n > sinceLine).slice(-cap);
    if (!opts?.stripAnsi) return slice.map((l) => l.text).join("\n");
    return slice.map((l) => stripAnsi(l.text)).join("\n");
  }

}
