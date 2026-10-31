import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

export type MudTerminalSkin = "dark" | "light";

const SCROLLBAR_WIDTH = 14;

const DARK_THEME = {
  background: "#0f1419",
  foreground: "#d6dde6",
  cursor: "#d6dde6",
  selectionBackground: "#3465a488",
  scrollbarSliderBackground: "#d6dde644",
  scrollbarSliderHoverBackground: "#d6dde673",
  scrollbarSliderActiveBackground: "#d6dde688",
};

const LIGHT_THEME = {
  background: "#f4f6fa",
  foreground: "#1a1f2e",
  cursor: "#1a1f2e",
  selectionBackground: "#729fcf55",
  scrollbarSliderBackground: "#1a1f2e33",
  scrollbarSliderHoverBackground: "#1a1f2e55",
  scrollbarSliderActiveBackground: "#1a1f2e66",
};

export type MudTerminal = {
  write: (text: string) => void;
  reset: () => void;
  scrollToBottom: () => void;
  isPinnedToBottom: () => boolean;
  applyTheme: (skin: MudTerminalSkin) => void;
  dispose: () => void;
};

export function createMudTerminal(mount: HTMLElement, scrollbackLines: number): MudTerminal {
  mount.classList.add("mud-xterm-host");
  mount.innerHTML = "";

  const term = new Terminal({
    scrollback: scrollbackLines,
    convertEol: true,
    disableStdin: true,
    scrollOnUserInput: false,
    smoothScrollDuration: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 14,
    lineHeight: 1.35,
    overviewRuler: { width: SCROLLBAR_WIDTH },
    theme: DARK_THEME,
  });

  term.open(mount);
  if (term.textarea) {
    term.textarea.inputMode = "none";
    term.textarea.readOnly = true;
  }

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  function fitTerminal(): void {
    try {
      fitAddon.fit();
    } catch {
      /* mount may have zero size before layout */
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(fitTerminal);
  });
  resizeObserver.observe(mount);

  requestAnimationFrame(fitTerminal);

  /** Log clicks focus #input for typing; xterm selection survives but copy goes to input. */
  function onCopyShortcut(e: KeyboardEvent): void {
    if (e.code !== "KeyC" && e.key !== "c" && e.key !== "C") return;
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.altKey) return;
    if (!term.hasSelection()) return;
    const text = term.getSelection();
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard?.writeText(text);
  }
  document.addEventListener("keydown", onCopyShortcut, true);

  /** True when the live tail is visible (not reading scrollback). */
  function isPinnedToBottom(): boolean {
    const buf = term.buffer.active;
    return buf.viewportY >= buf.baseY;
  }

  /**
   * Reading history must survive the next write. Re-checked when the write finishes.
   * `wasPinned` stops a write's scroll event from re-enabling follow before the
   * finger has actually left the tail.
   */
  let followTail = true;
  let wasPinned = true;

  const latestBtn = document.createElement("button");
  latestBtn.type = "button";
  latestBtn.className = "log-latest";
  latestBtn.textContent = "Latest";
  latestBtn.title = "Jump to the newest text";
  latestBtn.hidden = true;
  mount.append(latestBtn);

  function setFollowTail(next: boolean): void {
    if (followTail === next) return;
    followTail = next;
    latestBtn.hidden = next;
    mount.classList.toggle("mud-log-detached", !next);
  }

  function scrollToBottom(): void {
    setFollowTail(true);
    wasPinned = true;
    term.scrollToBottom();
  }

  latestBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollToBottom();
  });

  const scrollSub = term.onScroll(() => {
    const pinned = isPinnedToBottom();
    if (!pinned) setFollowTail(false);
    else if (!wasPinned) setFollowTail(true);
    wasPinned = pinned;
  });

  const detachTouch = attachTouchScroll(term, mount, () => {
    // Leave the tail immediately. Otherwise xterm keeps following until a full line of drag.
    if (isPinnedToBottom()) term.scrollLines(-1);
    setFollowTail(false);
  });

  /** Keep the hidden xterm field from opening the mobile keyboard when the log is tapped. */
  const onTextareaFocus = () => {
    if (!document.body.classList.contains("layout-mobile")) return;
    term.textarea?.blur();
  };
  term.textarea?.addEventListener("focus", onTextareaFocus);

  return {
    write(text: string) {
      if (!text) return;
      term.write(text, () => {
        if (followTail) term.scrollToBottom();
      });
    },
    reset() {
      setFollowTail(true);
      wasPinned = true;
      term.reset();
    },
    scrollToBottom,
    isPinnedToBottom,
    applyTheme(skin: MudTerminalSkin) {
      term.options.theme = skin === "light" ? LIGHT_THEME : DARK_THEME;
    },
    dispose() {
      document.removeEventListener("keydown", onCopyShortcut, true);
      term.textarea?.removeEventListener("focus", onTextareaFocus);
      scrollSub.dispose();
      detachTouch();
      latestBtn.remove();
      resizeObserver.disconnect();
      term.dispose();
    },
  };
}

