import type { Account, AgentSession, CouncilSession, Project } from "./types";

const DB_NAME = "newvector-cowork";
// v3 -> v4 adds the projects store and its sibling projectFolders store (below); existing
// stores and their contents are untouched, so upgrading databases keep every session working
// exactly as before.
const DB_VERSION = 4;
const STORE = "sessions";
const ACCOUNTS_STORE = "accounts";
const COUNCIL_STORE = "councilSessions";
const PROJECTS_STORE = "projects";
// Directory handles aren't JSON-safe (they can't go through SessionExportFile), so they're kept
// out of the `projects` record and stored in their own object store, keyed by project id.
const PROJECT_FOLDERS_STORE = "projectFolders";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ACCOUNTS_STORE)) {
        db.createObjectStore(ACCOUNTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(COUNCIL_STORE)) {
        db.createObjectStore(COUNCIL_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PROJECT_FOLDERS_STORE)) {
        db.createObjectStore(PROJECT_FOLDERS_STORE, { keyPath: "projectId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withNamedStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadAllSessions(): Promise<AgentSession[]> {
  const sessions = await withNamedStore<AgentSession[]>(STORE, "readonly", (store) => store.getAll());
  return sessions.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putSession(session: AgentSession): Promise<void> {
  await withNamedStore(STORE, "readwrite", (store) => store.put(session));
}

export async function deleteSession(id: string): Promise<void> {
  await withNamedStore(STORE, "readwrite", (store) => store.delete(id));
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

export async function loadAllAccounts(): Promise<Account[]> {
  const accounts = await withNamedStore<Account[]>(ACCOUNTS_STORE, "readonly", (store) => store.getAll());
  return accounts.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putAccount(account: Account): Promise<void> {
  await withNamedStore(ACCOUNTS_STORE, "readwrite", (store) => store.put(account));
}

export async function deleteAccount(id: string): Promise<void> {
  await withNamedStore(ACCOUNTS_STORE, "readwrite", (store) => store.delete(id));
}

export async function loadAllCouncilSessions(): Promise<CouncilSession[]> {
  const sessions = await withNamedStore<CouncilSession[]>(COUNCIL_STORE, "readonly", (store) => store.getAll());
  return sessions.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putCouncilSession(session: CouncilSession): Promise<void> {
  await withNamedStore(COUNCIL_STORE, "readwrite", (store) => store.put(session));
}

export async function deleteCouncilSession(id: string): Promise<void> {
  await withNamedStore(COUNCIL_STORE, "readwrite", (store) => store.delete(id));
}

export async function putAllCouncilSessions(sessions: CouncilSession[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COUNCIL_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore(COUNCIL_STORE);
      for (const session of sessions) store.put(session);
    });
  } finally {
    db.close();
  }
}

export async function loadAllProjects(): Promise<Project[]> {
  const projects = await withNamedStore<Project[]>(PROJECTS_STORE, "readonly", (store) => store.getAll());
  return projects.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putProject(project: Project): Promise<void> {
  await withNamedStore(PROJECTS_STORE, "readwrite", (store) => store.put(project));
}

export async function deleteProject(id: string): Promise<void> {
  await withNamedStore(PROJECTS_STORE, "readwrite", (store) => store.delete(id));
  await withNamedStore(PROJECT_FOLDERS_STORE, "readwrite", (store) => store.delete(id));
}

/** `handle` is a `FileSystemDirectoryHandle` (see fileSystemAccess.d.ts) — typed as `unknown` here
 * so db.ts doesn't need the ambient DOM augmentation just to pass it through to IndexedDB. */
export async function putProjectFolderHandle(projectId: string, handle: unknown): Promise<void> {
  await withNamedStore(PROJECT_FOLDERS_STORE, "readwrite", (store) => store.put({ projectId, handle }));
}

export async function loadProjectFolderHandle(projectId: string): Promise<unknown | undefined> {
  const record = await withNamedStore<{ projectId: string; handle: unknown } | undefined>(
    PROJECT_FOLDERS_STORE,
    "readonly",
    (store) => store.get(projectId),
  );
  return record?.handle;
}

export async function deleteProjectFolderHandle(projectId: string): Promise<void> {
  await withNamedStore(PROJECT_FOLDERS_STORE, "readwrite", (store) => store.delete(projectId));
}
