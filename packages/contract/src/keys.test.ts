import { describe, expect, it } from "vitest";
import { keyBody, registerBody, sendBody } from "./api.js";
import { KEY_SHAPES } from "./keys.js";

/**
 * Правила договора, которые видит описание API (task-120): форма ключа по
 * поставщику, адрес почты по RFC и запрет нулевого символа в тексте.
 */
describe("договор: вход двери отвергает то, что сервер не примет", () => {
  const long = "x".repeat(40);

  it("ключ — по форме своего поставщика", () => {
    expect(keyBody.safeParse({ provider: "anthropic", key: `sk-ant-${long}` }).success).toBe(true);
    expect(keyBody.safeParse({ provider: "openai", key: `sk-${long}` }).success).toBe(true);
    // Ключ openai под anthropic — не та форма, хоть и начинается с «sk-».
    const wrong = keyBody.safeParse({ provider: "anthropic", key: `sk-${long}` });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.message).toBe("ключ anthropic начинается с «sk-ant-»");
    // Длина — наименьшая из правила, а не выдуманная здесь.
    const short = `sk-ant-${"x".repeat(KEY_SHAPES.anthropic.least - 8)}`;
    expect(keyBody.safeParse({ provider: "anthropic", key: short }).success).toBe(false);
  });

  it("почта — части домена без дефиса на краю, не длиннее 254", () => {
    const person = { password: "x".repeat(12), displayName: "П", workspaceName: "П" };
    expect(registerBody.safeParse({ ...person, email: "man@edge.example.com" }).success).toBe(true);
    expect(registerBody.safeParse({ ...person, email: "man@edge-.example.com" }).success).toBe(
      false,
    );
    const huge = `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.com`;
    expect(registerBody.safeParse({ ...person, email: huge }).success).toBe(false);
  });

  it("нулевой символ в тексте — отказ, прочие знаки — нет", () => {
    const base = { clientMsgId: crypto.randomUUID() };
    expect(sendBody.safeParse({ ...base, body: "строка\nс переносом\tи табом" }).success).toBe(
      true,
    );
    const nul = sendBody.safeParse({ ...base, body: `до${String.fromCharCode(0)}после` });
    expect(nul.success).toBe(false);
    expect(nul.error?.issues[0]?.message).toBe("в тексте недопустим нулевой символ");
  });
});
