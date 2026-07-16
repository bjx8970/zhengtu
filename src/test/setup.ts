/// <reference types="vitest/globals" />
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@solidjs/testing-library';

afterEach(cleanup);

const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  },
  writable: true,
});

if (typeof HTMLDialogElement === 'undefined') {
  (globalThis as Record<string, unknown>).HTMLDialogElement = class {
    showModal() {}
    close() {}
  } as unknown as typeof HTMLDialogElement;
}
