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

/** `chosen` читает только хранилище — подделывается ровно оно. */
function browser() {
  const storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  return { storage };
}

afterEach(() => vi.unstubAllGlobals());

describe("выбор темы", () => {
  it.each(["алая", "малина"])("переводит исключённую старую тему %s в ночь", (legacy) => {
    const { storage } = browser();
    storage.setItem("amplifie.тема", legacy);

    expect(chosen()).toBe("ночь");
    expect(storage.getItem("amplifie.тема")).toBe("ночь");
  });

  it("переводит старый системный выбор в светлую тему", () => {
    const { storage } = browser();
    storage.setItem("amplifie.тема", "системная");

    expect(chosen()).toBe("светлая");
    expect(storage.getItem("amplifie.тема")).toBe("светлая");
  });
});
