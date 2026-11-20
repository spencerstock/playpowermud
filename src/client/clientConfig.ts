import type { WorldGraphDocument } from "../mapper/types.js";

export const CLIENT_CONFIG_KIND = "playpowermud-client-config";
export const CLIENT_CONFIG_VERSION = 1;
export const MAP_FILE_KIND = "playpowermud-map";
export const MAP_FILE_VERSION = 1;
export const LOCAL_STORAGE_PREFIX = "playpowermud";
/** Which session is live. Local to this browser — not part of an exported config. */
export const ACTIVE_SESSION_LS = "playpowermud-active-session";

export type ClientConfigMap = {
  baseUpdatedAt: string;
  doc: WorldGraphDocument;
};

export type ClientConfigDocument = {
  kind: typeof CLIENT_CONFIG_KIND;
  version: number;
  exportedAt: string;
  /** Session name. Absent on configs exported before sessions existed. */
  name?: string;
  localStorage: Record<string, string>;
  map?: ClientConfigMap;
};

export type MapFileDocument = {
  kind: typeof MAP_FILE_KIND;
  version: number;
  exportedAt: string;
  baseUpdatedAt: string;
  doc: WorldGraphDocument;
};

export function collectPlaypowermudLocalStorage(
  storage: Pick<Storage, "length" | "key" | "getItem">,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !isSessionConfigKey(key)) continue;
    const val = storage.getItem(key);
    if (val !== null) out[key] = val;
  }
  return out;
}

/** localStorage keys that belong to a session. The active-session pointer and the old graph mirror do not. */
export function isSessionConfigKey(key: string): boolean {
  if (!key.startsWith(LOCAL_STORAGE_PREFIX)) return false;
  if (key === ACTIVE_SESSION_LS || key === "playpowermud-world-graph") return false;
  return true;
}

export function buildClientConfig(opts: {
  localStorage: Record<string, string>;
  map?: ClientConfigMap;
  name?: string;
  exportedAt?: string;
}): ClientConfigDocument {
  const name = opts.name?.trim();
  return {
    kind: CLIENT_CONFIG_KIND,
    version: CLIENT_CONFIG_VERSION,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    ...(name ? { name } : {}),
    localStorage: opts.localStorage,
    ...(opts.map ? { map: opts.map } : {}),
  };
}

export function buildMapFile(map: ClientConfigMap, exportedAt?: string): MapFileDocument {
  return {
    kind: MAP_FILE_KIND,
    version: MAP_FILE_VERSION,
    exportedAt: exportedAt ?? new Date().toISOString(),
    baseUpdatedAt: map.baseUpdatedAt,
    doc: map.doc,
  };
}

function parseMapBlock(raw: unknown): ClientConfigMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid map block");
  const m = raw as Record<string, unknown>;
  if (typeof m.baseUpdatedAt !== "string") throw new Error("map.baseUpdatedAt must be a string");
  const doc = m.doc;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("map.doc must be an object");
  const d = doc as Record<string, unknown>;
  if (d.version !== 1) throw new Error("map.doc.version must be 1");
  if (typeof d.mud !== "string" || !d.mud.trim()) throw new Error("map.doc.mud must be a string");
  if (typeof d.updatedAt !== "string") throw new Error("map.doc.updatedAt must be a string");
  if (!d.rooms || typeof d.rooms !== "object" || Array.isArray(d.rooms)) {
    throw new Error("map.doc.rooms must be an object");
  }
  if (!d.planes || typeof d.planes !== "object" || Array.isArray(d.planes)) {
    throw new Error("map.doc.planes must be an object");
  }
  if (!d.areas || typeof d.areas !== "object" || Array.isArray(d.areas)) {
    throw new Error("map.doc.areas must be an object");
  }
  return { baseUpdatedAt: m.baseUpdatedAt, doc: doc as WorldGraphDocument };
}

/** Validate and normalize an exported client config JSON object. */
export function parseClientConfig(raw: unknown): ClientConfigDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Config must be a JSON object");
  const o = raw as Record<string, unknown>;
  if (o.kind !== CLIENT_CONFIG_KIND) throw new Error(`Expected kind "${CLIENT_CONFIG_KIND}"`);
  if (typeof o.version !== "number" || o.version < 1 || o.version > CLIENT_CONFIG_VERSION) {
    throw new Error(`Unsupported config version (${String(o.version)})`);
  }
  if (typeof o.exportedAt !== "string") throw new Error("Missing exportedAt");
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : undefined;
  const ls = o.localStorage;
  if (!ls || typeof ls !== "object" || Array.isArray(ls)) throw new Error("Invalid localStorage block");
  const localStorage: Record<string, string> = {};
  for (const [k, v] of Object.entries(ls as Record<string, unknown>)) {
    if (typeof k !== "string" || !isSessionConfigKey(k)) continue;
    if (typeof v !== "string") throw new Error(`localStorage["${k}"] must be a string`);
    localStorage[k] = v;
  }
  const map = o.map === undefined ? undefined : parseMapBlock(o.map);
  return {
    kind: CLIENT_CONFIG_KIND,
    version: o.version,
    exportedAt: o.exportedAt,
    ...(name ? { name } : {}),
    localStorage,
    ...(map ? { map } : {}),
  };
}

/**
 * A map file, a raw world graph, or a client config that includes a map.
 * A config with no map is an error — importing it here must not invent a graph.
 */
export function parseMapImport(raw: unknown): ClientConfigMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Map file must be a JSON object");
  const o = raw as Record<string, unknown>;
  if (o.kind === CLIENT_CONFIG_KIND) {
    const config = parseClientConfig(raw);
    if (!config.map) throw new Error("That config has no map");
    return config.map;
  }
  if (o.kind === MAP_FILE_KIND) {
    if (typeof o.version !== "number" || o.version < 1 || o.version > MAP_FILE_VERSION) {
      throw new Error(`Unsupported map file version (${String(o.version)})`);
    }
    return parseMapBlock({ baseUpdatedAt: o.baseUpdatedAt, doc: o.doc });
  }
  if (o.version === 1 && o.rooms && typeof o.rooms === "object") {
    return parseMapBlock({ baseUpdatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "", doc: o });
  }
  if (o.doc) return parseMapBlock(o);
  throw new Error("Unrecognized map file");
}

export function applyClientConfigToLocalStorage(
  doc: ClientConfigDocument,
  storage: Pick<Storage, "length" | "key" | "removeItem" | "setItem">,
  opts?: { merge?: boolean },
): void {
  if (!opts?.merge) {
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && isSessionConfigKey(key)) toRemove.push(key);
    }
    for (const k of toRemove) storage.removeItem(k);
  }
  for (const [k, v] of Object.entries(doc.localStorage)) storage.setItem(k, v);
}

function fileSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "session";
}

export function configExportFilename(exportedAt: string, name?: string): string {
  const day = exportedAt.slice(0, 10);
  return name ? `playpowermud-config-${fileSlug(name)}-${day}.json` : `playpowermud-config-${day}.json`;
}

export function mapExportFilename(exportedAt: string, name?: string): string {
  const day = exportedAt.slice(0, 10);
  return `playpowermud-map-${fileSlug(name ?? "session")}-${day}.json`;
}
