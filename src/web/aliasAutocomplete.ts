import {
  isSlashAliasDefinePrefix,
  isSlashAliasUndefinePrefix,
  parseSlashAliasDefineLine,
  parseSlashAliasUndefineLine,
} from "../aliases/slashDefine.js";
import { filterSlashCommands, isSlashCommandArgsEntry } from "../aliases/slashCommands.js";

export {
  isSlashAliasDefinePrefix,
  isSlashAliasUndefinePrefix,
  parseSlashAliasDefineLine,
  parseSlashAliasUndefineLine,
};

export type SlashAliasParse = { query: string; suffix: string };

export function parseSlashAliasLine(text: string): SlashAliasParse | null {
  if (!text.startsWith("/")) return null;
  const rest = text.slice(1);
  const space = rest.search(/\s/);
  if (space < 0) return { query: rest, suffix: "" };
  return { query: rest.slice(0, space), suffix: rest.slice(space) };
}

/** Higher is better; -1 = no match. */
export function fuzzyAliasScore(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  if (n.startsWith(q)) return 10_000 - n.length;
  if (n.includes(q)) return 5000 - n.length;

  let qi = 0;
  let score = 0;
  let run = 0;
  let last = -2;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] !== q[qi]) continue;
    if (last === i - 1) run += 1;
    else run = 0;
    score += 20 + run * 5;
    if (qi === 0 && i === 0) score += 40;
    last = i;
    qi += 1;
  }
  if (qi !== q.length) return -1;
  return score - n.length;
}

export function filterAliasNames(names: string[], query: string, limit = 12): string[] {
  const trimmed = query.trim();
  const ranked: { name: string; score: number }[] = [];
  for (const name of names) {
    const score = fuzzyAliasScore(name, trimmed);
    if (score < 0) continue;
    ranked.push({ name, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return ranked.slice(0, limit).map((r) => r.name);
}

export function mergeAutocompleteNames(
  slashQuery: string,
  aliasNames: string[],
  limit = 12,
): string[] {
  const slashHits = filterSlashCommands(slashQuery, limit, fuzzyAliasScore);
  const aliasHits =
    slashQuery.trim() === "" ? [] : filterAliasNames(aliasNames, slashQuery, limit);
  const merged = [...slashHits];
  for (const name of aliasHits) {
    if (merged.length >= limit) break;
    if (!merged.includes(name)) merged.push(name);
  }
  return merged.slice(0, limit);
}

export type AliasAutocompleteController = {
  refresh: () => boolean;
  hide: (clearList?: boolean) => void;
  moveSelection: (delta: number) => boolean;
  acceptSelected: () => boolean;
  isOpen: () => boolean;
};

export function createAliasAutocomplete(opts: {
  listEl: HTMLElement;
  getNames: () => string[];
  getLineText: () => string;
  applyName: (name: string) => void;
}): AliasAutocompleteController {
  const { listEl, getNames, getLineText, applyName } = opts;
  let visible: string[] = [];
  let selected = 0;

  function hide(clearList = true) {
    visible = [];
    selected = 0;
    if (!clearList) return;
    listEl.hidden = true;
    listEl.replaceChildren();
  }

  function render() {
    listEl.replaceChildren();
    if (visible.length === 0) {
      listEl.hidden = true;
      return;
    }
    listEl.hidden = false;
    for (let i = 0; i < visible.length; i++) {
      const name = visible[i];
      const li = document.createElement("li");
      li.className = "alias-ac-item";
      li.setAttribute("role", "option");
      li.dataset.name = name;
      if (i === selected) {
        li.classList.add("alias-ac-item-active");
        li.setAttribute("aria-selected", "true");
      } else {
        li.setAttribute("aria-selected", "false");
      }
      li.textContent = name;
      listEl.appendChild(li);
    }
  }

  function refresh(): boolean {
    const line = getLineText();
    if (isSlashCommandArgsEntry(line)) {
      hide();
      return false;
    }
    const parsed = parseSlashAliasLine(line);
    if (!parsed) {
      hide();
      return false;
    }
    const next = mergeAutocompleteNames(parsed.query, getNames());
    const same = next.length === visible.length && next.every((n, i) => n === visible[i]);
    visible = next;
    if (!same) selected = 0;
    else selected = Math.min(selected, Math.max(0, visible.length - 1));
    render();
    return visible.length > 0;
  }

  function moveSelection(delta: number): boolean {
    if (visible.length === 0) return false;
    selected = (selected + delta + visible.length) % visible.length;
    render();
    return true;
  }

  function acceptSelected(): boolean {
    if (visible.length === 0) return false;
    applyName(visible[selected]!);
    hide();
    return true;
  }

  listEl.addEventListener("mousedown", (e) => {
    const item = e.target instanceof Element ? e.target.closest(".alias-ac-item") : null;
    if (!item) return;
    e.preventDefault();
    const name = item.getAttribute("data-name");
    if (!name) return;
    applyName(name);
    hide();
  });

  return {
    refresh,
    hide,
    moveSelection,
    acceptSelected,
    isOpen: () => visible.length > 0,
  };
}
