import type { MapWaypoint, WorldGraphDocument } from "./types.js";

export function ensureWaypoints(doc: WorldGraphDocument): Record<string, MapWaypoint> {
  return (doc.waypoints ??= {});
}

/** Trim; empty → null. Keys are stored lowercase for case-insensitive `/to`. */
export function normalizeWaypointName(name: string): string | null {
  const n = name.trim();
  return n ? n.toLowerCase() : null;
}

export function remapWaypointRoomIds(doc: WorldGraphDocument, dropId: string, keepId: string): void {
  const wps = doc.waypoints;
  if (!wps) return;
  for (const wp of Object.values(wps)) {
    if (wp.roomId === dropId) wp.roomId = keepId;
  }
}
