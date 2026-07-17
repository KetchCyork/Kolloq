import type { AgentSession } from "./types";

const DB_NAME = "newvector-cowork";
const DB_VERSION = 1;
const STORE = "sessions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadAllSessions(): Promise<AgentSession[]> {
  const sessions = await withStore<AgentSession[]>("readonly", (store) => store.getAll());
  return sessions.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putSession(session: AgentSession): Promise<void> {
  await withStore("readwrite", (store) => store.put(session));
}

export async function deleteSession(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function putAllSessions(sessions: AgentSession[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore(STORE);
      for (const session of sessions) store.put(session);
    });
  } finally {
    db.close();
  }
}
