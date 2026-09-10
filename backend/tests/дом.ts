/**
 * Домашний проект пространства — тот, что завела регистрация (task-037).
 *
 * ⚠️ ОБЩИЙ ФАЙЛ, ХОТЯ ОСТАЛЬНЫЕ ПРИЁМОЧНЫЕ САМОДОСТАТОЧНЫ. Обычно
 * помощники живут внутри своего файла: так проверку читают целиком,
 * не прыгая по дереву. Здесь иначе — «где живёт чат» стало ОДНИМ
 * правилом продукта, и семь копий этого знания разошлись бы на первой
 * же правке: часть проверок завела бы чат не туда и молча позеленела.
 *
 * Бьёт по живому стеку, как и всё вокруг. Перед запуском: make up
 */
const BASE = process.env.AMPLIFIE_BASE_URL ?? "http://localhost:8477";

export async function домой(cookie: string): Promise<string> {
  const response = await fetch(`${BASE}/v1/conversations`, { headers: { cookie } });
  const тело = (await response.json()) as { items: { projectId: string | null }[] };
  const проект = тело.items.find((one) => one.projectId !== null)?.projectId;
  if (!проект) throw new Error("у пространства нет ни одного проекта — регистрация его не завела");
  return проект;
}
