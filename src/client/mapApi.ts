import { roomSearchTitle } from "../mapper/areaInfer.js";
import { computeAreaOverlaysForMapView } from "../mapper/areaLayout.js";
import { npcNamesForRoom } from "../mapper/npcs.js";
import { resolvePathOptions } from "../mapper/pathPolicy.js";
import { describeRoom, label } from "../mapper/render.js";
import type { MapRoom, PathOptions } from "../mapper/types.js";
import { stripAnsi } from "../session/scrollback.js";
import type { ClientRuntime } from "./runtime.js";

/**
 * In-process version of the old hub's `/api/state` and `/api/map/*` routes, so the copied
 * world panel keeps calling `api(path, body)` unchanged. Handlers are ported from
 * mudwithme `src/hub/api.ts` (walk/bot/login routes still absent in the browser client).
 */

class ApiError extends Error {}

function need<T>(v: T | undefined | null, msg: string): T {
  if (v === undefined || v === null || v === "") throw new ApiError(msg);
  return v;
}

function pathOpts(body: Record<string, unknown>): PathOptions {
  return resolvePathOptions({
    maxDanger: typeof body.maxDanger === "number" ? body.maxDanger : undefined,
    avoid: Array.isArray(body.avoid) ? body.avoid.map(String) : undefined,
    preferAvoid: Array.isArray(body.preferAvoid) ? body.preferAvoid.map(String) : undefined,
    allowSpecial: body.allowSpecial === false ? false : undefined,
    allowInferred: body.allowInferred === false ? false : undefined,
  });
}

