/**
 * Быстрые проверки сборки подсказки.
 *
 * Главное здесь — поведение на границе бюджета. Приёмочный тест видит,
 * что в подсказку попал нужный разговор; он НЕ видит, что происходит,
 * когда лента длиннее бюджета, — а именно там теряется вопрос, если
 * резать не с того конца.
 */
import { describe, expect, it } from "vitest";
import { buildPrompt, type Turn } from "./prompt.js";

const turn = (body: string, authorName = "Пётр", authorKind = "human"): Turn => ({
  body,
  authorName,
  authorKind,
});

describe("сборка подсказки", () => {
  it("каждая строка подписана автором", () => {
    const prompt = buildPrompt([turn("привет", "Аня")]);
    expect(prompt).toBe("Аня: привет");
  });

  it("агент подписан как агент", () => {
    // Иначе модель не отличит свои прошлые слова от чужих.
    const prompt = buildPrompt([turn("итог такой", "Сводка", "agent")]);
    expect(prompt).toContain("Сводка (агент): итог такой");
  });

  it("порядок чтения сохраняется: старое сверху, вопрос снизу", () => {
    // Вход — в порядке чтения, ровно как отдаёт listMessages (rows.reverse()).
    const prompt = buildPrompt([turn("первое"), turn("второе"), turn("третье")]);
    expect(prompt).toBe("Пётр: первое\nПётр: второе\nПётр: третье");
  });

  it("при переполнении бюджета теряется старое, а не вопрос", () => {
    const feed = [turn("совсем старое"), turn("х".repeat(500)), turn("вопрос к агенту")];
    const prompt = buildPrompt(feed, 60);

    expect(prompt).toContain("вопрос к агенту");
    expect(prompt).not.toContain("совсем старое");
  });

  it("подсказка не длиннее бюджета", () => {
    const feed = Array.from({ length: 200 }, (_, i) => turn(`реплика номер ${i}`));
    expect(buildPrompt(feed, 300).length).toBeLessThanOrEqual(300);
  });

  it("реплика, не влезающая целиком, не попадает обрывком", () => {
    // Обрывок хуже отсутствия: модель достроит смысл по половине фразы.
    const prompt = buildPrompt([turn("х".repeat(1000))], 100);
    expect(prompt).toBe("");
  });

  it("пустая лента даёт пустую подсказку, а не падение", () => {
    expect(buildPrompt([])).toBe("");
  });
});
