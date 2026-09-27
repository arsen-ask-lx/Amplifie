/**
 * ПРИЁМОЧНЫЙ ТЕСТ ЗАЩИТНЫХ ЗАГОЛОВКОВ (task-118, П-1, П-2, закрывает Д-35).
 * Написан ДО правки Caddy и обязан быть красным.
 *
 * Коробка ставится на чужой сервер. Без заголовков страницу можно встроить
 * в чужой сайт прозрачной рамкой, а внедрённый скрипт ничем не ограничен.
 * Проверяются ответы ЧЕРЕЗ CADDY — единственную дверь установки наружу:
 * страница, статика, API и здоровье.
 *
 * Бьёт по живому стеку. Перед запуском: make up
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, requireStand } from "./stand.js";

/** Директивы политики — словарём: порядок в заголовке не важен. */
function policyOf(header: string | null): Map<string, string> {
  const rules = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/u);
    if (name) rules.set(name, values.join(" "));
  }
  return rules;
}

async function headersOf(path: string): Promise<Headers> {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
  // ⚠️ В `make work` на этом порту Vite, а не Caddy: заголовков там нет
  // и не будет — их ставит только собранная установка.
  expect(
    response.headers.get("x-amplifie-frontend"),
    "отвечает не собранный Caddy (режим make work?) — подними make up",
  ).toBe("caddy-static");
  return response.headers;
}

describe("защитные заголовки установки", () => {
  beforeAll(requireStand);

  for (const path of ["/", "/c/какой-то-чат", "/favicon.svg", "/v1/me", "/health"]) {
    it(`П-1, П-2: ${path} — рамка запрещена, чужие скрипты и адреса закрыты`, async () => {
      const headers = await headersOf(path);
      const policy = policyOf(headers.get("content-security-policy"));

      expect(policy.get("default-src")).toBe("'self'");
      expect(policy.get("script-src"), "чужой или встроенный скрипт выполнится").toBe("'self'");
      expect(policy.get("connect-src"), "скрипт отправит данные на чужой адрес").toBe("'self'");
      expect(policy.get("frame-ancestors"), "страницу встроят в чужой сайт").toBe("'none'");
      expect(policy.get("object-src")).toBe("'none'");
      expect(policy.get("base-uri")).toBe("'self'");
      expect(policy.get("form-action")).toBe("'self'");

      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("x-frame-options")).toBe("DENY");
      // Закрытый контур фирмы: адрес страницы не уходит по ссылкам из чата.
      expect(headers.get("referrer-policy")).toBe("same-origin");
      expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(policy.get("font-src"), "вшитый шрифт кириллицы").toBe("'self' data:");
      expect(headers.get("permissions-policy")).toContain("camera=()");
      expect(headers.get("permissions-policy")).toContain("microphone=()");
      expect(headers.get("server"), "сервер называет себя").toBeNull();
    });
  }

  it("кеш: страница — «спроси», собранные файлы — на год, отсутствующий файл — 404", async () => {
    const page = await fetch(`${BASE}/`);
    expect(page.headers.get("cache-control")).toBe("no-cache");
    const script = /\/assets\/index-[^"]+\.js/u.exec(await page.text())?.[0];
    // Форма имени сборки Vite: `index-<хеш>.js`, хеш — латиница, цифры, `_`, `-`.
    expect(script, "в странице нет собранного скрипта").toMatch(
      /^\/assets\/index-[A-Za-z0-9_-]+\.js$/u,
    );

    const asset = await fetch(`${BASE}${script}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    // Вкладка, открытая до обновления, просит удалённый файл: HTML вместо
    // скрипта давал белый экран, 404 — честный отказ.
    const gone = await fetch(`${BASE}/assets/index-удалён.js`);
    expect(gone.status).toBe(404);
  });
});
