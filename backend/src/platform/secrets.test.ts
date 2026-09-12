/**
 * Быстрые проверки шифрования секретов (Р-016).
 *
 * Написаны ДО кода. Здесь проверяется не «шифрует ли» — это сделает любая
 * библиотека, — а три свойства, ради которых Р-016 и писалось:
 *   ① порча шифротекста ПАДАЕТ, а не отдаёт мусор вместо ключа;
 *   ② шифротекст, перенесённый в чужую строку, не расшифровывается;
 *   ③ версия ключа едет вместе с записью, иначе смену ключа не пережить.
 */
import { describe, expect, it } from "vitest";
import { open, type Sealed, seal } from "./secrets.js";

/** Мастер-ключ для тестов. Боевой сюда не попадает никогда. */
const MASTER = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 9).toString("base64");

const KEY = "sk-ant-api03-очень-секретное-значение";

/** Привязка к строке: пространство, участник, поставщик. */
const HERE = { workspaceId: "w-1", ownerId: "p-1", provider: "anthropic" };
const THERE = { workspaceId: "w-1", ownerId: "p-2", provider: "anthropic" };

const keys = { current: { version: 1, secret: MASTER } };

describe("шифрование секрета", () => {
  it("что зашифровали, то и расшифровали", () => {
    const sealed = seal(KEY, HERE, keys);
    expect(open(sealed, HERE, keys)).toBe(KEY);
  });

  it("шифротекст не содержит исходного ключа", () => {
    const sealed = seal(KEY, HERE, keys);
    expect(JSON.stringify(sealed)).not.toContain("секретное");
    expect(JSON.stringify(sealed)).not.toContain(KEY);
  });

  it("два шифрования одного значения дают разный шифротекст", () => {
    // Одинаковый шифротекст выдал бы, что у двоих один и тот же ключ.
    const a = seal(KEY, HERE, keys);
    const b = seal(KEY, HERE, keys);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("испорченный шифротекст падает, а не отдаёт мусор", () => {
    const sealed = seal(KEY, HERE, keys);
    const broken: Sealed = { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -4)}AAAA` };
    expect(() => open(broken, HERE, keys)).toThrow();
  });

  it("шифротекст из чужой строки не расшифровывается", () => {
    // Без этого администратор базы подставил бы свой ключ другому
    // участнику и заставил его платить.
    const sealed = seal(KEY, HERE, keys);
    expect(() => open(sealed, THERE, keys)).toThrow();
  });

  it("смена поставщика в той же строке тоже ломает расшифровку", () => {
    const sealed = seal(KEY, HERE, keys);
    expect(() => open(sealed, { ...HERE, provider: "openai" }, keys)).toThrow();
  });

  it("чужим мастер-ключом не открывается", () => {
    const sealed = seal(KEY, HERE, keys);
    const alien = { current: { version: 1, secret: OTHER } };
    expect(() => open(sealed, HERE, alien)).toThrow();
  });

  it("версия едет вместе с записью", () => {
    const sealed = seal(KEY, HERE, keys);
    expect(sealed.version).toBe(1);
  });

  it("старая запись читается прежним ключом после смены мастер-ключа", () => {
    // Порядок из Р-016: новый шифрует, старый ещё расшифровывает.
    const sealed = seal(KEY, HERE, keys);
    const rotated = {
      current: { version: 2, secret: OTHER },
      previous: { version: 1, secret: MASTER },
    };
    expect(open(sealed, HERE, rotated)).toBe(KEY);
    expect(seal(KEY, HERE, rotated).version).toBe(2);
  });

  it("запись неизвестной версии падает внятно, а не молча", () => {
    const sealed = seal(KEY, HERE, keys);
    const alien: Sealed = { ...sealed, version: 99 };
    expect(() => open(alien, HERE, keys)).toThrow(/верси/iu);
  });
});
