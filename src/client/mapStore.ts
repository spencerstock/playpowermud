import { propagateAreas } from "../mapper/areaInfer.js";
import { emptyWorldGraph, WorldMap } from "../mapper/WorldMap.js";
import type { WorldGraphDocument } from "../mapper/types.js";

/**
 * World graph for the browser: starts from the shipped Powermud map
 * (`public/data/powermud.graph.json`) and keeps what this browser learns in IndexedDB
 * (localStorage is too small for the full graph). A newer shipped map merges in missing
 * rooms/planes/areas without discarding what you already mapped.
 */

export const SHIPPED_MAP_URL = "/data/powermud.graph.json";
const DB_NAME = "playpowermud";
const STORE = "kv";
const KEY = "world-graph";
const LEGACY_LOCAL_GRAPH_KEY = "playpowermud-world-graph";
const SAVE_DEBOUNCE_MS = 1500;

export type SavedWorldGraph = { baseUpdatedAt: string; doc: WorldGraphDocument };
type Saved = SavedWorldGraph;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbOnce<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbTransient<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await idbOnce(db, mode, fn);
  } finally {
    db.close();
  }
}

/** Add rooms/planes/areas from a newer shipped baseline without overwriting learned data. */
export function mergeShippedBaseline(learned: WorldGraphDocument, shipped: WorldGraphDocument): boolean {
  let changed = false;
  learned.areas ??= {};
  for (const [id, room] of Object.entries(shipped.rooms)) {
    if (!learned.rooms[id]) {
      learned.rooms[id] = structuredClone(room);
      changed = true;
    }
  }
  for (const [id, plane] of Object.entries(shipped.planes)) {
    if (!learned.planes[id]) {
      learned.planes[id] = structuredClone(plane);
      changed = true;
    }
  }
  for (const [id, area] of Object.entries(shipped.areas ?? {})) {
    if (!learned.areas[id]) {
      learned.areas[id] = structuredClone(area);
      changed = true;
    }
  }
  if (shipped.waypoints) {
    learned.waypoints ??= {};
    for (const [name, wp] of Object.entries(shipped.waypoints)) {
      if (!learned.waypoints[name]) {
        learned.waypoints[name] = structuredClone(wp);
        changed = true;
      }
    }
  }
  const nextRoom = Math.max(learned.nextRoom ?? 0, shipped.nextRoom ?? 0);
  const nextPlane = Math.max(learned.nextPlane ?? 0, shipped.nextPlane ?? 0);
  if (nextRoom !== learned.nextRoom) {
    learned.nextRoom = nextRoom;
    changed = true;
  }
  if (nextPlane !== learned.nextPlane) {
    learned.nextPlane = nextPlane;
    changed = true;
  }
  return changed;
}

function readLegacyLocalGraph(): Saved | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_GRAPH_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Saved;
    if (typeof parsed?.baseUpdatedAt !== "string" || parsed?.doc?.version !== 1) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function clearLegacyLocalGraph(): void {
  try {
    localStorage?.removeItem(LEGACY_LOCAL_GRAPH_KEY);
  } catch {
    /* ignore */
  }
}

/** Best-effort mirror for small learned graphs; full baseline is too large for localStorage quota. */
function mirrorLocalGraph(record: Saved): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LEGACY_LOCAL_GRAPH_KEY, JSON.stringify(record));
  } catch {
    localStorage.removeItem(LEGACY_LOCAL_GRAPH_KEY);
  }
}

export class BrowserMapStore {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private db: IDBDatabase | null = null;

  private constructor(
    readonly map: WorldMap,
    private baseUpdatedAt: string,
    private readonly onError: (err: unknown) => void,
  ) {}

  private async ensureDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = await openDb();
    return this.db;
  }

  /** Shipped map, or the saved copy; learned data survives deploys and browser restarts. */
  static async open(onError: (err: unknown) => void): Promise<{ store: BrowserMapStore; source: "saved" | "shipped" | "empty" }> {
    let shipped: WorldGraphDocument | null = null;
    try {
      const res = await fetch(SHIPPED_MAP_URL, { cache: "no-cache" });
      if (res.ok) shipped = (await res.json()) as WorldGraphDocument;
    } catch (err) {
      onError(err);
    }
    let saved: Saved | undefined;
    let fromLegacyLocalStorage = false;
    try {
      saved = await idbTransient<Saved | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<Saved | undefined>);
    } catch (err) {
      onError(err);
    }
    if (!saved) {
      saved = readLegacyLocalGraph();
      if (saved) {
        fromLegacyLocalStorage = true;
        clearLegacyLocalGraph();
      }
    }
    const shippedAt = shipped?.updatedAt ?? "";
    let doc: WorldGraphDocument;
    let source: "saved" | "shipped" | "empty";
    let baseUpdatedAt = shippedAt;
    let mergedBaseline = false;
    if (saved?.doc) {
      doc = saved.doc;
      source = "saved";
      baseUpdatedAt = saved.baseUpdatedAt;
      if (shipped && shippedAt && shippedAt > saved.baseUpdatedAt) {
        mergedBaseline = mergeShippedBaseline(doc, shipped);
        baseUpdatedAt = shippedAt;
      }
    } else if (shipped) {
      doc = shipped;
      source = "shipped";
    } else {
      doc = emptyWorldGraph("powermud");
      source = "empty";
    }
    const map = new WorldMap(doc);
    propagateAreas(map);
    const store = new BrowserMapStore(map, baseUpdatedAt, onError);
    await store.ensureDb();
    if (mergedBaseline || fromLegacyLocalStorage) {
      map.touch();
      void store.flush();
    } else {
      map.markClean();
    }
    return { store, source };
  }

  /** Debounced save after the mapper or an edit changed the graph. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.map.isDirty) return;
    const record: Saved = { baseUpdatedAt: this.baseUpdatedAt, doc: this.map.doc };
    try {
      const db = await this.ensureDb();
      await idbOnce(db, "readwrite", (s) => s.put(record, KEY));
      this.map.markClean();
      mirrorLocalGraph(record);
    } catch (err) {
      try {
        mirrorLocalGraph(record);
        this.map.markClean();
      } catch {
        this.onError(err);
      }
    }
  }

  /** Forget local changes; the next load uses the shipped map. */
  static async clearSaved(): Promise<void> {
    clearLegacyLocalGraph();
    await idbTransient("readwrite", (s) => s.delete(KEY));
  }

  /** Current graph for export (flushes pending saves first). */
  async exportSnapshot(): Promise<SavedWorldGraph> {
    await this.flush();
    return { baseUpdatedAt: this.baseUpdatedAt, doc: this.map.doc };
  }

  /** Replace the saved learned map (used after config import). */
  static async importSaved(record: SavedWorldGraph): Promise<void> {
    clearLegacyLocalGraph();
    await idbTransient("readwrite", (s) => s.put(record, KEY));
  }
}
