/**
 * Шапка двери: заголовок, строка под ним и полоска отказа.
 *
 * ⚠️ ОДНА НА ВСЕ ДВЕРИ, ПОТОМУ ЧТО ЭТО ОДНО ОБЕЩАНИЕ ЧЕЛОВЕКУ. Вход,
 * установка и вход по приглашению говорят разные слова, но говорят их
 * ОДИНАКОВО: крупная строка, пояснение под ней, и — если не пустили —
 * красная полоска ровно там же. Разъедься эти три места, и человек,
 * перешедший с одной двери на другую, увидит, что попал в другой продукт.
 *
 * ⚠️ ПОЛОСКА ОТКАЗА ЖИВЁТ ЗДЕСЬ, А НЕ У ПОЛЯ. Отказ бывает общий —
 * «неверная почта или пароль», — и привязать его к одному из полей
 * значило бы соврать, какое из них не то. Отказы отдельных полей
 * показывает сам `Field`.
 */
export function EntryHead({
  title,
  subtitle,
  trouble,
}: {
  title: string;
  subtitle: string;
  /** Общий отказ. `null` — всё в порядке. */
  trouble: string | null;
}) {
  return (
    <>
      <h1 className="mb-1 text-brand leading-tight text-ink">{title}</h1>
      <p className="mt-2 mb-6 text-body leading-relaxed text-muted">{subtitle}</p>

      {trouble ? (
        <div className="mb-3 rounded border border-danger/40 bg-panel px-3 py-2 text-aside text-danger">
          {trouble}
        </div>
      ) : null}
    </>
  );
}
