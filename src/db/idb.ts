// Petite surcouche IndexedDB (promesses). Les migrations n'effacent jamais un magasin existant.

export const DB_NAME = "psycho304";
export const DB_VERSION = 1;

export const STORES = {
  sources: { keyPath: "id" },
  parts: { keyPath: "id" },
  modules: { keyPath: "id" },
  concepts: { keyPath: "id" },
  courses: { keyPath: "id" },
  questions: { keyPath: "id" },
  history: { keyPath: "hkey" },
  packs: { keyPath: "key" },
  attempts: { keyPath: "id" },
  sessions: { keyPath: "id" },
  settings: { keyPath: "key" },
  meta: { keyPath: "key" },
} as const;

export type StoreName = keyof typeof STORES;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(name = DB_NAME): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Migration v0 → v1 : création des magasins manquants uniquement.
      for (const [store, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, opts);
          if (store === "attempts") os.createIndex("answered_at", "answered_at");
          if (store === "history") os.createIndex("id", "id");
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Base de données bloquée : fermez les autres onglets de l'application."));
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction annulée"));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** Écritures groupées dans une seule transaction atomique. */
export async function writeBatch(ops: { store: StoreName; put?: unknown; del?: IDBValidKey }[]): Promise<void> {
  if (!ops.length) return;
  const db = await openDb();
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, "readwrite");
  for (const op of ops) {
    const os = tx.objectStore(op.store);
    if (op.put !== undefined) os.put(op.put);
    if (op.del !== undefined) os.delete(op.del);
  }
  return done(tx);
}

export async function put(store: StoreName, value: unknown): Promise<void> {
  return writeBatch([{ store, put: value }]);
}

export async function deleteDatabase(name = DB_NAME): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
