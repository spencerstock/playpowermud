/** Web UI side panel: live world map (planes/levels), room details, search, vitals. */

import { computeAreaOverlays, type AreaOverlay } from "../mapper/areaLayout.js";
import { areaMetaSlug, OVERWORLD_AREA } from "../mapper/areaInfer.js";
type RoomBrief = {
  id: string;
  title: string | null;
  exits: string[];
  unexplored: string[];
  area: string;
  areaLabel: string;
  tags: string[];
  pos: { plane: string; x: number; y: number; z: number };
  dark: boolean;
};

type ViewRoom = RoomBrief & {
  visits: number;
  danger: number | null;
  links: Record<string, { to: string | null; kind: string; hidden: boolean; confirmed: boolean; blocked: boolean }>;
};

type DescribedLink = {
  cmd: string;
  dir: string;
  to: string | null;
  toLabel: string | null;
  kind: string;
  hidden: boolean;
  confirmed: boolean;
  blocked: string | undefined;
  pre: string[] | undefined;
  note: string | undefined;
};

type DescribedRoom = {
  id: string;
  title: string | null;
  description: string | null;
  exits: string[];
  unexplored: string[];
  links: DescribedLink[];
  pos: RoomBrief["pos"];
  area: string | null;
  dark: boolean;
  danger: number | null;
  tags: string[];
  notes: string[];
  visits: number;
  npcs: string[];
};

type MapView = {
  center: RoomBrief;
  here: string | null;
  plane: { id: string; kind: string; label?: string | null; parent?: { via: string } | null } | null;
  z: number;
  levels: number[];
  rooms: ViewRoom[];
  areaOverlays?: AreaOverlay[];
};

type GameState = {
  phase: string;
  character: string | null;
  profile: string | null;
  vitals: { hp?: number; hpMax?: number; sp?: number; spMax?: number; pp?: number; ppMax?: number } | null;
  status: { exp?: number; guild?: string; home?: string; hpMax?: number; spMax?: number } | null;
  room: RoomBrief | null;
  inCombat: boolean;
};

/** In-process stand-in for the old hub's `/api/map/*` + `/api/state` routes (see client/mapApi.ts). */
export type WorldPanelApi = <T>(path: string, body?: unknown) => Promise<T>;

export type WorldPanelOptions = {
  mount: HTMLElement;
  api: WorldPanelApi;
};

const CELL = 30;
const BOX = 16;
/** Short dashed stubs for named/special/teleport exits (no compass direction). */
const ASIDE_STUB_DIRS: [number, number][] = [
  [-0.5, 0.5],
  [0.5, 0.5],
  [-0.5, -0.5],
  [0.5, -0.5],
  [0, 0.55],
  [-0.55, 0],
  [0.55, 0],
];

