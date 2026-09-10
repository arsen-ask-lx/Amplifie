import { $createLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { MenuOption } from "@lexical/react/LexicalMenuOption";
import {
  LexicalTypeaheadMenuPlugin,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode, type TextNode } from "lexical";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Person } from "../../data/api.js";

/**
 * Подсказка «кого позвать»: набрал `@` — выбрал человека (Р-031).
 *
 * ⚠️ НА ГОТОВОМ ПЛАГИНЕ РЕДАКТОРА, А НЕ СВОЁМ СПИСКЕ. Здесь дюжина
 * мелочей, каждая из которых ловится только руками: стрелки не должны
 * двигать курсор в тексте, Enter не должен отправлять сообщение,
 * Escape должен закрывать список, а не поле, список обязан ехать
 * за курсором при переносе строки. Всё это уже написано и проверено
 * в `LexicalTypeaheadMenuPlugin` — свой такой же был бы третьим местом,
 * где мы узнаём про эти мелочи по одной.
 *
 * ⚠️ ВЫБРАННОЕ СТАНОВИТСЯ УЗЛОМ ССЫЛКИ С АДРЕСОМ `@<номер>`. Не потому,
 * что это ссылка, а потому что превращение дерева обратно в строку уже
 * умеет ровно одно: `[подпись](адрес)` (`markupNodes.ts`). Заведи мы
 * ради упоминания свой узел — пришлось бы учить этому и превращение,
 * и разбор, и правку, то есть три места вместо нуля.
 */

/** Больше десятка в списке — это уже не подсказка, а справочник. */
const ПРЕДЕЛ = 10;

class Кандидат extends MenuOption {
  constructor(readonly человек: Person) {
    super(человек.id);
  }
}

/**
 * Кого можно позвать в этом разговоре.
 *
 * ⚠️ СПРАШИВАЕМ СЕРВЕР, А НЕ СЧИТАЕМ ПО ЛЕНТЕ. По ленте видны только те,
 * кто в ней говорил, — а позвать надо и молчавшего. Список зависит ещё
 * и от того, кто ВИДИТ этот разговор: в приватном канале звать можно
 * не всякого.
 *
 * ⚠️ СПРАШИВАЕМ В МОМЕНТ ОТКРЫТИЯ ПОДСКАЗКИ, А НЕ ПРИ ОТКРЫТИИ КАНАЛА.
 * Сперва было при открытии — и список застывал: вошедшего по ссылке
 * коллегу нельзя было позвать, пока не переключишь канал туда и обратно.
 * Поймано сценарием, где второй человек входит уже после того, как канал
 * открыт, — то есть ровно так, как это и бывает.
 */
function useЛюди(conversationId: string | null, открыта: boolean): Person[] {
  const [люди, setЛюди] = useState<Person[]>([]);

  useEffect(() => {
    if (!conversationId || !открыта) return;

    /**
     * ⚠️ ОТВЕТ НА ПРОШЛЫЙ КАНАЛ ВЫБРАСЫВАЕТСЯ. Человек переключает
     * каналы быстрее, чем отвечает сеть; без этого флажка в подсказке
     * оказались бы люди из канала, который он уже закрыл, — и в приватном
     * он предложил бы позвать того, кому туда нельзя.
     */
    let ушли = false;
    api
      .people(conversationId)
      .then((ответ) => {
        if (!ушли) setЛюди(ответ.items);
      })
      // Молча: подсказка — удобство, а не работа. Не приехала —
      // человек напишет имя словами, как писал вчера.
      .catch(() => {
        if (!ушли) setЛюди([]);
      });

    return () => {
      ушли = true;
    };
  }, [conversationId, открыта]);

  return люди;
}

/** Строка списка. Вид общий с меню канала: это одна и та же подсказка. */
function Строка({
  человек,
  выбран,
  onPick,
  onHover,
}: {
  человек: Person;
  выбран: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={выбран}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        // ⚠️ ИМЕННО `mousedown`, А НЕ `click`. Нажатие мышью по списку
        // сначала отнимает фокус у поля, и к моменту `click` выделение
        // в редакторе уже потеряно — вставлять упоминание некуда.
        event.preventDefault();
        onPick();
      }}
      className={[
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-body transition-colors",
        выбран ? "bg-selected text-ink" : "bg-transparent text-muted hover:text-ink",
      ].join(" ")}
    >
      <span className="truncate">{человек.name}</span>
      {человек.kind === "agent" ? (
        <span className="ml-auto text-mark text-muted">агент</span>
      ) : null}
    </button>
  );
}