function roomDescriptionSnippet(room: MapRoom, max = 360): string | null {
  if (!room.description) return null;
  const plain = stripAnsi(room.description).replace(/\s+/g, " ").trim();
  if (!plain) return null;
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export function createMapApi(game: ClientRuntime) {
  const store = game.mapStore;
  const map = store.map;
  const room = (ref: unknown): MapRoom => {
    const r = typeof ref === "string" && ref ? map.resolve(ref) : game.mapper.current();
    return need(r, typeof ref === "string" && ref ? `No room matches "${ref}"` : "Position unknown");
  };
  const brief = (r: MapRoom | undefined) => game.briefRoom(r);

  function route(path: string, body: Record<string, unknown> | undefined): unknown {
    const url = new URL(path, "http://local");
    const p = url.pathname;
    const m = body === undefined ? "GET" : "POST";
    const b = body ?? {};

    if (p === "/api/state" && m === "GET") return game.snapshot();

    if (p === "/api/map/room" && m === "GET") {
      const r = room(url.searchParams.get("ref"));
      return { room: describeRoom(map, r), here: game.mapper.position === r.id };
    }
    if (p === "/api/map/view" && m === "GET") {
      const center = room(url.searchParams.get("ref"));
      const radius = Math.min(15, Math.max(1, Number(url.searchParams.get("radius") ?? 6)));
      const zParam = url.searchParams.get("z");
      const z = zParam !== null ? Number(zParam) : center.pos.z;
      const inView = map.rooms().filter(
        (r) =>
          r.pos.plane === center.pos.plane &&
          Math.abs(r.pos.x - center.pos.x) <= radius &&
          Math.abs(r.pos.y - center.pos.y) <= radius &&
          Math.abs(r.pos.z - z) <= 1,
      );
      const overlayIds = inView.filter((r) => r.pos.z === z).map((r) => r.id);
      const areaOverlays = computeAreaOverlaysForMapView(map, center.pos.plane, z, overlayIds);
      const rooms = inView.map((r) => ({
        ...brief(r)!,
        visits: r.visits,
        danger: r.danger ?? null,
        links: Object.fromEntries(
          Object.entries(r.links).map(([cmd, l]) => [
            cmd,
            { to: l.to, kind: l.kind, hidden: l.hidden ?? false, confirmed: l.confirmed, blocked: !!l.blocked },
          ]),
        ),
      }));
      const levels = [...new Set(map.rooms().filter((r) => r.pos.plane === center.pos.plane).map((r) => r.pos.z))].sort(
        (a, b) => a - b,
      );
      return {
        center: brief(center),
        here: game.mapper.position,
        plane: map.doc.planes[center.pos.plane] ?? null,
        z,
        levels,
        radius,
        rooms,
        areaOverlays,
      };
    }
    if (p === "/api/map/waypoints" && m === "GET") {
      return {
        waypoints: map.listWaypoints().map((wp) => ({
          ...wp,
          room: brief(map.room(wp.roomId)),
        })),
      };
    }
    if (p === "/api/map/waypoint" && m === "POST") {
      const name = String(need(b.name, "name required"));
      let roomId: string;
      if (b.room === null || b.room === undefined || b.room === "") {
        const here = game.mapper.current();
        if (!here) throw new ApiError("Current position unknown — look first, or pass room");
        roomId = here.id;
      } else {
        roomId = room(String(b.room)).id;
      }
      map.setWaypoint(name, roomId);
      store.schedule();
      const key = name.trim().toLowerCase();
      const stored = map.doc.waypoints?.[key];
      return {
        name: key,
        roomId,
        label: stored?.label,
        setAt: stored?.setAt,
        room: brief(map.room(roomId)),
      };
    }
    if (p === "/api/map/resolve" && m === "GET") {
      const ref = need(url.searchParams.get("ref"), "ref required");
      const resolved = map.resolve(ref);
      return { ref, found: !!resolved, room: resolved ? brief(resolved) : null };
    }
    if (p === "/api/map/path" && m === "POST") {
      const from = room(b.from);
      const to = room(need(b.to, "to required"));
      const path = map.findPath(from.id, (r) => r.id === to.id, pathOpts(b));
      return {
        from: brief(from),
        to: brief(to),
        found: path !== null,
        commands: path?.flatMap((s) => [...(s.pre ?? []), s.cmd]) ?? [],
        steps: path?.map((s) => ({ ...s, toLabel: label(map.room(s.to)!) })) ?? [],
      };
    }
    if (p === "/api/map/search" && m === "GET") {
      const q = need(url.searchParams.get("q"), "q required");
      const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 15));
      const hits = map.search(q, limit);
      const hereId = map.canonicalId(game.mapper.position);
      const distances = hereId ? map.stepDistances(hereId, new Set(hits.map((h) => h.room.id))) : null;
      return {
        hits: hits.map((h) => ({
          score: h.score,
          ...brief(h.room)!,
          title: roomSearchTitle(map.doc, h.room),
          label: label(h.room),
          description: roomDescriptionSnippet(h.room),
          npcs: npcNamesForRoom(h.room),
          npcMatch: h.npcMatch ?? null,
          ...(distances ? { distance: distances.get(h.room.id) ?? null } : {}),
        })),
      };
    }
    if (p === "/api/map/annotate" && m === "POST") {
      const r = room(b.room);
      if (typeof b.title === "string" && b.title && b.title !== r.title) {
        // Keep the game's own title as an alias: brief-mode arrivals still show it.
        if (r.title) r.titleAliases = [...new Set([...(r.titleAliases ?? []), r.title])].filter((t) => t !== b.title);
        r.title = b.title;
      }
      if (typeof b.note === "string" && b.note) r.notes.push(b.note);
      if (Array.isArray(b.exits)) {
        r.exits = [
          ...new Set(
            (b.exits as unknown[])
              .map(String)
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean),
          ),
        ];
      }
      map.reindex();
      map.touch();
      store.schedule();
      return { room: describeRoom(map, r) };
    }
    if (p === "/api/map/link" && m === "POST") {
      const from = room(b.from);
      const cmd = String(need(b.cmd, "cmd required")).trim().toLowerCase();
      if (b.remove === true) {
        map.unlink(from.id, cmd);
      } else {
        const prev = from.links[cmd];
        let toId: string | null;
        if (b.to === null || b.to === "") toId = null;
        else if (typeof b.to === "string" && b.to.trim()) toId = room(b.to).id;
        else toId = prev?.to ?? null;
        const kindIn = typeof b.kind === "string" ? b.kind : undefined;
        const kind = (kindIn ??
          prev?.kind ??
          (toId ? (from.exits.includes(cmd) ? "named" : "special") : "special")) as MapRoom["links"][string]["kind"];
        const confirmed = b.confirmed === undefined ? (prev?.confirmed ?? true) : b.confirmed !== false;
        const hidden =
          b.hidden === undefined ? (prev?.hidden ?? (!from.exits.includes(cmd) && kind !== "teleport")) : b.hidden === true;
        const link = map.link(from.id, cmd, toId, { kind, confirmed, hidden });
        if (Array.isArray(b.pre)) link.pre = b.pre.length ? b.pre.map(String) : undefined;
        else if (b.pre === null) delete link.pre;
        if (typeof b.note === "string") link.note = b.note || undefined;
        else if (b.note === null) delete link.note;
      }
      store.schedule();
      return { room: describeRoom(map, map.room(from.id)!) };
    }
    throw new ApiError(`${m} ${p} is not available in playpowermud`);
  }

  return async function api<T>(path: string, body?: unknown): Promise<T> {
    return route(path, body as Record<string, unknown> | undefined) as T;
  };
}
