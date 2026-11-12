import { isNumericRoomIdQuery } from "../mapper/roomIdQuery.js";
import { fuzzyAliasScore } from "./aliasAutocomplete.js";

export type RoomSearchHitBrief = {
  id: string;
  title?: string | null;
  label?: string | null;
  area?: string | null;
  areaLabel?: string | null;
  /** Walk hops from the current room. Null when there is no path. Omitted when position is unknown. */
  distance?: number | null;
  /** NPC/mob names the map has seen in the room (`/api/map/search`). */
  npcs?: string[];
  /** The NPC every query term matched, when the hit came from an NPC name. */
  npcMatch?: string | null;
};

export type SlashToParse = { query: string };
export type SlashWpParse = { name: string };

/** `/wp home` or `/wp` (not `/wpx` — that stays alias mode). */
export function parseSlashWpLine(text: string): SlashWpParse | null {
  if (!text.toLowerCase().startsWith("/wp")) return null;
  const after = text.slice(3);
  if (after.length > 0 && !/^\s/.test(after)) return null;
  return { name: after.trimStart() };
}

/** `/to market` or `/to` (not `/tom` — that stays alias mode). */
export function parseSlashToLine(text: string): SlashToParse | null {
  if (!text.toLowerCase().startsWith("/to")) return null;
  const after = text.slice(3);
  if (after.length > 0 && !/^\s/.test(after)) return null;
  return { query: after.trimStart() };
}

function roomHitLabelWithId(name: string, id: string): string {
  const n = name.trim();
  if (!n || n.toLowerCase() === id.toLowerCase()) return id;
  return `${n} (${id})`;
}

export function roomHitLabel(hit: RoomSearchHitBrief): string {
  const id = hit.id.trim();
  const base = (hit.title ?? hit.label ?? hit.id).trim() || id;
  if (base.toLowerCase() === id.toLowerCase()) return id;

  const dash = base.indexOf(" - ");
  if (dash >= 0) {
    const name = base.slice(0, dash);
    const location = base.slice(dash + 3);
    return `${roomHitLabelWithId(name, id)} - ${location}`;
  }

  const area = hit.areaLabel ?? (hit.area && hit.area !== "overworld" ? hit.area : null);
  const titled = roomHitLabelWithId(base, id);
  return area ? `${titled} - ${area}` : titled;
}

/** Finite hop count sorts first; unknown or unreachable rooms sort last. */
function walkDistanceRank(hit: RoomSearchHitBrief): number {
  return typeof hit.distance === "number" && Number.isFinite(hit.distance)
    ? hit.distance
    : Number.POSITIVE_INFINITY;
}

/** Re-rank API hits: nearer rooms first, then the same fuzzy scorer used for alias names. */
export function rankRoomHits(hits: RoomSearchHitBrief[], query: string, limit = 12): RoomSearchHitBrief[] {
  const trimmed = query.trim();
  if (!trimmed) return hits.slice(0, limit);
  if (isNumericRoomIdQuery(trimmed)) {
    const want = trimmed.toLowerCase();
    return hits
      .filter((h) => h.id.toLowerCase() === want)
      .sort((a, b) => walkDistanceRank(a) - walkDistanceRank(b))
      .slice(0, limit);
  }
  const ranked: { hit: RoomSearchHitBrief; score: number }[] = [];
  for (const hit of hits) {
    const label = roomHitLabel(hit);
    // NPC names are searchable room metadata: without them a `/to beggar` hit that matched only
    // the NPC was dropped whenever another hit's label happened to fuzzy-match.
    const fields = [label, hit.id, hit.area ?? "", hit.npcMatch ?? "", ...(hit.npcs ?? [])].filter(Boolean);
    let best = -1;
    for (const field of fields) {
      best = Math.max(best, fuzzyAliasScore(field, trimmed));
    }
    if (best < 0) continue;
    ranked.push({ hit, score: best });
  }
  ranked.sort(
    (a, b) =>
      walkDistanceRank(a.hit) - walkDistanceRank(b.hit) ||
      b.score - a.score ||
      roomHitLabel(a.hit).localeCompare(roomHitLabel(b.hit)),
  );
  if (ranked.length === 0) return hits.slice(0, limit);
  return ranked.slice(0, limit).map((r) => r.hit);
}

function distanceLabel(distance: number): string {
  if (distance === 0) return "here";
  return distance === 1 ? "1 step" : `${distance} steps`;
}