export function Mentions({ conversationId }: { conversationId: string | null }) {
  const [editor] = useLexicalComposerContext();
  const [запрос, setЗапрос] = useState<string | null>(null);
  // Подсказка открыта ровно тогда, когда у неё есть запрос: закрываясь,
  // плагин присылает `null`.
  const люди = useЛюди(conversationId, запрос !== null);

  /**
   * ⚠️ `minLength: 0` — СПИСОК ОТКРЫВАЕТСЯ НА САМУ СОБАЧКУ. Иначе человек
   * обязан угадать, что надо набрать хотя бы букву, — а он не знает даже,
   * что список существует.
   */
  const триггер = useBasicTypeaheadTriggerMatch("@", { minLength: 0 });

  const подходящие = useMemo(() => {
    const искомое = (запрос ?? "").trim().toLowerCase();
    return люди
      .filter((one) => !искомое || one.name.toLowerCase().startsWith(искомое))
      .slice(0, ПРЕДЕЛ)
      .map((one) => new Кандидат(one));
  }, [люди, запрос]);

  /**
   * Поставить упоминание вместо набранного `@…`.
   *
   * ⚠️ ПРОБЕЛ ПОСЛЕ — ЧАСТЬ ДЕЛА, А НЕ ВЕЖЛИВОСТЬ. Без него курсор
   * остаётся ВНУТРИ узла ссылки, и следующее слово дописывается
   * в упоминание: «@Мария Петровапривет» одним куском, который уедет
   * на сервер как подпись зова.
   */
  const выбрать = useCallback(
    (кандидат: Кандидат, узел: TextNode | null, закрыть: () => void) => {
      editor.update(() => {
        const упоминание = $createLinkNode(`@${кандидат.человек.id}`);
        упоминание.append($createTextNode(кандидат.человек.name));
        if (узел) узел.replace(упоминание);
        const пробел = $createTextNode(" ");
        упоминание.insertAfter(пробел);
        пробел.select();
      });
      закрыть();
    },
    [editor],
  );

  if (!conversationId) return null;

  return (
    <LexicalTypeaheadMenuPlugin<Кандидат>
      options={подходящие}
      onQueryChange={setЗапрос}
      onSelectOption={(кандидат, узел, закрыть) => выбрать(кандидат, узел, закрыть)}
      triggerFn={триггер}
      /**
       * ⚠️ УЗЛУ ПЛАГИНА ОТБИРАЕМ РАЗМЕР И ВЫНИМАЕМ ЕГО ИЗ ПОТОКА.
       * Рисуем мы не в нём, но он всё равно создаётся и всё равно
       * ставится к каретке — а каретка стоит у нижнего края окна,
       * и пустой узел высотой в строку растягивал страницу на пять
       * точек. Полосы прокрутки хватает и пяти. `fixed` убирает узел
       * из потока, нули отбирают размер; восклицательные знаки
       * обязательны — плагин пишет `top`, `left` и `height` прямо
       * в стиль узла, а стиль сильнее класса.
       */
      anchorClassName="fixed! top-0! left-0! h-0! w-0! overflow-hidden!"
      menuRenderFn={(_якорь, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (подходящие.length === 0) return null;
        return (
          <div
            /**
             * ⚠️ СПИСОК ПРИВЯЗАН К ПОЛЮ, А НЕ К КУРСОРУ, И ЭТО ИСПРАВЛЕНИЕ
             * ПО ЗАМЕЧАНИЮ ВЛАДЕЛЬЦА. Плагин умеет ставить список у самой
             * каретки — для этого он кладёт свой узел в КОНЕЦ СТРАНИЦЫ
             * и двигает его в нужную точку. Узел в конце страницы её
             * растягивает: у окна появлялась боковая полоса прокрутки
             * и сдвигала весь интерфейс вбок, стоило нажать собачку.
             *
             * У Телеграма список тоже привязан к полю, а не к каретке:
             * панель над строкой ввода во всю её ширину. Значит и нам
             * не за курсором бегать — а рисовать прямо здесь, внутри
             * поля, где никакой страницы растягивать не надо.
             */
            className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-full max-w-xs overflow-y-auto rounded-lg border border-line bg-card p-1 shadow-float"
            role="listbox"
            aria-label="Кого позвать"
          >
            {подходящие.map((кандидат, i) => (
              <Строка
                key={кандидат.key}
                человек={кандидат.человек}
                выбран={i === selectedIndex}
                onHover={() => setHighlightedIndex(i)}
                onPick={() => selectOptionAndCleanUp(кандидат)}
              />
            ))}
          </div>
        );
      }}
    />
  );
}
