import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Node 25 ships an experimental WebStorage that installs a non-functional
// `localStorage` placeholder on globalThis (no `clear`/`getItem`/`setItem`).
// That stub blocks jsdom from putting its own working storage in place,
// so tests calling `localStorage.clear()` blow up with TypeError. We
// install a fresh in-memory Storage on every test to get isolation for
// free and decouple from whatever Node ships next.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(String(key), String(value));
  }
  removeItem(key: string) {
    this.store.delete(String(key));
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

function installStorage(name: "localStorage" | "sessionStorage") {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installStorage("localStorage");
  installStorage("sessionStorage");
});

afterEach(() => {
  cleanup();
});