/** Max list height (px) for the space above the command field; null = leave the CSS default. */
export function roomAcMaxHeightPx(spaceAbovePx: number, margin = 12, floor = 132): number | null {
  if (!Number.isFinite(spaceAbovePx) || spaceAbovePx <= 0) return null;
  return Math.max(floor, Math.floor(spaceAbovePx - margin));
}

export type RoomAutocompleteHideOpts = {
  clearPending?: boolean;
  clearList?: boolean;
};

export type RoomAutocompleteController = {
  refresh: () => boolean;
  hide: (opts?: boolean | RoomAutocompleteHideOpts) => void;
  moveSelection: (delta: number) => boolean;
  acceptSelected: () => boolean;
  isOpen: () => boolean;
  /** Room id to speedwalk on submit, if any. */
  pendingWalkTargetId: () => string | null;
  clearPendingWalkTarget: () => void;
};

export function createRoomAutocomplete(opts: {
  listEl: HTMLElement;
  getLineText: () => string;
  applyHit: (hit: RoomSearchHitBrief) => void;
  search: (query: string) => Promise<RoomSearchHitBrief[]>;
  /** After a tap/click pick: push the editor line into the visible field (Tab/Enter do this themselves). */
  onPick?: () => void;
  debounceMs?: number;
}): RoomAutocompleteController {
  const { listEl, getLineText, applyHit, search } = opts;
  const debounceMs = opts.debounceMs ?? 180;

  let visible: RoomSearchHitBrief[] = [];
  let selected = 0;
  let pendingWalkId: string | null = null;
  let searchGen = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let loading = false;
  let showEmptyHint = false;
  let activeQuery = "";
  /** Line produced by accepting a hit; refresh stays closed until the text changes. */
  let acceptedLine: string | null = null;

  function normalizeHideOpts(opts?: boolean | RoomAutocompleteHideOpts): RoomAutocompleteHideOpts {
    if (typeof opts === "boolean") return { clearPending: opts, clearList: true };
    return { clearPending: opts?.clearPending ?? false, clearList: opts?.clearList ?? true };
  }

  function hide(opts?: boolean | RoomAutocompleteHideOpts) {
    const { clearPending, clearList } = normalizeHideOpts(opts);
    visible = [];
    selected = 0;
    showEmptyHint = false;
    activeQuery = "";
    if (clearPending) pendingWalkId = null;
    loading = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!clearList) return;
    listEl.hidden = true;
    listEl.replaceChildren();
    listEl.style.removeProperty("--ac-fit-max-height");
  }

  function appendMutedOption(text: string) {
    const li = document.createElement("li");
    li.className = "alias-ac-item alias-ac-item-muted";
    li.setAttribute("role", "option");
    li.textContent = text;
    listEl.appendChild(li);
  }

  function render() {
    renderItems();
    fitToVisibleSpace();
  }

  function renderItems() {
    listEl.replaceChildren();
    if (showEmptyHint && !loading && visible.length === 0) {
      listEl.hidden = false;
      appendMutedOption("Type a room name to search");
      return;
    }
    if (!loading && visible.length === 0) {
      listEl.hidden = true;
      return;
    }
    listEl.hidden = false;
    if (loading && visible.length === 0) {
      appendMutedOption("Searching rooms…");
      return;
    }
    let activeEl: HTMLElement | null = null;
    for (let i = 0; i < visible.length; i++) {
      const hit = visible[i]!;
      const li = document.createElement("li");
      li.className = "alias-ac-item";
      li.setAttribute("role", "option");
      li.dataset.id = hit.id;
      if (i === selected) {
        li.classList.add("alias-ac-item-active");
        li.setAttribute("aria-selected", "true");
        activeEl = li;
      } else {
        li.setAttribute("aria-selected", "false");
      }
      const name = document.createElement("span");
      name.className = "alias-ac-label";
      const label = roomHitLabel(hit);
      const npc = hit.npcMatch && !label.toLowerCase().includes(hit.npcMatch.toLowerCase()) ? hit.npcMatch : null;
      name.textContent = npc ? `${label} · ${npc}` : label;
      li.append(name);
      if (typeof hit.distance === "number") {
        const dist = document.createElement("span");
        dist.className = "alias-ac-distance";
        dist.textContent = distanceLabel(hit.distance);
        li.append(dist);
      } else if (hit.distance === null) {
        const dist = document.createElement("span");
        dist.className = "alias-ac-distance";
        dist.textContent = "no path";
        li.append(dist);
      }
      listEl.appendChild(li);
    }
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }

  /**
   * The list opens upward from the command field. On phones the keyboard and quick-action
   * bars leave little room, so cap the height to what is actually visible above the field.
   */
  function fitToVisibleSpace() {
    if (listEl.hidden) return;
    const anchor = listEl.parentElement;
    if (!anchor || typeof window === "undefined") return;
    const vvTop = window.visualViewport?.offsetTop ?? 0;
    const space = anchor.getBoundingClientRect().top - vvTop;
    const max = roomAcMaxHeightPx(space);
    if (max === null) listEl.style.removeProperty("--ac-fit-max-height");
    else listEl.style.setProperty("--ac-fit-max-height", `${max}px`);
  }

  function scheduleSearch(query: string) {
    if (query.trim() === activeQuery.trim() && (visible.length > 0 || loading)) {
      return;
    }
    activeQuery = query;
    const gen = ++searchGen;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void (async () => {
        loading = true;
        render();
        try {
          const hits = query.trim() ? await search(query) : [];
          if (gen !== searchGen) return;
          const next = rankRoomHits(hits, query);
          const same =
            next.length === visible.length &&
            next.every((h, i) => h.id === visible[i]?.id);
          visible = next;
          if (!same) selected = 0;
          else selected = Math.min(selected, Math.max(0, visible.length - 1));
          pendingWalkId = visible[selected]?.id ?? null;
        } catch {
          if (gen !== searchGen) return;
          visible = [];
          pendingWalkId = null;
        } finally {
          if (gen === searchGen) loading = false;
          render();
        }
      })();
    }, debounceMs);
  }

  function refresh(): boolean {
    const line = getLineText();
    if (acceptedLine !== null) {
      if (line === acceptedLine) {
        hide();
        return false;
      }
      acceptedLine = null;
    }
    const parsed = parseSlashToLine(line);
    if (!parsed) {
      hide({ clearPending: true });
      return false;
    }
    const query = parsed.query;
    if (!query.trim()) {
      showEmptyHint = true;
      visible = [];
      selected = 0;
      pendingWalkId = null;
      loading = false;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      searchGen += 1;
      render();
      return true;
    }
    showEmptyHint = false;
    scheduleSearch(query);
    render();
    return loading || visible.length > 0 || showEmptyHint;
  }

  function moveSelection(delta: number): boolean {
    if (visible.length === 0) return false;
    selected = (selected + delta + visible.length) % visible.length;
    pendingWalkId = visible[selected]?.id ?? null;
    render();
    return true;
  }

  function accept(hit: RoomSearchHitBrief) {
    pendingWalkId = hit.id;
    applyHit(hit);
    acceptedLine = getLineText();
    hide();
  }

  function acceptSelected(): boolean {
    const hit = visible[selected];
    if (!hit) return false;
    accept(hit);
    return true;
  }

  function hitFromEventTarget(target: EventTarget | null): RoomSearchHitBrief | null {
    const item =
      target && typeof (target as Element).closest === "function"
        ? (target as Element).closest(".alias-ac-item")
        : null;
    if (!item || item.classList.contains("alias-ac-item-muted")) return null;
    const id = item.getAttribute("data-id");
    if (!id) return null;
    return visible.find((h) => h.id === id) ?? null;
  }

  // Keep focus (and the phone keyboard) on the command field while tapping or clicking the list.
  // Selection happens on click, not mousedown: on touch screens a tap fires click, while a
  // finger drag to scroll the list does not, so scrolling never picks a room by accident.
  listEl.addEventListener("mousedown", (e) => {
    // Target is the list itself on its scrollbar; let that drag normally.
    if (e.target === listEl) return;
    e.preventDefault();
  });

  listEl.addEventListener("click", (e) => {
    const hit = hitFromEventTarget(e.target);
    if (!hit) return;
    e.preventDefault();
    accept(hit);
    opts.onPick?.();
  });

  return {
    refresh,
    hide,
    moveSelection,
    acceptSelected,
    isOpen: () => loading || visible.length > 0 || showEmptyHint,
    pendingWalkTargetId: () => pendingWalkId,
    clearPendingWalkTarget: () => {
      pendingWalkId = null;
    },
  };
}
