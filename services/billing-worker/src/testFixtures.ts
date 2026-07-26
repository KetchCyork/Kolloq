/** Minimal in-memory stand-in for the subset of KVNamespace this service actually uses. */
export function createInMemoryKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    _store: store,
  };
}
