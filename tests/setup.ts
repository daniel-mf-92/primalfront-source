// Add global mocks or configuration here if needed
import "vitest-canvas-mock";

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function installLocalStorageFallback(): void {
  const storage = makeMemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
}

const runtimeLocalStorage = globalThis.localStorage;
if (
  runtimeLocalStorage === undefined ||
  typeof runtimeLocalStorage.getItem !== "function" ||
  typeof runtimeLocalStorage.setItem !== "function"
) {
  installLocalStorageFallback();
}
