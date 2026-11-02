import { propagateAreas } from "../mapper/areaInfer.js";
import { emptyWorldGraph, WorldMap } from "../mapper/WorldMap.js";
import type { WorldGraphDocument } from "../mapper/types.js";

/**
 * World graph for the browser: starts from the shipped Powermud map
 * (`public/data/powermud.graph.json`) and keeps what this browser learns in IndexedDB.
 * A newer shipped map (by `updatedAt`) replaces the local copy.
 */

export const SHIPPED_MAP_URL = "/data/powermud.graph.json";
const DB_NAME = "playpowermud";
const STORE = "kv";
const KEY = "world-graph";
const SAVE_DEBOUNCE_MS = 4000;

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

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export class BrowserMapStore {
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    readonly map: WorldMap,
    private baseUpdatedAt: string,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** Shipped map, or the saved copy when it was built on the same (or newer) shipped map. */
  static async open(onError: (err: unknown) => void): Promise<{ store: BrowserMapStore; source: "saved" | "shipped" | "empty" }> {
    let shipped: WorldGraphDocument | null = null;
    try {
      const res = await fetch(SHIPPED_MAP_URL, { cache: "no-cache" });
      if (res.ok) shipped = (await res.json()) as WorldGraphDocument;
    } catch (err) {
      onError(err);
    }
    let saved: Saved | undefined;
    try {
      saved = await idb<Saved | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<Saved | undefined>);
    } catch (err) {
      onError(err);
    }
    const shippedAt = shipped?.updatedAt ?? "";
    let doc: WorldGraphDocument;
    let source: "saved" | "shipped" | "empty";
    if (saved && saved.baseUpdatedAt >= shippedAt) {
      doc = saved.doc;
      source = "saved";
    } else if (shipped) {
      doc = shipped;
      source = "shipped";
    } else {
      doc = emptyWorldGraph("powermud");
      source = "empty";
    }
    const map = new WorldMap(doc);
    propagateAreas(map);
    map.markClean();
    return { store: new BrowserMapStore(map, saved && source === "saved" ? saved.baseUpdatedAt : shippedAt, onError), source };
  }

  /** Debounced save after the mapper or an edit changed the graph. */
  schedule(): void {
    if (this.timer) return;
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
      await idb("readwrite", (s) => s.put(record, KEY));
      this.map.markClean();
    } catch (err) {
      this.onError(err);
    }
  }

  /** Forget local changes; the next load uses the shipped map. */
  static async clearSaved(): Promise<void> {
    await idb("readwrite", (s) => s.delete(KEY));
  }

  /** Current graph for export (flushes pending saves first). */
  async exportSnapshot(): Promise<SavedWorldGraph> {
    await this.flush();
    return { baseUpdatedAt: this.baseUpdatedAt, doc: this.map.doc };
  }

  /** Replace the saved learned map (used after config import). */
  static async importSaved(record: SavedWorldGraph): Promise<void> {
    await idb("readwrite", (s) => s.put(record, KEY));
  }
}
