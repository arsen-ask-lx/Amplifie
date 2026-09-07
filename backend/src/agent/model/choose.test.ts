/**
 * Проверки выбора провайдера.
 *
 * Главное здесь не «выбирает правильно», а границы Р-012: команда
 * не должна приходить из данных, а подписочный токен не должен
 * оказаться в поле ключа.
 */

import { ProviderUnavailableError } from "@amplifie/model";
import { describe, expect, it } from "vitest";
import { chooseProvider, KNOWN_PROVIDERS } from "./choose.js";

describe("выбор провайдера", () => {
  it("модель не подключена — это законное состояние, а не ошибка", () => {
    // Продукт работает и без модели, на правилах, и говорит об этом прямо.
    expect(chooseProvider({})).toBeNull();
    expect(chooseProvider({ AMPLIFIE_MODEL: "   " })).toBeNull();
  });

  it("подписочные клиенты помечены как подписка, ключевые — как ключ", () => {
    expect(chooseProvider({ AMPLIFIE_MODEL: "claude-cli" })?.billing).toBe("subscription");
    expect(chooseProvider({ AMPLIFIE_MODEL: "codex-cli" })?.billing).toBe("subscription");
    expect(
      chooseProvider({ AMPLIFIE_MODEL: "anthropic-api", AMPLIFIE_MODEL_KEY: "к" })?.billing,
    ).toBe("api");
  });

  it("ключевой провайдер без ключа отказывается и объясняет почему", () => {
    expect(() => chooseProvider({ AMPLIFIE_MODEL: "anthropic-api" })).toThrow(
      ProviderUnavailableError,
    );
    // В объяснении названа граница: подписочный токен сюда нельзя.
    try {
      chooseProvider({ AMPLIFIE_MODEL: "anthropic-api" });
    } catch (error) {
      expect((error as Error).message).toContain("Р-012");
    }
  });

  it("неизвестное имя не молчит, а перечисляет годные", () => {
    try {
      chooseProvider({ AMPLIFIE_MODEL: "нейросеть-мечты" });
      throw new Error("должно было отказать");
    } catch (error) {
      const said = (error as Error).message;
      for (const known of KNOWN_PROVIDERS) expect(said).toContain(known);
    }
  });

  it("список провайдеров непустой и без повторов", () => {
    expect(KNOWN_PROVIDERS.length).toBeGreaterThan(0);
    expect(new Set(KNOWN_PROVIDERS).size).toBe(KNOWN_PROVIDERS.length);
  });
});
