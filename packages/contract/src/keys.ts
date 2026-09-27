/**
 * Каким бывает ключ поставщика — грубо: префикс и наименьшая длина.
 *
 * Общее знание, потому что его читают двое: схема двери (её видит описание
 * API, task-120) и ядро, которое проверяет ключ перед записью. Прежде правило
 * жило только в ядре, и Schemathesis честно называл отказ «отвергнутым верным
 * запросом»: по описанию ключ `0` был допустим.
 *
 * Точную форму знает только поставщик, и гнаться за ней значит однажды
 * отвергнуть законный ключ нового поколения.
 */
export const KEY_SHAPES = {
  anthropic: { prefix: "sk-ant-", least: 20 },
  openai: { prefix: "sk-", least: 20 },
} as const;

export type KeyProvider = keyof typeof KEY_SHAPES;

/** Слова отказа — одни на схему и ядро. Ни куска ключа, ни его длины. */
export function keyShapeMessage(provider: KeyProvider): string {
  return `ключ ${provider} начинается с «${KEY_SHAPES[provider].prefix}»`;
}
