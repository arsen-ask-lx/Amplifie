/**
 * ПРИЁМОЧНЫЙ ТЕСТ: дверь спрашивает, открыта ли регистрация (task-023).
 * Написан ДО кода и обязан быть красным.
 *
 * ЗАЧЕМ РУЧКА. Сегодня экран показывает «Создать новое пространство»
 * всегда — в том числе на сервере, где компания уже есть. Нажми,
 * заполни, отправь — получишь 403. Сервер знает ответ (`mayRegister`),
 * а сказать его некому.
 *
 * ⚠️ ЭТО НЕ УТЕЧКА. «На этом сервере уже есть компания» видно и сегодня:
 * по тому, что открывается вход, а не установка. Р-024 говорит об этом
 * прямо — скрывать нечего, зато человек узнаёт, что делать дальше.
 *
 * ⚠️ ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Случая «регистрация закрыта» на этом стенде
 * не бывает: `AMPLIFIE_MULTI_WORKSPACE=true`, иначе сотня приёмочных
 * мешала бы друг другу в одной компании. Само правило проверяет быстрый
 * тест `registration.test.ts`, а экран — подменой ответа в прогоне
 * по живому окну. Здесь проверяется другое: что ручка отвечает и что
 * её ответ СОВПАДАЕТ с тем, как поведёт себя регистрация.
 *
 * Вопросы к тестам — dock/tasks/task-023-мастер-первого-запуска.md §6.
 * Перед запуском: make up
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";
const PASSWORD = "правильный-конский-скотч-батарейка";

function freshEmail(): string {
  return `entry-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

describe("дверь: открыта ли регистрация", () => {
  it("отвечает без сессии", async () => {
    // Спрашивают до входа — печеньки ещё нет ни у кого.
    const response = await fetch(`${BASE}/v1/entry`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { registrationOpen?: unknown };
    expect(typeof body.registrationOpen).toBe("boolean");
  });

  it("ответ совпадает с тем, как поведёт себя регистрация", async () => {
    // Смысл ручки только в этом. Ручка, отвечающая своё, а не то, что
    // сделает сервер, хуже её отсутствия: экран покажет дверь уверенно
    // и уверенно приведёт в отказ.
    const asked = await fetch(`${BASE}/v1/entry`);
    const { registrationOpen } = (await asked.json()) as { registrationOpen: boolean };

    const tried = await fetch(`${BASE}/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: freshEmail(),
        password: PASSWORD,
        displayName: "Проверяющий дверь",
        workspaceName: "Пространство проверки двери",
      }),
    });

    expect(tried.status).toBe(registrationOpen ? 201 : 403);
  });
});
