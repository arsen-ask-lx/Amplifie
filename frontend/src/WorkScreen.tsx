import type { Agreement, Citation } from "./api.js";
import { Board } from "./Board.js";
import { деньИЧас } from "./shared/when.js";
import type { Work } from "./useWork.js";
import { awaiting, quoteAddsNothing, refused, strays } from "./work.js";

/**
 * Экран работы: что агент услышал и что из этого стало задачей.
 *
 * Здесь человек делает единственное, чего за него не сделает никто, —
 * решает, была договорённость или нет. Поэтому экран устроен против
 * штамповки одобрений (А-2), а не ради скорости прожатия:
 *
 *   • цитата видна ВСЕГДА и рядом с кнопками. Не за раскрытием, не за
 *     наведением: то, что надо раскрывать, не читают;
 *   • «подтвердить» и «отклонить» одинакового веса. Крупная зелёная
 *     кнопка против серой ссылки — это подсказка, какой ответ правильный,
 *     а правильного ответа мы не знаем;
 *   • кнопки «подтвердить всё» нет и не будет. Она и есть штамповка,
 *     только оформленная как удобство.
 *
 * ⚠️ Меры против штамповки как таковой это НЕ заменяет: она в реестре
 * висит нерешённой (А-2). Это лишь отказ подталкивать в её сторону.
 */

/** Куда прыгать по цитате: разговор и место в нём. */
export type GoTo = (conversationId: string, seq: number) => void;

function Quote({
  citation,
  conversationId,
  goTo,
}: {
  citation: Citation;
  conversationId: string;
  goTo: GoTo;
}) {
  return (
    <blockquote className="cite">
      <p className="cite-text">{citation.quote}</p>
      <p className="cite-who">
        <span>{citation.authorName}</span>
        <button
          type="button"
          className="quiet cite-go"
          onClick={() => goTo(conversationId, citation.seq)}
        >
          Показать в разговоре
        </button>
      </p>
    </blockquote>
  );
}

/**
 * Основание предложения целиком.
 *
 * Цитат может не быть вовсе — и это не пустяк, а тревога: договорённость
 * без источника проверить нечем, и именно так выглядит выдуманная.
 */
function Grounds({
  text,
  citations,
  conversationId,
  goTo,
}: {
  text: string;
  citations: Citation[];
  conversationId: string;
  goTo: GoTo;
}) {
  if (citations.length === 0) {
    return <p className="cite-none">Агент не назвал, на чём это основано.</p>;
  }
  // Пока К3 не формулирует, цитата дословно повторяет договорённость.
  // Показывать одно и то же дважды — учить пролистывать источник.
  const repeats = citations.length === 1 && quoteAddsNothing(text, citations[0]?.quote ?? "");
  if (repeats) return null;

  return (
    <>
      {citations.map((citation) => (
        <Quote
          key={citation.messageId}
          citation={citation}
          conversationId={conversationId}
          goTo={goTo}
        />
      ))}
    </>
  );
}

function Waiting({ item, work, goTo }: { item: Agreement; work: Work; goTo: GoTo }) {
  const busy = work.deciding === item.id;
  const only = item.citations[0];

  return (
    <article className="deal">
      <p className="deal-text">{item.text}</p>

      <p className="deal-where">
        {/* Без глагола: имя агента склонять некому, а «услышал Сводка»
            читается как поломка. */}
        {item.conversationTitle} · агент «{item.proposedBy.name}» ·{" "}
        <time dateTime={item.createdAt}>{деньИЧас.format(new Date(item.createdAt))}</time>
      </p>

      <Grounds
        text={item.text}
        citations={item.citations}
        conversationId={item.conversationId}
        goTo={goTo}
      />

      <div className="deal-do">
        {/* Обе кнопки одного вида: экран не подсказывает правильный ответ. */}
        <button type="button" disabled={busy} onClick={() => void work.decide(item.id, "confirm")}>
          Подтвердить
        </button>
        <button type="button" disabled={busy} onClick={() => void work.decide(item.id, "reject")}>
          Отклонить
        </button>
        {only ? (
          <button
            type="button"
            className="quiet"
            onClick={() => goTo(item.conversationId, only.seq)}
          >
            Открыть разговор
          </button>
        ) : null}
      </div>
    </article>
  );
}

function Refused({ item, work }: { item: Agreement; work: Work }) {
  return (
    <article className="deal deal-off">
      <p className="deal-text">{item.text}</p>
      <p className="deal-where">
        {item.conversationTitle} ·{" "}
        {/* Отклонение обратимо: передумал — вернул, без машинерии отмены. */}
        <button
          type="button"
          className="quiet cite-go"
          disabled={work.deciding === item.id}
          onClick={() => void work.decide(item.id, "confirm")}
        >
          всё-таки подтвердить
        </button>
      </p>
    </article>
  );
}

/**
 * Доска задач — и НИЧЕГО больше.
 *
 * Договорённости отсюда убраны намеренно (владелец, 2026-09-07): доска
 * отвечает на один вопрос — «что в работе и на какой стадии». Очередь
 * решений отвечает на другой — «что я должен подтвердить». Смешанные,
 * они снова заставляли искать глазами, что здесь моё.
 */
export function BoardScreen({ work, meId }: { work: Work; meId: string }) {
  return (
    <div className="work">
      <section className="work-part board-part" aria-label="Доска">
        <Board
          tasks={work.tasks}
          people={work.people}
          meId={meId}
          onPatched={work.applyTask}
          onListChanged={work.reloadTasks}
        />
      </section>
    </div>
  );
}

/** Очередь решений: договорённости, которые ждут человека (К4). */
export function WorkScreen({ work, goTo }: { work: Work; goTo: GoTo }) {
  const wait = awaiting(work.agreements);
  const off = refused(work.agreements);
  const odd = strays(work.agreements);

  return (
    <div className="work">
      {work.failure ? <p className="err-top">{work.failure}</p> : null}

      <section className="work-part" aria-labelledby="ждут">
        <h3 id="ждут">Ждут решения {wait.length > 0 ? `· ${wait.length}` : ""}</h3>

        {work.loading ? <p className="feed-empty">Загружаем…</p> : null}

        {!work.loading && wait.length === 0 ? (
          <p className="feed-empty">
            Пока нечего решать. Агент не читает каналы сам — откройте разговор и нажмите «Разобрать»
            в его шапке.
          </p>
        ) : null}

        {wait.map((item) => (
          <Waiting key={item.id} item={item} work={work} goTo={goTo} />
        ))}
      </section>

      {off.length > 0 ? (
        <section className="work-part" aria-labelledby="отклонённые">
          <h3 id="отклонённые">Отклонённые · {off.length}</h3>
          {off.map((item) => (
            <Refused key={item.id} item={item} work={work} />
          ))}
        </section>
      ) : null}

      {odd.length > 0 ? (
        <section className="work-part" aria-labelledby="прочее">
          {/* Статус, которого экран не знает. Спрятать значило бы потерять. */}
          <h3 id="прочее">Прочее · {odd.length}</h3>
          {odd.map((item) => (
            <article key={item.id} className="deal deal-off">
              <p className="deal-text">{item.text}</p>
              <p className="deal-where">состояние «{item.status}» экрану незнакомо</p>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
