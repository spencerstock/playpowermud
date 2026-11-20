import {
  ACTIVE_SESSION_LS,
  applyClientConfigToLocalStorage,
  buildClientConfig,
  collectPlaypowermudLocalStorage,
} from "./clientConfig.js";
import { discardLegacyMap, emptySavedMap, mapStorageKey, readLegacyMap, type SavedWorldGraph } from "./mapStore.js";
import { idbDelete, idbGet, idbPut } from "./idbKv.js";

const INDEX_KEY = "sessions-index";

export type SessionMeta = {
  id: string;
  name: string;
  updatedAt: string;
};

export type SessionIndex = {
  activeId: string;
  sessions: SessionMeta[];
};

type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "removeItem" | "setItem">;

export function sessionConfigKey(sessionId: string): string {
  if (!/^[-a-zA-Z0-9]{1,80}$/.test(sessionId)) throw new Error("Bad session id");
  return `session-config:${sessionId}`;
}

export function sanitizeSessionName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 40);
  return trimmed || "Session";
}

export function parseSessionIndex(raw: unknown): SessionIndex | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.sessions) || o.sessions.length === 0) return undefined;
  const sessions: SessionMeta[] = [];
  for (const item of o.sessions) {
    if (!item || typeof item !== "object") return undefined;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== "string" || !/^[-a-zA-Z0-9]{1,80}$/.test(s.id)) return undefined;
    if (typeof s.name !== "string" || typeof s.updatedAt !== "string") return undefined;
    sessions.push({ id: s.id, name: sanitizeSessionName(s.name), updatedAt: s.updatedAt });
  }
  if (typeof o.activeId !== "string" || !sessions.some((s) => s.id === o.activeId)) return undefined;
  return { activeId: o.activeId, sessions };
}

function nowIso(): string {
  return new Date().toISOString();
}

function touch(index: SessionIndex, id: string): void {
  const s = index.sessions.find((x) => x.id === id);
  if (s) s.updatedAt = nowIso();
}

async function loadIndex(): Promise<SessionIndex | undefined> {
  try {
    return parseSessionIndex(await idbGet<unknown>(INDEX_KEY));
  } catch {
    return undefined;
  }
}

async function saveIndex(index: SessionIndex): Promise<void> {
  await idbPut(INDEX_KEY, index);
}

/** First launch creates one session and moves the old shared map onto it, if there was one. */
export async function ensureSessions(storage: StorageLike = localStorage): Promise<SessionIndex> {
  const existing = await loadIndex();
  if (existing) {
    storage.setItem(ACTIVE_SESSION_LS, existing.activeId);
    return existing;
  }
  const id = crypto.randomUUID();
  const index: SessionIndex = {
    activeId: id,
    sessions: [{ id, name: "Session", updatedAt: nowIso() }],
  };
  const legacy = await readLegacyMap();
  if (legacy) await idbPut(mapStorageKey(id), legacy);
  await saveIndex(index);
  if (legacy) await discardLegacyMap();
  storage.setItem(ACTIVE_SESSION_LS, id);
  return index;
}

async function requireIndex(storage: StorageLike): Promise<SessionIndex> {
  return (await loadIndex()) ?? (await ensureSessions(storage));
}

/** Copy the live localStorage config onto the active session. The map is already stored under that session. */
export async function saveActiveConfig(storage: StorageLike = localStorage): Promise<void> {
  const index = await requireIndex(storage);
  await idbPut(sessionConfigKey(index.activeId), collectPlaypowermudLocalStorage(storage));
  touch(index, index.activeId);
  await saveIndex(index);
}

async function loadConfig(id: string, storage: StorageLike): Promise<void> {
  const saved = await idbGet<Record<string, string>>(sessionConfigKey(id));
  const localStorage = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  applyClientConfigToLocalStorage(
    buildClientConfig({ localStorage, exportedAt: nowIso() }),
    storage,
  );
}

