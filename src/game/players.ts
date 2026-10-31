import knownPlayers from "../../data/powermud/known-players.json" with { type: "json" };
import type { RoomContent } from "./types.js";

export { parsePowermudSocialLine } from "./socialLines.js";

export type PlayerRole = "admin";

export type KnownPlayer = {
  name: string;
  guild?: string;
  roles: PlayerRole[];
};

type Registry = Map<string, KnownPlayer>;

function normName(name: string): string {
  return name.trim().toLowerCase();
}

function guildTokens(guild?: string): string[] {
  if (!guild) return [];
  return guild
    .toLowerCase()
    .replace(/['']/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** Guild label on channel lines is a loose match (e.g. `Melee-magthere` vs `Melee-Magthere`). */
export function guildMatchesChannel(guild: string | undefined, channel: string): boolean {
  if (!guild) return true;
  const ch = channel.toLowerCase().replace(/['']/g, "");
  const parts = guildTokens(guild);
  return parts.every((p) => ch.includes(p));
}

/** Powermud admins from `data/powermud/known-players.json` (bundled with the client). */
export function loadPowermudKnownPlayers(raw: { admins?: { name: string; guild?: string }[] } = knownPlayers): Registry {
  const map: Registry = new Map();
  for (const a of raw.admins ?? []) {
    const name = a.name?.trim();
    if (!name) continue;
    map.set(normName(name), { name, guild: a.guild, roles: ["admin"] });
  }
  return map;
}

let defaultRegistry: Registry | null = null;

export function knownPlayerRegistry(): Registry {
  defaultRegistry ??= loadPowermudKnownPlayers();
  return defaultRegistry;
}

export function lookupKnownPlayer(name: string, registry: Registry): KnownPlayer | undefined {
  const key = normName(name);
  return registry.get(key);
}

export function playerRoles(name: string, registry: Registry): PlayerRole[] {
  return lookupKnownPlayer(name, registry)?.roles ?? [];
}

/** LPC object paths for PCs when the MUD shows them. */
export function contentPathLooksLikePlayer(path: string): boolean {
  return /\/(?:ply|player|users?)[/#]/i.test(path);
}

/**
 * Map/player tracking view of room contents. Known admins and {@link isConfirmed} PCs are
 * `player`; everyone else with a player object path is `npc` (including on the world map).
 */
export function enrichRoomPlayers(
  contents: RoomContent[],
  registry: Registry,
  self?: string | null,
  isConfirmed?: (name: string) => boolean,
): RoomContent[] {
  const selfKey = self ? normName(self) : null;
  return contents.map((c) => {
    const first = c.name.trim().split(/\s+/)[0] ?? c.name;
    const key = normName(first);
    if (selfKey && key === selfKey) return c;
    const known = lookupKnownPlayer(first, registry);
    const pcPath = c.path && contentPathLooksLikePlayer(c.path);
    const confirmed = isConfirmed?.(first) ?? false;
    if (known || (pcPath && confirmed)) return { ...c, kind: "player" };
    if (pcPath) return { ...c, kind: "npc" };
    return c;
  });
}
