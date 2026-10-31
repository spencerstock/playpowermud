import type { CommsEntry } from "../game/commsLogIngest.js";

export type ChatEntry = CommsEntry;

export type ChatPanel = {
  replaceEntries: (entries: CommsEntry[]) => void;
  appendEntry: (entry: CommsEntry, notify?: boolean) => void;
  clear: () => void;
};

const CAP = 400;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function createChatPanel(opts: {
  mount: HTMLElement;
  embedded?: boolean;
  /** Fired when a comm line is appended (not on clear/re-render). */
  onNewEntry?: () => void;
}): ChatPanel {
  const root = opts.mount;
  const embedded = opts.embedded === true;
  root.classList.add(embedded ? "chat-panel-embedded" : "chat-panel-root");
  root.innerHTML = "";

  const list = el("div", { class: "chat-panel-list" });
  if (!embedded) {
    const bar = el("div", { class: "chat-panel-bar" });
    const title = el("div", { class: "chat-panel-title" }, "Comms");
    bar.append(title);
    root.append(bar, list);
  } else {
    root.append(list);
  }

  const entries: CommsEntry[] = [];

  function isPinnedToBottom(): boolean {
    return list.scrollHeight - list.clientHeight - list.scrollTop <= 48;
  }

  function speakerLabel(entry: CommsEntry): string {
    if (entry.kind === "tell" && entry.speaker === "You" && entry.target) {
      return `You → ${entry.target}`;
    }
    return entry.speaker;
  }

  function renderEntry(entry: CommsEntry): HTMLElement {
    const row = el("div", { class: `chat-line chat-line-${entry.kind}` });
    const time = el("time", { class: "chat-time", datetime: new Date(entry.at).toISOString() }, formatTime(entry.at));
    const kind = el("span", { class: "chat-kind" }, entry.kind);
    const who = el("span", { class: "chat-who" }, speakerLabel(entry));
    const msg = el("span", { class: "chat-msg" }, entry.message || "—");
    row.append(time, kind, who, msg);
    return row;
  }

  function renderList(): void {
    const pinned = isPinnedToBottom();
    list.replaceChildren();
    for (const entry of entries) {
      list.append(renderEntry(entry));
    }
    if (pinned) list.scrollTop = list.scrollHeight;
  }

  function appendEntry(entry: CommsEntry, notify = true): void {
    entries.push(entry);
    if (entries.length > CAP) entries.splice(0, entries.length - CAP);
    const pinned = isPinnedToBottom();
    list.append(renderEntry(entry));
    if (pinned) list.scrollTop = list.scrollHeight;
    if (notify) opts.onNewEntry?.();
  }

  return {
    replaceEntries(next) {
      entries.length = 0;
      for (const e of next.slice(-CAP)) entries.push(e);
      renderList();
    },
    appendEntry,
    clear() {
      entries.length = 0;
      list.replaceChildren();
    },
  };
}
