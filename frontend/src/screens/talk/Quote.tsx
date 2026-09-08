import type { Quote as Цитата } from "../../data/api.js";

/**
 * Цитата: на что отвечает реплика.
 *
 * ОДИН ВИД НА ДВА МЕСТА — внутри пузыря и над полем ввода. Разные было бы
 * честно ровно один день: потом одно поправят, другое забудут, и человек
 * перестанет узнавать в отправленном то, что видел перед отправкой.
 *
 * ⚠️ ПОЛОСКА СЛЕВА, А НЕ РАМКА ВОКРУГ. Рамка читается как отдельная
 * карточка и спорит с самим пузырём за внимание; полоска говорит
 * «это относится к тому, что ниже» и молчит. Так в Телеграме и в почте.
 *
 * Текста ровно столько, сколько прислал сервер: резать здесь значило бы
 * завести вторую меру длины, и однажды они разойдутся.
 */
export function Quote({
  quote,
  onGo,
  tone = "обычный",
}: {
  quote: Цитата;
  /** Куда вести по щелчку. Нет — цитата не нажимается (над полем ввода). */
  onGo?: (() => void) | undefined;
  /** «на заливке» — цитата внутри своего пузыря, где фон плотный. */
  tone?: "обычный" | "на заливке";
}) {
  const soft = tone === "на заливке";
  const body = (
    <span
      className={[
        "flex flex-col gap-0.5 border-l-2 py-0.5 pl-2 text-left",
        soft ? "border-ink-on-soft/40" : "border-accent",
      ].join(" ")}
    >
      <span
        className={[
          "truncate text-mark font-medium",
          soft ? "text-ink-on-soft" : "text-accent-ink",
        ].join(" ")}
      >
        {quote.author}
      </span>
      <span
        className={["truncate text-aside", soft ? "text-muted-on-soft" : "text-muted"].join(" ")}
      >
        {quote.excerpt}
      </span>
    </span>
  );

  if (!onGo) return <span className="block min-w-0">{body}</span>;

  return (
    <button
      type="button"
      onClick={onGo}
      title="Перейти к сообщению"
      className="mb-1 block w-full min-w-0 cursor-pointer rounded-sm bg-transparent p-0 transition-opacity hover:opacity-80"
    >
      {body}
    </button>
  );
}