/** Snapshot the current session, then make `id` the live one (its config replaces localStorage). */
export async function activateSession(id: string, storage: StorageLike = localStorage): Promise<SessionIndex> {
  const index = await requireIndex(storage);
  if (!index.sessions.some((s) => s.id === id)) throw new Error("No such session");
  if (index.activeId !== id) {
    await idbPut(sessionConfigKey(index.activeId), collectPlaypowermudLocalStorage(storage));
    touch(index, index.activeId);
    await loadConfig(id, storage);
    index.activeId = id;
    touch(index, id);
    await saveIndex(index);
  }
  storage.setItem(ACTIVE_SESSION_LS, id);
  return index;
}

/** Snapshot the current session, then start a new empty one and make it live. */
export async function createSession(name: string, storage: StorageLike = localStorage): Promise<SessionIndex> {
  const index = await requireIndex(storage);
  await idbPut(sessionConfigKey(index.activeId), collectPlaypowermudLocalStorage(storage));
  touch(index, index.activeId);
  const id = crypto.randomUUID();
  index.sessions.push({ id, name: sanitizeSessionName(name), updatedAt: nowIso() });
  index.activeId = id;
  await saveIndex(index);
  applyClientConfigToLocalStorage(buildClientConfig({ localStorage: {}, exportedAt: nowIso() }), storage);
  storage.setItem(ACTIVE_SESSION_LS, id);
  return index;
}

/**
 * Snapshot the current session, then add an imported one and make it live.
 * `map` omitted means the new session starts with an empty map — it does not copy the current one.
 */
export async function importSession(
  name: string,
  config: Record<string, string>,
  map: SavedWorldGraph | undefined,
  storage: StorageLike = localStorage,
): Promise<SessionIndex> {
  const index = await requireIndex(storage);
  await idbPut(sessionConfigKey(index.activeId), collectPlaypowermudLocalStorage(storage));
  touch(index, index.activeId);
  const id = crypto.randomUUID();
  index.sessions.push({ id, name: sanitizeSessionName(name), updatedAt: nowIso() });
  await idbPut(sessionConfigKey(id), config);
  await idbPut(mapStorageKey(id), map ?? emptySavedMap());
  index.activeId = id;
  await saveIndex(index);
  applyClientConfigToLocalStorage(buildClientConfig({ localStorage: config, exportedAt: nowIso() }), storage);
  storage.setItem(ACTIVE_SESSION_LS, id);
  return index;
}

export async function renameSession(id: string, name: string, storage: StorageLike = localStorage): Promise<SessionIndex> {
  const index = await requireIndex(storage);
  const session = index.sessions.find((s) => s.id === id);
  if (!session) throw new Error("No such session");
  session.name = sanitizeSessionName(name);
  session.updatedAt = nowIso();
  await saveIndex(index);
  return index;
}

/**
 * Delete a session and its map. The last remaining session is cleared instead, so there is always
 * one to play in. Deleting the live session loads another (or the cleared one).
 */
export async function deleteSession(id: string, storage: StorageLike = localStorage): Promise<SessionIndex> {
  const index = await requireIndex(storage);
  const session = index.sessions.find((s) => s.id === id);
  if (!session) throw new Error("No such session");
  if (index.sessions.length === 1) {
    await idbDelete(mapStorageKey(id));
    await idbDelete(sessionConfigKey(id));
    applyClientConfigToLocalStorage(buildClientConfig({ localStorage: {}, exportedAt: nowIso() }), storage);
    session.updatedAt = nowIso();
    await saveIndex(index);
    storage.setItem(ACTIVE_SESSION_LS, id);
    return index;
  }
  const wasActive = index.activeId === id;
  index.sessions = index.sessions.filter((s) => s.id !== id);
  if (wasActive) {
    const next = index.sessions[0]!;
    index.activeId = next.id;
    await loadConfig(next.id, storage);
    storage.setItem(ACTIVE_SESSION_LS, next.id);
  }
  await idbDelete(mapStorageKey(id));
  await idbDelete(sessionConfigKey(id));
  await saveIndex(index);
  return index;
}
