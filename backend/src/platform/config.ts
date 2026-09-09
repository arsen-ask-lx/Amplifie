/**
 * Единственное место, где читается окружение (12-factor).
 * Всё остальное приложение получает конфиг отсюда, а не из process.env.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}. См. .env.example`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  port: Number(process.env.API_PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? "info",
  isProduction: process.env.NODE_ENV === "production",
  /**
   * Можно ли держать несколько компаний на одной установке (Р-024).
   *
   * ⚠️ ПО УМОЛЧАНИЮ НЕЛЬЗЯ. Продукт — коробка: одна установка, одна
   * компания, и все, кроме первого, входят по приглашению. Разрешение
   * нужно только нашему стенду, где сотня приёмочных заводит себе
   * по компании; `compose.yml` ставит его вслух.
   *
   * Настройка, которую забудут, обязана быть безопасной, — поэтому
   * «включено» требует явного слова, а не отсутствия слова.
   */
  multiWorkspace: process.env.AMPLIFIE_MULTI_WORKSPACE === "true",
} as const;
