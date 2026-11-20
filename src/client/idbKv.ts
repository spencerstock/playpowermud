const DB_NAME = "playpowermud";
const STORE = "kv";

export function openKvDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
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

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openKvDb();
  try {
    return await idbOnce<T | undefined>(db, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
  } finally {
    db.close();
  }
}

export async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openKvDb();
  try {
    await idbOnce(db, "readwrite", (s) => s.put(value, key));
  } finally {
    db.close();
  }
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openKvDb();
  try {
    await idbOnce(db, "readwrite", (s) => s.delete(key));
  } finally {
    db.close();
  }
}
