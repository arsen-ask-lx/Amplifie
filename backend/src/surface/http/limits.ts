import type { FastifyRequest } from "fastify";
import { config } from "../../platform/config.js";

/**
 * Пороги частоты у дверей. Почему каждое число такое — таблица в Р-025;
 * здесь только числа и ключи, чтобы они не разъехались по маршрутам.
 *
 * Счёт по адресу честен только потому, что в `app.ts` включён `trustProxy`:
 * без него все запросы пришли бы с адреса Caddy, и компания делила бы
 * один счётчик.
 */

/**
 * Кто спрашивает — по печеньке сессии, без похода в базу. Это различение,
 * а не проверка права (её делает вход дальше по пути): поход в базу
 * до порога сделал бы каждую попытку перебора запросом к базе.
 */
function whoRoughly(request: FastifyRequest): string {
  const session = request.cookies?.amplifie_session;
  return session ? `s:${session}` : `ip:${request.ip}`;
}

/**
 * На стенде пороги по адресу выше: сотня приёмочных приходит с одного
 * адреса и регистрирует себе по компании. Цена: боевые значения этих двух
 * порогов тестами не проверяются.
 */
const onStand = config.multiWorkspace;

export const OVERALL = { max: onStand ? 5000 : 300, timeWindow: "1 minute" } as const;

/**
 * Ключ — пара «почта и адрес»: по одному адресу сосед по офису отнимал бы
 * попытки, по одной почте подбор с тысячи адресов шёл бы даром. Почта
 * не проверяется на существование — порог не должен её выдавать.
 */
export const LOGIN = {
  max: 5,
  timeWindow: "1 minute",
  keyGenerator: (request: FastifyRequest) => {
    const email = (request.body as { email?: string } | null)?.email ?? "";
    return `login:${email.trim().toLowerCase()}:${request.ip}`;
  },
} as const;

export const REGISTER = { max: onStand ? 500 : 3, timeWindow: "1 hour" } as const;

/** Сторожит расход процессора на argon2, а не перебор токена (Р-025). */
export const JOIN = { max: onStand ? 500 : 30, timeWindow: "1 minute" } as const;

export const INVITE = {
  max: 20,
  timeWindow: "1 hour",
  keyGenerator: whoRoughly,
} as const;

export const SEND = {
  max: 30,
  timeWindow: "1 minute",
  keyGenerator: whoRoughly,
} as const;

/** Самый горячий путь: клиент зовёт догон на каждое событие пространства. */
export const SYNC = {
  max: 600,
  timeWindow: "1 minute",
  keyGenerator: whoRoughly,
} as const;

/**
 * Отметку шлёт не рука, а глаз: клиент сам, пачкой раз в три секунды
 * (Р-029), по каждому каналу и вкладке. 20 разговоров × 2 вкладки — до 800
 * в минуту в худшем случае; 300 задевают только листающего всё разом.
 */
export const READ = {
  max: 300,
  timeWindow: "1 minute",
  keyGenerator: whoRoughly,
} as const;

/** Подключение к потоку, а не сам поток: открытый живёт часами. */
export const STREAM = {
  max: 10,
  timeWindow: "1 minute",
  keyGenerator: whoRoughly,
} as const;
