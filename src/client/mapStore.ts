import { propagateAreas } from "../mapper/areaInfer.js";
import { emptyWorldGraph, WorldMap } from "../mapper/WorldMap.js";
import type { WorldGraphDocument } from "../mapper/types.js";
import { idbDelete, idbGet, idbPut } from "./idbKv.js";

/**
 * One session's world graph. Starts empty. Rooms and links are learned while you play
 * and saved in IndexedDB under that session. Nothing is seeded from a shared map file.
 */

/** Old single-browser key. Held a copy of the shipped baseline, then one shared learned map. */
const LEGACY_IDB_KEY = "player-map";
const LEGACY_LOCAL_GRAPH_KEY = "playpowermud-world-graph";
const SAVE_DEBOUNCE_MS = 1500;

export type SavedWorldGraph = { baseUpdatedAt: string; doc: WorldGraphDocument };

export function mapStorageKey(sessionId: string): string {
  if (!/^[-a-zA-Z0-9]{1,80}$/.test(sessionId)) throw new Error("Bad session id");
  return `session-map:${sessionId}`;
}

export function emptySavedMap(): SavedWorldGraph {
  return { baseUpdatedAt: "", doc: emptyWorldGraph("powermud") };
}

function isSaved(saved: SavedWorldGraph | undefined): saved is SavedWorldGraph {
  return saved?.doc?.version === 1 && !!saved.doc.rooms;
}

function readLegacyLocalGraph(): SavedWorldGraph | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_GRAPH_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SavedWorldGraph;
    return isSaved(parsed) ? parsed : undefined;
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

/** Pre-session map: IndexedDB `player-map`, or the localStorage mirror. Does not delete it. */
export async function readLegacyMap(): Promise<SavedWorldGraph | undefined> {
  let saved: SavedWorldGraph | undefined;
  try {
    saved = await idbGet<SavedWorldGraph>(LEGACY_IDB_KEY);
  } catch {
    saved = undefined;
  }
  if (!isSaved(saved)) saved = readLegacyLocalGraph();
  return isSaved(saved) ? saved : undefined;
}

/** Drop the pre-session map after it has been copied onto the first session. */
export async function discardLegacyMap(): Promise<void> {
  clearLegacyLocalGraph();
  try {
    await idbDelete(LEGACY_IDB_KEY);
  } catch {
    /* session copy is the one that counts */
  }
}

export class BrowserMapStore {
  private timer: ReturnType<typeof setTimeout> | null = null;

  private constructor(
    readonly map: WorldMap,
    private baseUpdatedAt: string,
    readonly sessionId: string,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** This session's map, or an empty graph when the session has none yet. */
  static async open(
    sessionId: string,
    onError: (err: unknown) => void,
  ): Promise<{ store: BrowserMapStore; source: "saved" | "empty" }> {
    const key = mapStorageKey(sessionId);
    let saved: SavedWorldGraph | undefined;
    try {
      saved = await idbGet<SavedWorldGraph>(key);
    } catch (err) {
      onError(err);
    }
    let doc: WorldGraphDocument;
    let source: "saved" | "empty";
    let baseUpdatedAt = "";
    if (isSaved(saved)) {
      doc = saved.doc;
      source = "saved";
      baseUpdatedAt = saved.baseUpdatedAt;
    } else {
      doc = emptyWorldGraph("powermud");
      source = "empty";
    }
    const map = new WorldMap(doc);
    propagateAreas(map);
    const store = new BrowserMapStore(map, baseUpdatedAt, sessionId, onError);
    map.markClean();
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
    const record: SavedWorldGraph = { baseUpdatedAt: this.baseUpdatedAt, doc: this.map.doc };
    try {
      await idbPut(mapStorageKey(this.sessionId), record);
      this.map.markClean();
    } catch (err) {
      this.onError(err);
    }
  }

  /** Forget this session's map. The next load starts empty. */
  static async clearSaved(sessionId: string): Promise<void> {
    await idbDelete(mapStorageKey(sessionId));
  }

  /** Current graph for export (flushes pending saves first). */
  async exportSnapshot(): Promise<SavedWorldGraph> {
    await this.flush();
    return { baseUpdatedAt: this.baseUpdatedAt, doc: this.map.doc };
  }

  /** Replace this session's saved map. The page reloads so the mapper picks it up. */
  static async importSaved(sessionId: string, record: SavedWorldGraph): Promise<void> {
    await idbPut(mapStorageKey(sessionId), record);
  }
}
