import type { CommsEntry } from "../game/commsLogIngest.js";
import { createChatPanel } from "./chatPanel.js";

export type SidePanel = {
  syncComms: (entries: CommsEntry[]) => void;
  appendCommsEntry: (entry: CommsEntry, notify?: boolean) => void;
  setExpanded: (on: boolean) => void;
  toggleExpanded: () => void;
};

const EXPANDED_LS = "playpowermud-side-panel-expanded";

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

function readExpanded(): boolean {
  const stored = localStorage.getItem(EXPANDED_LS);
  if (stored != null) return stored !== "0";
  return false;
}

/** Comms side panel: tells, says, shouts and channels parsed from the MUD stream. */
export function createSidePanel(opts: { mount: HTMLElement; onCommsClear?: () => void }): SidePanel {
  const root = opts.mount;
  root.classList.add("side-panel-root");
  root.innerHTML = "";

  const bar = el("div", { class: "side-panel-bar" });
  const tabs = el("div", { class: "side-panel-tabs", role: "tablist" });
  const tabComms = el("button", {
    type: "button",
    class: "side-panel-tab side-panel-tab-active",
    role: "tab",
    "aria-selected": "true",
    "data-tab": "comms",
  }, "Comms");
  tabs.append(tabComms);

  const collapseBtn = el("button", {
    type: "button",
    class: "side-panel-collapse",
    title: "Collapse comms panel (Option+C)",
  }, "◂");

  const clearBtn = el("button", {
    type: "button",
    class: "side-panel-clear",
    title: "Clear comms log",
  }, "Clear");
  bar.append(collapseBtn, tabs, clearBtn);

  const body = el("div", { class: "side-panel-body" });
  const commsMount = el("div", { class: "side-panel-pane", "data-pane": "comms" });
  body.append(commsMount);
  root.append(bar, body);

  let expanded = readExpanded();

  function setExpanded(on: boolean): void {
    expanded = on;
    root.classList.toggle("side-panel-collapsed", !on);
    root.setAttribute("aria-expanded", on ? "true" : "false");
    body.hidden = !on;
    collapseBtn.textContent = on ? "◂" : "▸";
    collapseBtn.title = on ? "Collapse comms panel (Option+C)" : "Expand comms panel (Option+C)";
    localStorage.setItem(EXPANDED_LS, on ? "1" : "0");
  }

  const chat = createChatPanel({
    mount: commsMount,
    embedded: true,
    onNewEntry: () => {
      if (!expanded) setExpanded(true);
    },
  });

  tabComms.addEventListener("click", () => {
    if (!expanded) setExpanded(true);
  });
  collapseBtn.addEventListener("click", () => setExpanded(!expanded));
  clearBtn.addEventListener("click", () => opts.onCommsClear?.());

  setExpanded(expanded);

  return {
    syncComms(entries) {
      chat.replaceEntries(entries);
    },
    appendCommsEntry(entry, notify = true) {
      chat.appendEntry(entry, notify);
    },
    setExpanded,
    toggleExpanded() {
      setExpanded(!expanded);
    },
  };
}
