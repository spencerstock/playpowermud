import type { MapRoom } from "./types.js";
import type { WorldMap } from "./WorldMap.js";

/**
 * Bars and restaurants: a `list` in the room prints a Food or Drink menu, and eating or
 * drinking there heals. The room gets `HEALING_TAG` and its menu in `meta.healing`; when
 * healing is needed, buy the cheapest item (`cheapestHealingItem`).
 *
 *   Food                  Cost
 *   =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
 *   Rothe haunch           75  drakaan
 *   Myconid soup           5   drakaan
 *   =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
 */
export const HEALING_TAG = "healing";

export type MenuKind = "food" | "drink";
export type MenuItem = { name: string; cost: number; currency?: string };
export type HealingMenu = { kind: MenuKind; items: MenuItem[] };
export type RoomHealing = Partial<Record<MenuKind, { items: MenuItem[]; seenAt: string }>>;
export type HealingPick = MenuItem & { kind: MenuKind; buy: string };

const HEADER = /^[\s>]*(Food|Drink)\s{2,}Cost\s*$/i;
const RULE = /^\s*(?:=-){4,}=?\s*$/;
const ITEM = /^\s*(\S.*?)\s{2,}(\d[\d,]*)(?:\s+(\S.*?))?\s*$/;
const MAX_ITEMS = 60;

/** Line-at-a-time reader for menu tables; `feed` returns the menu on its closing rule. */
export class MenuListParser {
  private cur: { kind: MenuKind; stage: "rule" | "items"; items: MenuItem[] } | null = null;

  feed(raw: string): HealingMenu | null {
    const line = raw.replace(/\r/g, "");
    const head = HEADER.exec(line);
    if (head) {
      this.cur = { kind: head[1]!.toLowerCase() as MenuKind, stage: "rule", items: [] };
      return null;
    }
    const cur = this.cur;
    if (!cur) return null;
    if (!line.trim()) return null;
    if (RULE.test(line)) {
      if (cur.stage === "rule") {
        cur.stage = "items";
        return null;
      }
      this.cur = null;
      return cur.items.length ? { kind: cur.kind, items: cur.items } : null;
    }
    const m = cur.stage === "items" ? ITEM.exec(line) : null;
    if (!m || cur.items.length >= MAX_ITEMS) {
      this.cur = null;
      return null;
    }
    cur.items.push({ name: m[1]!.trim(), cost: Number(m[2]!.replace(/,/g, "")), ...(m[3] ? { currency: m[3] } : {}) });
    return null;
  }

  reset(): void {
    this.cur = null;
  }
}

export function roomHealing(room: MapRoom | undefined): RoomHealing | undefined {
  const h = room?.meta?.healing;
  return h && typeof h === "object" ? (h as RoomHealing) : undefined;
}

/** Tag `room` as a healing place and store (replace) its menu of this kind. True if anything changed. */
export function recordHealingMenu(room: MapRoom, menu: HealingMenu, at = new Date().toISOString()): boolean {
  room.tags ??= [];
  room.meta ??= {};
  const prev = roomHealing(room);
  const same = JSON.stringify(prev?.[menu.kind]?.items) === JSON.stringify(menu.items);
  const tagged = room.tags.includes(HEALING_TAG);
  if (!tagged) room.tags.push(HEALING_TAG);
  room.meta.healing = { ...(prev ?? {}), [menu.kind]: { items: menu.items, seenAt: at } };
  return !tagged || !same;
}

/** Cheapest thing on any of the room's menus, with the command to buy it. */
export function cheapestHealingItem(room: MapRoom | undefined): HealingPick | undefined {
  const h = roomHealing(room);
  if (!h) return undefined;
  let best: HealingPick | undefined;
  for (const kind of ["food", "drink"] as const) {
    for (const it of h[kind]?.items ?? []) {
      if (!best || it.cost < best.cost) best = { ...it, kind, buy: `buy ${it.name.toLowerCase()}` };
    }
  }
  return best;
}

/** Every healing place on the map with its cheapest item. */
export function healingPlaces(map: WorldMap): { room: MapRoom; cheapest?: HealingPick }[] {
  return map
    .rooms()
    .filter((r) => r.tags?.includes(HEALING_TAG))
    .map((room) => ({ room, cheapest: cheapestHealingItem(room) }));
}
