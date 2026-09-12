import { afterEach, describe, expect, it, vi } from "vitest";
import { chosen } from "./theme.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function browser(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: dark,
    addEventListener: vi.fn((_: "change", listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_: "change", listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    switchTo(nextDark: boolean) {
      media.matches = nextDark;
      for (const listener of listeners) listener({ matches: nextDark } as MediaQueryListEvent);
    },
  };
  const storage = new MemoryStorage();
  const document = { documentElement: { dataset: {} as DOMStringMap } };

  vi.stubGlobal("window", { matchMedia: vi.fn(() => media) });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("document", document);
  return { document, media, storage };
}

afterEach(() => vi.unstubAllGlobals());

describe("выбор темы", () => {
  it.each(["алая", "малина"])("переводит исключённую старую тему %s в ночь", (legacy) => {
    const { storage } = browser(false);
    storage.setItem("amplifie.тема", legacy);

    expect(chosen()).toBe("ночь");
    expect(storage.getItem("amplifie.тема")).toBe("ночь");
  });

  it("переводит старый системный выбор в светлую тему", () => {
    const { storage } = browser(false);
    storage.setItem("amplifie.тема", "системная");

    expect(chosen()).toBe("светлая");
    expect(storage.getItem("amplifie.тема")).toBe("светлая");
  });
});
