/**
 * СТРАННЫЙ ВВОД У ДВЕРЕЙ (task-120). Всё найдено Schemathesis и разбором после него.
 *
 * - Вход с `{"email": {}}` падал в 500: ключ порога частоты считается ДО схемы
 *   и звал `.trim()` у объекта.
 * - Регистрация принимала адрес с дефисом на краю части домена и длиннее
 *   254 знаков — описание API обещает формат `email`, а дверь его не держала.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { call, newPerson, PASSWORD, requireStand } from "./stand.js";

describe("странный ввод у дверей входа", () => {
  beforeAll(requireStand);

  it("С-1: почта объектом на входе — 422, а не 500", async () => {
    const response = await call("POST", "/v1/auth/login", undefined, {
      email: {},
      password: "что-то",
    });
    expect(response.status).toBe(422);
  });

  it("С-2: адрес, которого не бывает, при регистрации — 422", async () => {
    const register = (email: string) =>
      call("POST", "/v1/auth/register", undefined, {
        email,
        password: PASSWORD,
        displayName: "Проба",
        workspaceName: "Проба",
      });
    for (const email of [
      "man@edge-.example.com",
      `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.com`,
    ]) {
      const response = await register(email);
      expect(response.status, email.slice(0, 30)).toBe(422);
    }
  });

  it("С-3: число вместо строки у моста и у проверки модели — 422, а не 500", async () => {
    // Тела проверялись руками, и `.trim()` у числа ронял дверь.
    const join = await call("POST", "/v1/bridge/join", undefined, { code: 5, name: "машина" });
    expect(join.status).toBe(422);

    const owner = await newPerson("Хозяин");
    const check = await call("POST", "/v1/model/check", owner, { prompt: 5 });
    expect(check.status).toBe(422);
  });
});
