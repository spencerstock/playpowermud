import { propagateAreas } from "../mapper/areaInfer.js";
import { emptyWorldGraph, WorldMap } from "../mapper/WorldMap.js";
import type { WorldGraphDocument } from "../mapper/types.js";

/**
 * This browser's world graph. Starts empty. Rooms and links are learned while you play
 * and saved in IndexedDB (localStorage is only a fallback for a small graph).
 * Nothing is seeded from a shared map file.
 */

const DB_NAME = "playpowermud";
const STORE = "kv";
/** Not `world-graph`: that key held a copy of the old shipped baseline. */
const KEY = "player-map";
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

  /** This browser's map, or an empty graph. Survives reloads; never seeded from a shared file. */
  static async open(onError: (err: unknown) => void): Promise<{ store: BrowserMapStore; source: "saved" | "empty" }> {
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
    let doc: WorldGraphDocument;
    let source: "saved" | "empty";
    let baseUpdatedAt = "";
    if (saved?.doc?.version === 1 && saved.doc.rooms) {
      doc = saved.doc;
      source = "saved";
      baseUpdatedAt = saved.baseUpdatedAt;
    } else {
      doc = emptyWorldGraph("powermud");
      source = "empty";
    }
    const map = new WorldMap(doc);
    propagateAreas(map);
    const store = new BrowserMapStore(map, baseUpdatedAt, onError);
    await store.ensureDb();
    if (fromLegacyLocalStorage) {
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

  /** Forget this browser's map. The next load starts empty. */
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