const DIRS: Record<string, [number, number]> = {
  n: [0, 1],
  s: [0, -1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, 1],
  nw: [-1, 1],
  se: [1, -1],
  sw: [-1, -1],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function appendAreaLabels(
  s: SVGSVGElement,
  overlays: AreaOverlay[],
  cx: (x: number) => number,
  cy: (y: number) => number,
): void {
  if (!overlays.length) return;
  const layer = svg("g", { class: "wa-layer" });
  layer.setAttribute("pointer-events", "none");
  for (const o of overlays) {
    const g = svg("g", {
      class: `wa-area${o.areaId === OVERWORLD_AREA ? " wa-area-overworld" : ""}`,
      "data-area": o.areaId,
    });
    const terms = o.terms?.length ? o.terms : [{ text: o.label, weight: 1 }];
    const primary = terms[0]!;
    const secondary = terms[1]?.text !== primary.text ? terms[1] : undefined;
    const lineCount = secondary ? 2 : 1;
    const lineH = o.fontSize * 1.12;
    const blockTop = cy(o.y) - ((lineCount - 1) * lineH) / 2;

    const tip = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tip.textContent = terms.map((t) => t.text).join(" · ");
    g.append(tip);

    const t = svg("text", {
      x: cx(o.x),
      y: blockTop,
      class: "wa-area-text",
      "text-anchor": "middle",
      "dominant-baseline": "hanging",
    });
    const px = cx(o.x);
    const addLine = (text: string, primaryLine: boolean, dy: string) => {
      const span = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      span.setAttribute("x", String(px));
      span.setAttribute("dy", dy);
      const fs = primaryLine ? o.fontSize : Math.round(o.fontSize * 0.75);
      span.setAttribute("font-size", String(fs));
      if (!primaryLine) span.setAttribute("class", "wa-area-term-secondary");
      span.textContent = text;
      t.append(span);
    };
    addLine(primary.text, true, "0");
    if (secondary) addLine(secondary.text, false, String(lineH));
    g.append(t);
    layer.append(g);
  }
  s.append(layer);
}

function pct(cur?: number, max?: number): number | null {
  return cur !== undefined && max ? Math.max(0, Math.min(100, (cur / max) * 100)) : null;
}

/** Split a comma/space-separated exit list into canonical tokens. */
export function parseExitTokens(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const LINK_KINDS = ["dir", "vertical", "named", "special", "teleport"] as const;

export function createWorldPanel(opts: WorldPanelOptions) {
  const root = opts.mount;
  root.classList.add("map-panel-root", "world-panel");
  root.innerHTML = "";

  const bar = el("div", { class: "map-panel-bar" });
  const summary = el("div", { class: "map-panel-summary" }, "World map");
  const vit = el("div", { class: "vitals" });
  const toggle = el(
    "button",
    { type: "button", class: "map-panel-toggle", title: "Expand or collapse map (Option+M)" },
    "Map ▾",
  );
  bar.append(summary, vit, toggle);

  const body = el("div", { class: "map-panel-body world-panel-body" });
  const mapCol = el("div", { class: "world-map-col" });
  const tools = el("div", { class: "world-map-tools" });
  const levelDown = el("button", { type: "button", title: "Level down" }, "▼");
  const levelLabel = el("span", { class: "world-level" }, "z 0");
  const levelUp = el("button", { type: "button", title: "Level up" }, "▲");
  const follow = el("button", { type: "button", class: "is-on", title: "Keep the map centered on you" }, "Follow");
  const planeLabel = el("span", { class: "world-plane" });
  tools.append(levelDown, levelLabel, levelUp, follow, planeLabel);
  const canvas = el("div", {
    class: "map-grid-wrap world-map-canvas",
    tabindex: "0",
    title: "Drag empty space to pan · click map, then arrow keys to move the highlight",
  });
  mapCol.append(tools, canvas);

  const sideRail = el("div", { class: "map-detail world-side-rail" });
  const roomInspect = el("div", { class: "world-room-inspect", hidden: "" });
  const roomInspectHead = el("div", { class: "world-room-inspect-head" });
  const roomInspectTitle = el("div", { class: "world-room-inspect-title" }, "Room");
  const roomInspectActions = el("div", { class: "world-room-inspect-actions" });
  const roomInspectRefresh = el("button", { type: "button", class: "bot-hud-btn", title: "Reload room from map" }, "↻");
  roomInspectActions.append(roomInspectRefresh);
  roomInspectHead.append(roomInspectTitle, roomInspectActions);
  const roomInspectMeta = el("div", { class: "world-room-inspect-meta" });
  const roomInspectDesc = el("div", { class: "world-room-inspect-desc" });
  const roomInspectExitsSection = el("section", { class: "world-room-inspect-section world-room-inspect-exits-section" });
  const roomInspectExitsHead = el("div", { class: "world-room-inspect-section-head" });
  const roomInspectExitsTitle = el("span", { class: "world-room-inspect-section-title" }, "Listed exits");
  const roomInspectExitsSave = el("button", { type: "button", class: "bot-hud-btn bot-hud-btn-ghost" }, "Save");
  roomInspectExitsHead.append(roomInspectExitsTitle, roomInspectExitsSave);
  const roomInspectExitsInput = el("input", {
    type: "text",
    class: "world-room-inspect-exits-input",
    spellcheck: "false",
    title: "Listed exits from the last look (comma-separated)",
    "aria-label": "Listed exits",
    placeholder: "n, s, e, w…",
  }) as HTMLInputElement;
  roomInspectExitsSection.append(roomInspectExitsHead, roomInspectExitsInput);
  const roomInspectSpecialsWrap = el("details", {
    class: "world-room-inspect-section world-room-inspect-specials-wrap",
  });
  const roomInspectSpecialsSum = el("summary", { class: "world-room-inspect-section-head world-room-inspect-specials-sum" });
  const roomInspectSpecialsTitle = el("span", { class: "world-room-inspect-section-title" }, "Special exits");
  roomInspectSpecialsSum.append(roomInspectSpecialsTitle);
  const roomInspectSpecials = el("div", { class: "world-room-inspect-specials" });
  roomInspectSpecialsWrap.append(roomInspectSpecialsSum, roomInspectSpecials);
  const roomInspectLinksSection = el("section", { class: "world-room-inspect-section world-room-inspect-links-section" });
  const roomInspectLinksHead = el("div", { class: "world-room-inspect-section-head" });
  const roomInspectLinksTitle = el("span", { class: "world-room-inspect-section-title" }, "Compass links");
  roomInspectLinksHead.append(roomInspectLinksTitle);
  const roomInspectLinks = el("div", { class: "world-room-inspect-links" });
  roomInspectLinksSection.append(roomInspectLinksHead, roomInspectLinks);
  const roomInspectAdd = el("details", { class: "world-room-inspect-add" });
  const roomInspectAddSum = el("summary", {}, "Add or edit link…");
  const roomInspectAddForm = el("div", { class: "world-room-inspect-add-form" });
  const linkFormCmd = el("input", {
    type: "text",
    class: "world-link-cmd",
    placeholder: "Command (n, pull lever…)",
    spellcheck: "false",
  }) as HTMLInputElement;
  const linkFormTo = el("input", {
    type: "text",
    class: "world-link-to",
    placeholder: "Destination room id or title",
    spellcheck: "false",
  }) as HTMLInputElement;
  const linkFormKind = el("select", { class: "world-link-kind" }) as HTMLSelectElement;
  for (const k of LINK_KINDS) linkFormKind.append(el("option", { value: k }, k));
  const linkFormPre = el("input", {
    type: "text",
    class: "world-link-pre",
    placeholder: "Pre commands (open door; unlock…)",
    spellcheck: "false",
  }) as HTMLInputElement;
  const linkFormNote = el("input", {
    type: "text",
    class: "world-link-note",
    placeholder: "Note",
    spellcheck: "false",
  }) as HTMLInputElement;
  const linkFormConfirmed = el("input", { type: "checkbox", class: "world-link-confirmed", id: "world-link-confirmed" }) as HTMLInputElement;
  linkFormConfirmed.checked = true;
  const linkFormHidden = el("input", { type: "checkbox", class: "world-link-hidden", id: "world-link-hidden" }) as HTMLInputElement;
  const linkFormSave = el("button", { type: "button", class: "bot-hud-btn" }, "Save link");
  roomInspectAddForm.append(
    linkFormCmd,
    linkFormTo,
    linkFormKind,
    linkFormPre,
    linkFormNote,
    el("label", { class: "world-link-flag", for: "world-link-confirmed" }, "Confirmed"),
    linkFormConfirmed,
    el("label", { class: "world-link-flag", for: "world-link-hidden" }, "Hidden"),
    linkFormHidden,
    linkFormSave,
  );
  roomInspectAdd.append(roomInspectAddSum, roomInspectAddForm);
  const roomInspectStatus = el("div", { class: "world-room-inspect-status" });
  roomInspect.append(
    roomInspectHead,
    roomInspectMeta,
    roomInspectDesc,
    roomInspectExitsSection,
    roomInspectSpecialsWrap,
    roomInspectLinksSection,
    roomInspectAdd,
    roomInspectStatus,
  );

  const roomSearchBox = el("div", { class: "world-room-search" });
  const roomSearchHead = el("div", { class: "world-room-search-head" });
  roomSearchHead.append(el("span", { class: "world-room-search-label" }, "Map search"));
  const roomSearchInput = el("input", {
    type: "search",
    class: "world-room-search-input",
    placeholder: "Room title, area, or NPC…",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Search mapped rooms",
  }) as HTMLInputElement;
  roomSearchHead.append(roomSearchInput);
  const roomSearchStatus = el("div", { class: "world-room-search-status" }, "Click a result to show it on the map");
  const roomSearchResults = el("div", {
    class: "world-room-search-results",
    hidden: "",
    role: "listbox",
    "aria-label": "Search results",
  });
  roomSearchBox.append(roomSearchHead, roomSearchStatus, roomSearchResults);
  sideRail.append(roomInspect, roomSearchBox);
  body.append(mapCol, sideRail);
  root.append(bar, body);

  const state = {
    view: null as MapView | null,
    game: null as GameState | null,
    selected: null as string | null,
    z: null as number | null,
    follow: true,
    centerRef: null as string | null,
    // Phones start collapsed so the log keeps the screen; the choice is remembered.
    expanded: (localStorage.getItem("playpowermud-world-expanded") ?? (window.innerWidth > 720 ? "1" : "0")) !== "0",
    refreshTimer: null as ReturnType<typeof setTimeout> | null,
    /** Grid cursor for keyboard navigation (same z as current map level). */
    navCell: null as { x: number; y: number } | null,
    mapKeyboard: false,
    inspectRoom: null as DescribedRoom | null,
    inspectHere: false,
    inspectLoading: false,
    inspectStatus: null as string | null,
  };

  const api = opts.api;

  const setExpanded = (on: boolean) => {
    state.expanded = on;
    body.hidden = !on;
    toggle.textContent = on ? "Map ▾" : "Map ▸";
    localStorage.setItem("playpowermud-world-expanded", on ? "1" : "0");
    document.body.classList.toggle("world-map-expanded", on);
    if (!on && state.mapKeyboard) {
      state.mapKeyboard = false;
      canvas.classList.remove("is-map-keyboard");
    }
    if (on) scheduleRefresh(0);
    requestAnimationFrame(() => window.dispatchEvent(new Event("playpowermud-layout")));
  };

  function renderVitals(): void {
    const g = state.game;
    vit.innerHTML = "";
    if (!g?.vitals) return;
    const v = g.vitals;
    const bars: [string, number | undefined, number | undefined][] = [
      ["HP", v.hp, v.hpMax ?? g.status?.hpMax],
      ["SP", v.sp, v.spMax ?? g.status?.spMax],
      ["PP", v.pp, v.ppMax],
    ];
    for (const [label, cur, max] of bars) {
      if (cur === undefined) continue;
      const p = pct(cur, max);
      const b = el("span", { class: `vbar vbar-${label.toLowerCase()}`, title: `${label} ${cur}${max ? `/${max}` : ""}` });
      const fill = el("span", { class: "vbar-fill" });
      fill.style.width = `${p ?? 100}%`;
      b.append(fill, el("span", { class: "vbar-text" }, `${label} ${cur}`));
      vit.append(b);
    }
  }

  function renderSummary(): void {
    const g = state.game;
    const room = g?.room?.title ?? (g?.phase === "in-game" ? "unknown room" : g?.phase ?? "…");
    const who = g?.character ? `${g.character}` : "";
    const extra = g?.status?.exp !== undefined ? ` · ${g.status.exp} exp` : "";
    summary.textContent = `${who ? `${who} · ` : ""}${room}${extra}${g?.inCombat ? " · ⚔ combat" : ""}`;
  }

  function roomAtPos(rooms: ViewRoom[], x: number, y: number): ViewRoom | undefined {
    return rooms.find((r) => r.pos.x === x && r.pos.y === y);
  }

  function navAnchor(v: MapView, rooms: ViewRoom[]): ViewRoom | null {
    if (state.navCell) {
      const hit = roomAtPos(rooms, state.navCell.x, state.navCell.y);
      if (hit) return hit;
    }
    if (state.selected) {
      const hit = rooms.find((r) => r.id === state.selected);
      if (hit) return hit;
    }
    if (v.here) {
      const hit = rooms.find((r) => r.id === v.here);
      if (hit) return hit;
    }
    return rooms[0] ?? null;
  }

  function syncNavCellFromRoom(r: ViewRoom): void {
    state.navCell = { x: r.pos.x, y: r.pos.y };
  }

  /** Pixel pan of the SVG inside the canvas (transform). Survives re-renders until follow/nav recenters. */
  let mapPanX = 0;
  let mapPanY = 0;
  let mapContentW = 0;
  let mapContentH = 0;

  function clampMapPan(): void {
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;
    const margin = 48;
    if (mapContentW <= 0 || mapContentH <= 0 || vw <= 0 || vh <= 0) return;
    const minX = margin - mapContentW;
    const maxX = vw - margin;
    const minY = margin - mapContentH;
    const maxY = vh - margin;
    mapPanX = Math.min(maxX, Math.max(minX, mapPanX));
    mapPanY = Math.min(maxY, Math.max(minY, mapPanY));
  }

  function applyMapPan(): void {
    const s = canvas.querySelector("svg.world-svg") as SVGSVGElement | null;
    if (!s) return;
    clampMapPan();
    s.style.transform = `translate(${mapPanX}px, ${mapPanY}px)`;
  }

  function centerMapOn(cx: (x: number) => number, cy: (y: number) => number, x: number, y: number): void {
    mapPanX = canvas.clientWidth / 2 - cx(x);
    mapPanY = canvas.clientHeight / 2 - cy(y);
    applyMapPan();
  }

  function scrollNavIntoView(cx: (x: number) => number, cy: (y: number) => number, x: number, y: number): void {
    centerMapOn(cx, cy, x, y);
  }

  const ARROW_DIR: Record<string, string> = {
    ArrowUp: "n",
    ArrowDown: "s",
    ArrowLeft: "w",
    ArrowRight: "e",
  };

  function geoCompass(from: { x: number; y: number }, to: { x: number; y: number }): string | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    for (const [cmd, d] of Object.entries(DIRS)) {
      if (d[0] === dx && d[1] === dy) return cmd;
    }
    return null;
  }

  function isAsideLink(kind: string): boolean {
    return kind === "special" || kind === "named" || kind === "teleport";
  }

  function metaChip(label: string, extraClass = "", title?: string): HTMLElement {
    const attrs: Record<string, string> = { class: `world-meta-chip${extraClass ? ` ${extraClass}` : ""}` };
    if (title) attrs.title = title;
    return el("span", attrs, label);
  }

  function renderInspectMeta(r: DescribedRoom | null, id: string): void {
    roomInspectMeta.replaceChildren();
    if (!r || r.id !== id) {
      roomInspectMeta.append(metaChip(id, "world-meta-chip-id"));
      if (state.inspectLoading) roomInspectMeta.append(metaChip("…", "", "Loading room details"));
      return;
    }
    const pos = r.pos;
    roomInspectMeta.append(metaChip(r.id, "world-meta-chip-id", "Room id"));
    if (state.inspectHere) roomInspectMeta.append(metaChip("here", "world-meta-chip-here", "Your current room"));
    if (r.area) roomInspectMeta.append(metaChip(r.area, "world-meta-chip-area", "Area"));
    roomInspectMeta.append(
      metaChip(`plane ${pos.plane}`, "", "Map plane"),
      metaChip(`z ${pos.z}`, "", "Vertical level"),
      metaChip(`(${pos.x}, ${pos.y})`, "", "Grid position"),
    );
    if (r.visits) roomInspectMeta.append(metaChip(`${r.visits} visits`, "", "Times visited"));
    if (r.danger != null) roomInspectMeta.append(metaChip(`danger ${r.danger}`, "world-meta-chip-warn", "Danger rating"));
    for (const tag of r.tags ?? []) {
      roomInspectMeta.append(metaChip(tag, "world-meta-chip-tag", "Room tag"));
    }
    for (const npc of (r.npcs ?? []).slice(0, 6)) {
      roomInspectMeta.append(metaChip(npc, "world-meta-chip-npc", "NPC seen here"));
    }
  }

  function linkKindVisible(kind: string): boolean {
    return kind !== "dir" && kind !== "compass";
  }

  /** Follow mode recenters the map on you and keeps inspect on your room — turn it off when picking another room. */
  function stopFollowForRoomInspect(id: string): void {
    const here = state.view?.here;
    if (!here || id === here) return;
    state.follow = false;
    follow.classList.remove("is-on");
    state.centerRef = id;
  }

  function isEnterKey(e: KeyboardEvent): boolean {
    return e.key === "Enter" || e.key === "NumpadEnter";
  }

  function roomsOnLevel(): ViewRoom[] {
    const v = state.view;
    if (!v) return [];
    const z = state.z ?? v.z;
    return v.rooms.filter((r) => r.pos.z === z);
  }

  function mapNavActive(): boolean {
    if (!state.expanded || !state.view || !state.mapKeyboard) return false;
    const ae = document.activeElement;
    if (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae instanceof HTMLSelectElement) {
      return false;
    }
    return ae === canvas || (ae instanceof Node && root.contains(ae));
  }

  function onMapKeyDown(e: KeyboardEvent): void {
    if (!mapNavActive()) return;
    const dir = ARROW_DIR[e.key];
    if (dir) {
      e.preventDefault();
      e.stopPropagation();
      moveMapNav(dir);
      return;
    }
  }

  function renderMap(): void {
    const v = state.view;
    canvas.classList.toggle("is-map-keyboard", state.mapKeyboard);
    canvas.innerHTML = "";
    if (!v) {
      canvas.append(el("div", { class: "map-detail-meta" }, "No map position yet — move or `look`."));
      return;
    }
    const z = state.z ?? v.z;
    levelLabel.textContent = `z ${z}`;
    const planeName = v.plane?.label ?? v.plane?.id ?? "";
    planeLabel.textContent = v.plane?.kind === "aside" ? `aside plane ${planeName}${v.plane.parent ? ` (via ${v.plane.parent.via})` : ""}` : `plane ${planeName}`;
    const rooms = v.rooms.filter((r) => r.pos.z === z);
    if (!rooms.length) {
      canvas.append(el("div", { class: "map-detail-meta" }, `Nothing mapped on level ${z}.`));
      return;
    }
    const xs = rooms.map((r) => r.pos.x);
    const ys = rooms.map((r) => r.pos.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const W = (maxX - minX + 1) * CELL + CELL;
    const H = (maxY - minY + 1) * CELL + CELL;
    const s = svg("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "world-svg", role: "img", "aria-label": "World map" }) as SVGSVGElement;
    const cx = (x: number) => (x - minX) * CELL + CELL;
    const cy = (y: number) => (maxY - y) * CELL + CELL;
    const byId = new Map(rooms.map((r) => [r.id, r]));
    for (const r of rooms) {
      const links = r.links ?? {};
      let asideStub = 0;
      for (const [cmd, link] of Object.entries(links)) {
        const d = DIRS[cmd];
        const x1 = cx(r.pos.x);
        const y1 = cy(r.pos.y);
        if (!d) {
          if (!isAsideLink(link.kind)) continue;
          const stub = ASIDE_STUB_DIRS[asideStub++ % ASIDE_STUB_DIRS.length]!;
          s.append(
            svg("line", {
              x1,
              y1,
              x2: x1 + stub[0] * CELL * 0.42,
              y2: y1 - stub[1] * CELL * 0.42,
              class: `wl wl-aside${link.confirmed ? "" : " wl-inferred"}`,
            }),
          );
          continue;
        }
        const target = link.to ? byId.get(link.to) : undefined;
        if (target && target.pos.x === r.pos.x + d[0] && target.pos.y === r.pos.y + d[1]) {
          s.append(svg("line", { x1, y1, x2: cx(target.pos.x), y2: cy(target.pos.y), class: `wl${link.confirmed ? "" : " wl-inferred"}` }));
        } else {
          // Non-euclidean or off-view link: short stub.
          s.append(svg("line", { x1, y1, x2: x1 + d[0] * CELL * 0.45, y2: y1 - d[1] * CELL * 0.45, class: "wl wl-stub" }));
        }
      }
      for (const ex of r.unexplored ?? []) {
        const d = DIRS[ex];
        if (!d) continue;
        const x1 = cx(r.pos.x);
        const y1 = cy(r.pos.y);
        s.append(svg("line", { x1, y1, x2: x1 + d[0] * CELL * 0.4, y2: y1 - d[1] * CELL * 0.4, class: "wl wl-unexplored" }));
      }
    }
    if (state.mapKeyboard && state.navCell) {
      const nx = state.navCell.x;
      const ny = state.navCell.y;
      s.append(
        svg("rect", {
          x: cx(nx) - BOX / 2 - 2,
          y: cy(ny) - BOX / 2 - 2,
          width: BOX + 4,
          height: BOX + 4,
          rx: 4,
          class: "wr-nav-box",
          pointerEvents: "none",
        }),
      );
    }
    for (const r of rooms) {
      const links = r.links ?? {};
      const g = svg("g", { class: "wr", "data-id": r.id });
      const cls = ["wr-box"];
      if (r.id === v.here) cls.push("wr-here");
      if (r.id === state.selected) cls.push("wr-selected");
      if (r.dark) cls.push("wr-dark");
      if ((r.danger ?? 0) >= 3) cls.push("wr-danger");
      if ((r.tags ?? []).length) cls.push("wr-tagged");
      g.append(svg("rect", { x: cx(r.pos.x) - BOX / 2, y: cy(r.pos.y) - BOX / 2, width: BOX, height: BOX, rx: 3, class: cls.join(" ") }));
      const aside = Object.values(links).some((l) => l.kind === "named" || l.kind === "special");
      if (aside) g.append(svg("circle", { cx: cx(r.pos.x) + BOX / 2, cy: cy(r.pos.y) - BOX / 2, r: 3, class: "wr-aside" }));
      const exits = r.exits ?? [];
      if (links.u || exits.includes("u")) g.append(svg("path", { d: `M${cx(r.pos.x) - 3} ${cy(r.pos.y) - 2} l3 -4 l3 4z`, class: "wr-updown" }));
      if (links.d || exits.includes("d")) g.append(svg("path", { d: `M${cx(r.pos.x) - 3} ${cy(r.pos.y) + 2} l3 4 l3 -4z`, class: "wr-updown" }));
      const t = svg("title", {});
      const tags = r.tags ?? [];
      const asideCmds = Object.entries(links)
        .filter(([, l]) => isAsideLink(l.kind))
        .map(([cmd]) => cmd);
      t.textContent = [
        `${r.title ?? "(unnamed)"} [${r.id}]${tags.length ? ` #${tags.join(" #")}` : ""}`,
        asideCmds.length ? `Aside: ${asideCmds.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      g.append(t);
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        focusMapKeyboard();
        syncNavCellFromRoom(r);
        stopFollowForRoomInspect(r.id);
        void select(r.id);
      });
      s.append(g);
    }
    const overlays =
      state.view?.areaOverlays ??
      computeAreaOverlays(
        rooms.map((r) => ({ area: r.area, areaLabel: r.areaLabel, pos: { x: r.pos.x, y: r.pos.y } })),
      );
    appendAreaLabels(s, overlays, cx, cy);
    s.addEventListener("click", () => focusMapKeyboard());
    canvas.append(s);
    mapContentW = W;
    mapContentH = H;
    const here = v.here ? byId.get(v.here) : undefined;
    if (state.navCell && state.mapKeyboard) {
      scrollNavIntoView(cx, cy, state.navCell.x, state.navCell.y);
    } else if (here && state.follow) {
      centerMapOn(cx, cy, here.pos.x, here.pos.y);
    } else {
      applyMapPan();
    }
  }

  function focusMapKeyboard(): void {
    state.mapKeyboard = true;
    canvas.focus({ preventScroll: true });
    canvas.classList.add("is-map-keyboard");
  }

  function moveMapNav(dirCmd: string): void {
    const v = state.view;
    if (!v) return;
    const z = state.z ?? v.z;
    const rooms = v.rooms.filter((r) => r.pos.z === z);
    if (!rooms.length) return;
    const anchor = navAnchor(v, rooms);
    if (!anchor) return;
    const d = DIRS[dirCmd];
    if (!d) return;
    const from = state.navCell ?? { x: anchor.pos.x, y: anchor.pos.y };
    state.navCell = { x: from.x + d[0], y: from.y + d[1] };
    const hit = roomAtPos(rooms, state.navCell.x, state.navCell.y);
    if (hit) {
      stopFollowForRoomInspect(hit.id);
      void select(hit.id);
    } else renderMap();
  }

  type RoomSearchHit = RoomBrief & {
    score: number;
    label: string;
    description: string | null;
    npcs: string[];
    npcMatch: string | null;
  };

  let roomSearchTimer: ReturnType<typeof setTimeout> | null = null;
  let roomSearchHits: RoomSearchHit[] = [];
  let roomSearchSelected: string | null = null;

  const SEARCH_IDLE = "↑↓ select · Esc clear";

  function setSideStatus(text: string | null): void {
    roomSearchStatus.textContent = text ?? SEARCH_IDLE;
    roomSearchStatus.classList.toggle("is-error", Boolean(text && /error|fail/i.test(text)));
  }

  function setInspectStatus(text: string | null, isError = false): void {
    state.inspectStatus = text;
    roomInspectStatus.textContent = text ?? "";
    roomInspectStatus.hidden = !text;
    roomInspectStatus.classList.toggle("is-error", isError);
  }

  function fillLinkForm(link?: DescribedLink): void {
    linkFormCmd.value = link?.cmd ?? "";
    linkFormTo.value = link?.to ?? "";
    linkFormKind.value = link?.kind ?? "special";
    linkFormPre.value = link?.pre?.join("; ") ?? "";
    linkFormNote.value = link?.note ?? "";
    linkFormConfirmed.checked = link?.confirmed ?? true;
    linkFormHidden.checked = link?.hidden ?? false;
    roomInspectAdd.open = true;
    linkFormCmd.focus({ preventScroll: true });
  }

  /** Show mapped links from the current map view while full room details load. */
  function seedInspectFromView(id: string): void {
    const hit = state.view?.rooms.find((r) => r.id === id);
    if (!hit) return;
    const links = Object.entries(hit.links ?? {}).map(([cmd, l]) => ({
      cmd,
      dir: cmd,
      to: l.to,
      toLabel: l.to,
      kind: l.kind,
      hidden: l.hidden,
      confirmed: l.confirmed,
      blocked: undefined,
      pre: undefined,
      note: undefined,
    }));
    state.inspectRoom = {
      id: hit.id,
      title: hit.title,
      description: null,
      exits: hit.exits ?? [],
      unexplored: hit.unexplored ?? [],
      links,
      pos: hit.pos,
      area: hit.area,
      dark: hit.dark,
      danger: hit.danger,
      tags: hit.tags ?? [],
      notes: [],
      visits: hit.visits,
      npcs: [],
    };
  }

  async function persistRoomLink(
    from: string,
    cmd: string,
    opts: {
      prevCmd?: string | null;
      to?: string | null;
      kind?: string;
      hidden?: boolean;
      confirmed?: boolean;
      pre?: string[] | null;
      note?: string | null;
      remove?: boolean;
    },
  ): Promise<DescribedRoom> {
    const prevCmd = opts.prevCmd?.trim().toLowerCase();
    if (opts.remove) {
      const drop = (prevCmd ?? cmd).trim().toLowerCase();
      await api<{ room: DescribedRoom }>("/api/map/link", { from, cmd: drop, remove: true });
      const r = await api<{ room: DescribedRoom }>(`/api/map/room?ref=${encodeURIComponent(from)}`);
      return r.room;
    }
    if (prevCmd && prevCmd !== cmd) {
      await api<{ room: DescribedRoom }>("/api/map/link", { from, cmd: prevCmd, remove: true });
    }
    const body: Record<string, unknown> = {
      from,
      cmd,
      kind: opts.kind ?? "special",
      confirmed: opts.confirmed ?? true,
      hidden: opts.hidden ?? true,
      to: opts.to ?? null,
    };
    if (opts.pre !== undefined) body.pre = opts.pre;
    if (opts.note !== undefined) body.note = opts.note;
    const r = await api<{ room: DescribedRoom }>("/api/map/link", body);
    return r.room;
  }

  function makeSpecialExitRow(roomId: string, link: DescribedLink | null): HTMLElement {
    const prevCmd = link?.cmd ?? null;
    const row = el("div", { class: "world-special-exit-row" });
    const rowMain = el("div", { class: "world-special-exit-row-main" });
    const rowFoot = el("div", { class: "world-special-exit-row-foot" });
    const cmdInput = el("input", {
      type: "text",
      class: "world-special-cmd",
      placeholder: "Command (homeland…)",
      spellcheck: "false",
      value: link?.cmd ?? "",
      "aria-label": "Special exit command",
    }) as HTMLInputElement;
    const toInput = el("input", {
      type: "text",
      class: "world-special-to",
      placeholder: "Dest (r28 or title)",
      spellcheck: "false",
      value: link?.to ?? "",
      "aria-label": "Special exit destination",
    }) as HTMLInputElement;
    const kindSelect = el("select", { class: "world-special-kind", "aria-label": "Link kind" }) as HTMLSelectElement;
    for (const k of ["special", "named", "teleport"] as const) {
      kindSelect.append(el("option", { value: k }, k));
    }
    kindSelect.value = link?.kind && isAsideLink(link.kind) ? link.kind : "special";
    const secretLabel = el("label", { class: "world-special-secret" });
    const secretChk = el("input", { type: "checkbox", class: "world-special-hidden" }) as HTMLInputElement;
    secretChk.checked = link?.hidden ?? true;
    secretLabel.append(secretChk, document.createTextNode(" secret"));
    const saveBtn = el("button", { type: "button", class: "bot-hud-btn bot-hud-btn-ghost" }, "Save");
    const moreBtn = el("button", {
      type: "button",
      class: "bot-hud-btn bot-hud-btn-ghost",
      title: "Pre commands, note, confirmed…",
    }, "More…");
    if (link) moreBtn.addEventListener("click", () => fillLinkForm(link));
    else moreBtn.disabled = true;
    const jumpBtn = el("button", {
      type: "button",
      class: "bot-hud-btn bot-hud-btn-ghost world-link-icon-btn world-special-jump",
      title: "Show destination on map",
    }, "→");
    const syncJumpBtn = (): void => {
      jumpBtn.disabled = !toInput.value.trim();
    };
    syncJumpBtn();
    toInput.addEventListener("input", syncJumpBtn);
    jumpBtn.addEventListener("click", () => {
      void focusMapOnRoom(toInput.value);
    });

    const delBtn = el("button", { type: "button", class: "bot-hud-btn world-link-del", title: "Remove link" }, "×");
    if (!prevCmd) delBtn.hidden = true;

    saveBtn.addEventListener("click", () => {
      void (async () => {
        const cmd = cmdInput.value.trim().toLowerCase();
        if (!cmd) {
          setInspectStatus("Special exit command required.", true);
          return;
        }
        try {
          const updated = await persistRoomLink(roomId, cmd, {
            prevCmd,
            to: toInput.value.trim() || null,
            kind: kindSelect.value,
            hidden: secretChk.checked,
            confirmed: link?.confirmed ?? true,
            pre: link?.pre?.length ? link.pre : undefined,
            note: link?.note ?? undefined,
          });
          if (state.selected === roomId) state.inspectRoom = updated;
          setInspectStatus(`Special exit saved: ${cmd}`);
          scheduleRefresh(100);
          renderRoomInspect();
        } catch (err) {
          setInspectStatus(String(err instanceof Error ? err.message : err), true);
        }
      })();
    });

    delBtn.addEventListener("click", () => {
      if (!prevCmd) return;
      void (async () => {
        if (!confirm(`Remove special exit "${prevCmd}" from ${roomId}?`)) return;
        try {
          const updated = await persistRoomLink(roomId, prevCmd, { prevCmd, remove: true });
          if (state.selected === roomId) state.inspectRoom = updated;
          setInspectStatus(`Removed ${prevCmd}`);
          scheduleRefresh(100);
          renderRoomInspect();
        } catch (err) {
          setInspectStatus(String(err instanceof Error ? err.message : err), true);
        }
      })();
    });

    rowMain.append(cmdInput, toInput, jumpBtn, delBtn);
    rowFoot.append(kindSelect, secretLabel, saveBtn, moreBtn);
    row.append(rowMain, rowFoot);
    return row;
  }

  function renderSpecialExitEditors(r: DescribedRoom): void {
    roomInspectSpecials.replaceChildren();
    const specialLinks = [...(r.links ?? [])].filter((l) => isAsideLink(l.kind)).sort((a, b) => a.cmd.localeCompare(b.cmd));
    roomInspectSpecialsTitle.textContent = specialLinks.length ? `Special exits · ${specialLinks.length}` : "Special exits";
    roomInspectSpecialsWrap.open = specialLinks.length > 0;
    for (const link of specialLinks) {
      roomInspectSpecials.append(makeSpecialExitRow(r.id, link));
    }
    const addBtn = el("button", { type: "button", class: "bot-hud-btn bot-hud-btn-ghost world-special-add" }, "+ Add");
    addBtn.addEventListener("click", () => {
      roomInspectSpecialsWrap.open = true;
      const draft = makeSpecialExitRow(r.id, null);
      roomInspectSpecials.insertBefore(draft, addBtn);
      draft.querySelector<HTMLInputElement>(".world-special-cmd")?.focus({ preventScroll: true });
    });
    roomInspectSpecials.append(addBtn);
  }

  function renderRoomInspect(): void {
    const r = state.inspectRoom;
    const id = state.selected;
    if (!id) {
      roomInspect.hidden = true;
      return;
    }
    roomInspect.hidden = false;
    if (state.inspectLoading && !r) {
      roomInspectTitle.textContent = "Loading…";
      renderInspectMeta(null, id);
      roomInspectDesc.textContent = "";
      roomInspectSpecials.replaceChildren();
      roomInspectLinks.replaceChildren();
      return;
    }
    if (!r || r.id !== id) {
      roomInspectTitle.textContent = id;
      renderInspectMeta(null, id);
      if (!state.inspectLoading) {
        roomInspectMeta.append(metaChip("Could not load", "world-meta-chip-warn"));
      }
      return;
    }
    roomInspectTitle.textContent = r.title ?? "(unnamed)";
    renderInspectMeta(r, id);
    roomInspectDesc.textContent = r.description ?? "";
    roomInspectDesc.hidden = !r.description;
    roomInspectExitsInput.value = (r.exits ?? []).join(", ");
    renderSpecialExitEditors(r);
    roomInspectLinks.replaceChildren();
    const sorted = [...(r.links ?? [])]
      .filter((l) => !isAsideLink(l.kind))
      .sort((a, b) => a.cmd.localeCompare(b.cmd));
    const unexplored = (r.unexplored ?? []).filter((ex) => !sorted.some((l) => l.cmd === ex));
    const linkCount = sorted.length + unexplored.length;
    roomInspectLinksTitle.textContent = linkCount ? `Compass links · ${linkCount}` : "Compass links";
    for (const link of sorted) {
      const row = el("div", { class: "world-link-row" });
      row.append(el("code", { class: "world-link-dir", title: link.kind }, link.cmd));
      const main = el("div", { class: "world-link-main" });
      const dest = link.toLabel ?? link.to;
      main.append(
        el("span", { class: "world-link-dest" }, link.to ? dest ?? link.to : "Destination unknown"),
      );
      const badges = el("span", { class: "world-link-badges" });
      if (linkKindVisible(link.kind)) badges.append(el("span", { class: "world-link-kind-label" }, link.kind));
      if (link.hidden) badges.append(el("span", { class: "world-link-badge" }, "secret"));
      if (!link.confirmed) badges.append(el("span", { class: "world-link-badge world-link-badge-warn" }, "inferred"));
      if (link.blocked) badges.append(el("span", { class: "world-link-badge world-link-badge-warn" }, "blocked"));
      if (badges.childElementCount) main.append(badges);
      row.append(main);
      const actions = el("div", { class: "world-link-row-actions" });
      const editBtn = el("button", {
        type: "button",
        class: "bot-hud-btn bot-hud-btn-ghost world-link-icon-btn",
        title: "Edit link",
      }, "✎");
      editBtn.addEventListener("click", () => fillLinkForm(link));
      const delBtn = el("button", {
        type: "button",
        class: "bot-hud-btn bot-hud-btn-ghost world-link-icon-btn world-link-del",
        title: "Remove link",
      }, "×");
      delBtn.addEventListener("click", () => void removeRoomLink(r.id, link.cmd));
      actions.append(editBtn, delBtn);
      row.append(actions);
      if (link.pre?.length || link.note) {
        const extra = el("div", { class: "world-link-row-extra" });
        if (link.pre?.length) extra.append(el("span", {}, `pre: ${link.pre.join("; ")}`));
        if (link.note) extra.append(el("span", {}, link.note));
        row.append(extra);
      }
      roomInspectLinks.append(row);
    }
    for (const ex of unexplored) {
      const row = el("div", { class: "world-link-row world-link-row-unexplored" });
      row.append(el("code", { class: "world-link-dir" }, ex));
      const main = el("div", { class: "world-link-main" });
      main.append(el("span", { class: "world-link-dest world-link-dest-muted" }, "Not mapped yet"));
      row.append(main);
      const addBtn = el("button", {
        type: "button",
        class: "bot-hud-btn bot-hud-btn-ghost",
        title: "Map this exit",
      }, "Map");
      addBtn.addEventListener("click", () =>
        fillLinkForm({
          cmd: ex,
          dir: ex,
          to: null,
          toLabel: null,
          kind: "named",
          hidden: false,
          confirmed: false,
          blocked: undefined,
          pre: undefined,
          note: undefined,
        }),
      );
      row.append(addBtn);
      roomInspectLinks.append(row);
    }
    if (!linkCount) {
      roomInspectLinks.append(el("div", { class: "world-room-inspect-empty" }, "No compass links yet — walk or map exits from the game."));
    }
  }

  async function loadRoomInspect(id: string): Promise<void> {
    seedInspectFromView(id);
    state.inspectLoading = true;
    setInspectStatus(null);
    renderRoomInspect();
    try {
      const r = await api<{ room: DescribedRoom; here: boolean }>(`/api/map/room?ref=${encodeURIComponent(id)}`);
      if (state.selected !== id) return;
      state.inspectRoom = r.room;
      state.inspectHere = r.here;
    } catch (err) {
      if (state.selected !== id) return;
      state.inspectRoom = null;
      setInspectStatus(String(err instanceof Error ? err.message : err), true);
    } finally {
      state.inspectLoading = false;
      renderRoomInspect();
    }
  }

  async function saveRoomExits(): Promise<void> {
    const id = state.selected;
    if (!id) return;
    const exits = parseExitTokens(roomInspectExitsInput.value);
    try {
      const r = await api<{ room: DescribedRoom }>("/api/map/annotate", { room: id, exits });
      state.inspectRoom = r.room;
      setInspectStatus("Exits saved.");
      scheduleRefresh(100);
      renderRoomInspect();
    } catch (err) {
      setInspectStatus(String(err instanceof Error ? err.message : err), true);
    }
  }

  async function saveRoomLink(): Promise<void> {
    const from = state.selected;
    const cmd = linkFormCmd.value.trim().toLowerCase();
    if (!from || !cmd) {
      setInspectStatus("Command required.", true);
      return;
    }
    const toRaw = linkFormTo.value.trim();
    const preRaw = linkFormPre.value.trim();
    try {
      const room = await persistRoomLink(from, cmd, {
        to: toRaw || null,
        kind: linkFormKind.value,
        confirmed: linkFormConfirmed.checked,
        hidden: linkFormHidden.checked,
        note: linkFormNote.value.trim() || null,
        pre: preRaw ? preRaw.split(/[;|]+/).map((s) => s.trim()).filter(Boolean) : null,
      });
      state.inspectRoom = room;
      setInspectStatus(`Link saved: ${cmd}`);
      scheduleRefresh(100);
      renderRoomInspect();
    } catch (err) {
      setInspectStatus(String(err instanceof Error ? err.message : err), true);
    }
  }

  async function removeRoomLink(from: string, cmd: string): Promise<void> {
    if (!confirm(`Remove link "${cmd}" from ${from}?`)) return;
    try {
      const r = await api<{ room: DescribedRoom }>("/api/map/link", { from, cmd, remove: true });
      if (state.selected === from) state.inspectRoom = r.room;
      setInspectStatus(`Removed ${cmd}`);
      scheduleRefresh(100);
      renderRoomInspect();
    } catch (err) {
      setInspectStatus(String(err instanceof Error ? err.message : err), true);
    }
  }

  function renderRoomSearchResults(): void {
    roomSearchResults.innerHTML = "";
    if (!roomSearchHits.length) {
      roomSearchResults.hidden = true;
      return;
    }
    roomSearchResults.hidden = false;
    for (const hit of roomSearchHits) {
      const npcs = hit.npcs ?? [];
      const row = el("button", {
        type: "button",
        class: `world-room-search-hit${roomSearchSelected === hit.id ? " is-selected" : ""}`,
        "data-id": hit.id,
        role: "option",
        "aria-selected": roomSearchSelected === hit.id ? "true" : "false",
      });
      const head = el("div", { class: "world-room-search-hit-head" });
      head.append(
        el("span", { class: "world-room-search-hit-title" }, hit.title ?? hit.label),
        el("span", { class: "world-room-search-hit-id" }, hit.id),
      );
      row.append(head);
      const npcLabel =
        hit.npcMatch ??
        (npcs.length ? npcs.slice(0, 4).join(", ") + (npcs.length > 4 ? "…" : "") : "");
      const areaSlug = areaMetaSlug(hit.area, hit.areaLabel);
      const meta = [
        hit.npcMatch ? `NPC ${hit.npcMatch}` : npcLabel ? `NPCs ${npcLabel}` : "",
        areaSlug,
        (hit.tags ?? []).length ? `#${(hit.tags ?? []).join(" #")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (meta) row.append(el("div", { class: "world-room-search-hit-meta" }, meta));
      if (hit.description) row.append(el("div", { class: "world-room-search-hit-desc" }, hit.description));
      row.addEventListener("click", () => {
        roomSearchSelected = hit.id;
        renderRoomSearchResults();
        void focusRoom(hit);
      });
      roomSearchResults.append(row);
    }
  }

  async function runRoomSearch(q: string): Promise<void> {
    const query = q.trim();
    if (!query) {
      roomSearchHits = [];
      roomSearchSelected = null;
      setSideStatus(null);
      renderRoomSearchResults();
      return;
    }
    try {
      const r = await api<{ hits: RoomSearchHit[] }>(`/api/map/search?q=${encodeURIComponent(query)}&limit=40`);
      roomSearchHits = r.hits;
      roomSearchSelected = null;
      setSideStatus(
        roomSearchHits.length
          ? `${roomSearchHits.length} match${roomSearchHits.length === 1 ? "" : "es"} · ↑↓ select`
          : "No rooms or NPC sightings match",
      );
      renderRoomSearchResults();
    } catch (err) {
      roomSearchHits = [];
      renderRoomSearchResults();
      setSideStatus(String(err instanceof Error ? err.message : err));
    }
  }

  async function focusRoom(hit: RoomSearchHit): Promise<void> {
    state.follow = false;
    follow.classList.remove("is-on");
    state.centerRef = hit.id;
    state.z = hit.pos.z;
    state.selected = hit.id;
    await refresh();
    select(hit.id);
  }

  function select(id: string): void {
    state.selected = id;
    seedInspectFromView(id);
    const v = state.view;
    if (v) {
      const z = state.z ?? v.z;
      const hit = v.rooms.find((r) => r.id === id);
      if (hit && hit.pos.z === z) syncNavCellFromRoom(hit);
      else if (hit) {
        state.z = hit.pos.z;
        state.follow = false;
        follow.classList.remove("is-on");
        state.centerRef = hit.id;
        syncNavCellFromRoom(hit);
        void refresh();
      }
    }
    renderMap();
    void loadRoomInspect(id);
  }

  async function focusMapOnRoom(ref: string): Promise<void> {
    const trimmed = ref.trim();
    if (!trimmed) {
      setInspectStatus("Set a destination room first.", true);
      return;
    }
    const inView = state.view?.rooms.find((r) => r.id === trimmed);
    if (inView) {
      focusMapKeyboard();
      stopFollowForRoomInspect(inView.id);
      select(inView.id);
      return;
    }
    try {
      const r = await api<{ room: DescribedRoom }>(`/api/map/room?ref=${encodeURIComponent(trimmed)}`);
      const room = r.room;
      state.follow = false;
      follow.classList.remove("is-on");
      state.centerRef = room.id;
      state.z = room.pos.z;
      state.selected = room.id;
      await refresh();
      focusMapKeyboard();
      select(room.id);
    } catch (err) {
      setInspectStatus(String(err instanceof Error ? err.message : err), true);
    }
  }

  async function refresh(): Promise<void> {
    if (!state.expanded) return;
    const params = new URLSearchParams({ radius: "9" });
    const ref = state.follow ? null : state.centerRef;
    if (ref) params.set("ref", ref);
    if (state.z !== null && !state.follow) params.set("z", String(state.z));
    try {
      state.view = await api<MapView>(`/api/map/view?${params}`);
      if (state.follow) state.z = state.view.z;
    } catch {
      state.view = null;
    }
    renderMap();
    // With Follow on, room details track your position (map click turns Follow off).
    const here = state.view?.here;
    if (here && state.follow && state.selected !== here) select(here);
    else if (here && !state.selected) select(here);
  }

  function scheduleRefresh(ms = 150): void {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      void refresh();
    }, ms);
  }

  roomInspectRefresh.addEventListener("click", () => {
    if (state.selected) void loadRoomInspect(state.selected);
  });
  roomInspectExitsSave.addEventListener("click", () => void saveRoomExits());
  linkFormSave.addEventListener("click", () => void saveRoomLink());

  roomSearchInput.addEventListener("input", () => {
    if (roomSearchTimer) clearTimeout(roomSearchTimer);
    roomSearchTimer = setTimeout(() => {
      roomSearchTimer = null;
      void runRoomSearch(roomSearchInput.value);
    }, 220);
  });
  roomSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      roomSearchInput.value = "";
      roomSearchHits = [];
      roomSearchSelected = null;
      setSideStatus(null);
      renderRoomSearchResults();
      return;
    }
    if (e.key === "ArrowDown" && roomSearchHits.length) {
      e.preventDefault();
      const idx = roomSearchSelected ? roomSearchHits.findIndex((h) => h.id === roomSearchSelected) : -1;
      const next = roomSearchHits[Math.min(idx + 1, roomSearchHits.length - 1)]!;
      roomSearchSelected = next.id;
      renderRoomSearchResults();
      void focusRoom(next);
      return;
    }
    if (e.key === "ArrowUp" && roomSearchHits.length) {
      e.preventDefault();
      const idx = roomSearchSelected ? roomSearchHits.findIndex((h) => h.id === roomSearchSelected) : roomSearchHits.length;
      const next = roomSearchHits[Math.max(idx - 1, 0)]!;
      roomSearchSelected = next.id;
      renderRoomSearchResults();
      void focusRoom(next);
      return;
    }
    if (isEnterKey(e) && roomSearchSelected) {
      e.preventDefault();
      const hit = roomSearchHits.find((h) => h.id === roomSearchSelected);
      if (hit) void focusRoom(hit);
    }
  });

  toggle.addEventListener("click", () => setExpanded(!state.expanded));
  levelUp.addEventListener("click", () => {
    state.follow = false;
    follow.classList.remove("is-on");
    state.centerRef = state.view?.center.id ?? null;
    state.z = (state.z ?? 0) + 1;
    void refresh();
  });
  levelDown.addEventListener("click", () => {
    state.follow = false;
    follow.classList.remove("is-on");
    state.centerRef = state.view?.center.id ?? null;
    state.z = (state.z ?? 0) - 1;
    void refresh();
  });
  follow.addEventListener("click", () => {
    state.follow = !state.follow;
    follow.classList.toggle("is-on", state.follow);
    void refresh();
  });

  const PAN_DRAG_THRESHOLD = 4;
  let mapPan: {
    pointerId: number;
    startX: number;
    startY: number;
    originPanX: number;
    originPanY: number;
    moved: boolean;
  } | null = null;
  let suppressMapClick = false;

  function stopMapPan(e: PointerEvent): void {
    if (!mapPan || e.pointerId !== mapPan.pointerId) return;
    if (mapPan.moved) suppressMapClick = true;
    canvas.classList.remove("is-map-panning");
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    mapPan = null;
  }

  canvas.addEventListener(
    "click",
    (e) => {
      if (!suppressMapClick) return;
      suppressMapClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  canvas.addEventListener("dragstart", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Pan from empty space or rooms; defer capture until drag starts so room clicks still hit `.wr`.
    mapPan = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originPanX: mapPanX,
      originPanY: mapPanY,
      moved: false,
    };
  });
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (!mapPan || e.pointerId !== mapPan.pointerId) return;
      const dx = e.clientX - mapPan.startX;
      const dy = e.clientY - mapPan.startY;
      if (!mapPan.moved) {
        if (Math.abs(dx) + Math.abs(dy) < PAN_DRAG_THRESHOLD) return;
        mapPan.moved = true;
        state.follow = false;
        follow.classList.remove("is-on");
        canvas.classList.add("is-map-panning");
        canvas.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      mapPanX = mapPan.originPanX + dx;
      mapPanY = mapPan.originPanY + dy;
      applyMapPan();
    },
    { passive: false },
  );
  canvas.addEventListener("pointerup", stopMapPan);
  canvas.addEventListener("pointercancel", stopMapPan);

  canvas.addEventListener("focus", () => {
    state.mapKeyboard = true;
    canvas.classList.add("is-map-keyboard");
    const v = state.view;
    if (v && !state.navCell) {
      const z = state.z ?? v.z;
      const rooms = v.rooms.filter((r) => r.pos.z === z);
      const anchor = navAnchor(v, rooms);
      if (anchor) state.navCell = { x: anchor.pos.x, y: anchor.pos.y };
      renderMap();
    }
  });
  canvas.addEventListener("blur", (e) => {
    const next = e.relatedTarget;
    if (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) {
      state.mapKeyboard = false;
      canvas.classList.remove("is-map-keyboard");
      renderMap();
      return;
    }
    if (next instanceof Node && root.contains(next)) return;
    state.mapKeyboard = false;
    canvas.classList.remove("is-map-keyboard");
    renderMap();
  });
  root.addEventListener("keydown", onMapKeyDown, true);
  // Defer the first render until the host page finished initializing (map loaded, runtime wired).
  setTimeout(() => {
    setExpanded(state.expanded);
    void api<GameState>("/api/state")
      .then((s) => {
        state.game = s;
        renderSummary();
        renderVitals();
      })
      .catch(() => {});
  }, 0);

  let gameUiRaf: number | null = null;
  function scheduleGameUiRender(): void {
    if (gameUiRaf != null) return;
    gameUiRaf = requestAnimationFrame(() => {
      gameUiRaf = null;
      renderSummary();
      renderVitals();
    });
  }

  return {
    /** Feed runtime messages (`game`, `map`). */
    onMessage(msg: { type: string; [k: string]: unknown }): void {
      if (msg.type === "game") {
        state.game = msg.game as GameState;
        scheduleGameUiRender();
      } else if (msg.type === "map") {
        if (state.game) state.game.room = (msg.room as RoomBrief | null) ?? state.game.room;
        renderSummary();
        if (state.follow) scheduleRefresh();
      }
    },
    refresh,
    toggleExpanded() {
      setExpanded(!state.expanded);
    },
    setExpanded,
  };
}