/**
 * Touch drag scrolls the buffer. xterm only listens for wheel events, and a finger
 * drag was starting a selection (then the next write jumped back to the tail).
 * `onReadingHistory` runs as soon as the finger moves down the log, before a full line.
 */
function attachTouchScroll(
  term: Terminal,
  mount: HTMLElement,
  onReadingHistory: () => void,
): () => void {
  const host = term.element ?? mount;
  let tracking = false;
  let lastY = 0;
  let accum = 0;
  let gestureDy = 0;
  let velocity = 0;
  let lastT = 0;
  let inertiaRaf = 0;

  function linePx(): number {
    const font = typeof term.options.fontSize === "number" ? term.options.fontSize : 14;
    const lh = typeof term.options.lineHeight === "number" ? term.options.lineHeight : 1;
    return Math.max(8, font * lh);
  }

  function flushAccum(): void {
    const px = linePx();
    const lines = Math.trunc(accum / px);
    if (lines === 0) return;
    term.scrollLines(lines);
    accum -= lines * px;
  }

  function stopInertia(): void {
    if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
    inertiaRaf = 0;
  }

  function onStart(e: TouchEvent): void {
    if (e.touches.length !== 1) {
      tracking = false;
      return;
    }
    const touch = e.touches[0];
    if (!touch || (e.target instanceof Element && e.target.closest(".scrollbar, .log-latest"))) {
      tracking = false;
      return;
    }
    stopInertia();
    tracking = true;
    lastY = touch.clientY;
    accum = 0;
    gestureDy = 0;
    velocity = 0;
    lastT = e.timeStamp;
  }

  function onMove(e: TouchEvent): void {
    if (!tracking || e.touches.length !== 1) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dy = lastY - touch.clientY;
    const dt = Math.max(8, e.timeStamp - lastT);
    lastY = touch.clientY;
    lastT = e.timeStamp;
    gestureDy += dy;
    accum += dy;
    velocity = dy / dt;
    if (Math.abs(gestureDy) < 8) return;
    if (gestureDy < -8) onReadingHistory();
    if (e.cancelable) e.preventDefault();
    flushAccum();
  }

  function onEnd(): void {
    if (!tracking) return;
    tracking = false;
    let v = velocity;
    if (Math.abs(v) < 0.05) return;
    let prev = performance.now();
    const step = (now: number) => {
      const dt = now - prev;
      prev = now;
      v *= Math.exp(-dt / 160);
      if (Math.abs(v) < 0.02) return;
      const buf = term.buffer.active;
      if (v > 0 && buf.viewportY >= buf.baseY) return;
      if (v < 0 && buf.viewportY <= 0) return;
      accum += v * dt;
      flushAccum();
      inertiaRaf = requestAnimationFrame(step);
    };
    inertiaRaf = requestAnimationFrame(step);
  }

  host.addEventListener("touchstart", onStart, { passive: true });
  host.addEventListener("touchmove", onMove, { passive: false });
  host.addEventListener("touchend", onEnd);
  host.addEventListener("touchcancel", onEnd);

  return () => {
    stopInertia();
    host.removeEventListener("touchstart", onStart);
    host.removeEventListener("touchmove", onMove);
    host.removeEventListener("touchend", onEnd);
    host.removeEventListener("touchcancel", onEnd);
  };
}
