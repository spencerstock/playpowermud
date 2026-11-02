import type { WorldGraphDocument } from "../mapper/types.js";

export const CLIENT_CONFIG_KIND = "playpowermud-client-config";
export const CLIENT_CONFIG_VERSION = 1;
export const LOCAL_STORAGE_PREFIX = "playpowermud";

export type ClientConfigMap = {
  baseUpdatedAt: string;
  doc: WorldGraphDocument;
};

export type ClientConfigDocument = {
  kind: typeof CLIENT_CONFIG_KIND;
  version: number;
  exportedAt: string;
  localStorage: Record<string, string>;
  map?: ClientConfigMap;
};

export function collectPlaypowermudLocalStorage(
  storage: Pick<Storage, "length" | "key" | "getItem">,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(LOCAL_STORAGE_PREFIX)) continue;
    const val = storage.getItem(key);
    if (val !== null) out[key] = val;
  }
  return out;
}

export function buildClientConfig(opts: {
  localStorage: Record<string, string>;
  map?: ClientConfigMap;
  exportedAt?: string;
}): ClientConfigDocument {
  return {
    kind: CLIENT_CONFIG_KIND,
    version: CLIENT_CONFIG_VERSION,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    localStorage: opts.localStorage,
    ...(opts.map ? { map: opts.map } : {}),
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
  const ls = o.localStorage;
  if (!ls || typeof ls !== "object" || Array.isArray(ls)) throw new Error("Invalid localStorage block");
  const localStorage: Record<string, string> = {};
  for (const [k, v] of Object.entries(ls as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.startsWith(LOCAL_STORAGE_PREFIX)) continue;
    if (typeof v !== "string") throw new Error(`localStorage["${k}"] must be a string`);
    localStorage[k] = v;
  }
  const map = o.map === undefined ? undefined : parseMapBlock(o.map);
  return {
    kind: CLIENT_CONFIG_KIND,
    version: o.version,
    exportedAt: o.exportedAt,
    localStorage,
    ...(map ? { map } : {}),
  };
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
      if (key?.startsWith(LOCAL_STORAGE_PREFIX)) toRemove.push(key);
    }
    for (const k of toRemove) storage.removeItem(k);
  }
  for (const [k, v] of Object.entries(doc.localStorage)) storage.setItem(k, v);
}

export function configExportFilename(exportedAt: string): string {
  const day = exportedAt.slice(0, 10);
  return `playpowermud-config-${day}.json`;
}
