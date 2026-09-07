import type { Me } from "./api.js";
import { Icon } from "./Icon.js";
import { InvitePanel } from "./InvitePanel.js";
import { NewRoom } from "./NewRoom.js";
import { RoomList } from "./RoomList.js";
import { ThemeSwitch } from "./ThemeSwitch.js";
import type { Chat } from "./useChat.js";

/**
 * Боковая панель: где я и куда могу пойти.
 *
 * ВЫНЕСЕНА ИЗ ЭКРАНА не ради красоты. Во-первых, у `ChatScreen` получилось
 * три уровня условий поверх разметки, и линтер сложности был прав.
 * Во-вторых, файл перевалил за предел размера компонента, и гейт тоже был
 * прав: панель — отдельный вопрос, а не часть разговора.
 *
 * Все три раздела равны и переключаются одинаково.
 *
 * Раньше «Своя нейросеть» тоже переключала раздел, но была нарисована
 * кнопкой в подвале рядом с выходом. Одинаковое поведение выглядело
 * по-разному, и это учило не доверять виду. Теперь подключение подписки
 * лежит внутри «Агентов»: агент отвечает через мост позвавшего, значит
 * «агент молчит» и «мост погашен» — одно событие с двух сторон.
 */
export type Section = "talk" | "board" | "deals" | "agents";

/** Что написано на кнопке раздела и каким значком помечено. */
const PARTS: Array<{ id: Section; label: string; icon: "хэш" | "работа" | "модель" | "точка" }> = [
  { id: "talk", label: "Разговоры", icon: "хэш" },
  { id: "board", label: "Доска", icon: "работа" },
  // Счётчик висит здесь, а не на доске: он про то, что ЖДЁТ человека,
  // а доска показывает то, что уже в работе. Разные вопросы.
  { id: "deals", label: "Договорённости", icon: "точка" },
  { id: "agents", label: "Агенты", icon: "модель" },
];

/** Переключатель разделов. Счётчик — только у того, что ждёт человека. */
function Parts({
  section,
  onSwitch,
  pending,
}: {
  section: Section;
  onSwitch: (to: Section) => void;
  pending: number;
}) {
  return (
    <nav className="parts" aria-label="Разделы">
      {PARTS.map((part) => (
        <button
          key={part.id}
          type="button"
          className={section === part.id ? "part part-on" : "part"}
          aria-current={section === part.id ? "page" : undefined}
          onClick={() => onSwitch(part.id)}
        >
          <Icon name={part.icon} />
          {part.label}
          {/* Счётчик только у ждущих решения: подтверждённое внимания не
              требует, а метка на нём учит эту метку не замечать. */}
          {part.id === "deals" && pending > 0 ? (
            <span className="part-count">{pending}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

/** Середина экрана целиком: разговор, работа или подключение модели. */
/**
 * Боковая панель.
 *
 * Вынесена из `ChatScreen` не ради красоты: у того получилось три уровня
 * условий поверх разметки, и линтер сложности был прав — такое читается
 * только целиком. Панель отвечает на один вопрос: где я и куда могу пойти.
 */
export function Rail({
  me,
  chat,
  section,
  onSwitch,
  pending,
  onLeave,
}: {
  me: Me;
  chat: Chat;
  section: Section;
  onSwitch: (to: Section) => void;
  pending: number;
  onLeave: () => void;
}) {
  return (
    <aside className="rail">
      <h1>{me.workspace.name}</h1>
      <p className="who">{me.participant.displayName}</p>

      <Parts section={section} onSwitch={onSwitch} pending={pending} />

      {/* Содержимое ТЕКУЩЕГО раздела. Список каналов — навигация внутри
        «Разговоров», а не общая: в «Работе» и «Агентах» ему нечего
        делать, и его присутствие там сбивало прицел. */}
      {section === "talk" ? (
        <>
          <RoomList
            rooms={chat.conversations}
            currentId={chat.current?.id ?? null}
            onSelect={(id) => chat.select(id)}
          />
          <div className="rail-actions">
            <NewRoom label="+ Канал" placeholder="Название канала" onCreate={chat.addChannel} />
            {chat.current ? (
              <NewRoom label="+ Ветка" placeholder="О чём ветка" onCreate={chat.addThread} />
            ) : null}
          </div>
        </>
      ) : (
        <div className="rail-filler" />
      )}

      {/* Только настройки: три однородные вещи, ни одна не переключает
        раздел. Раньше здесь же стояла «Своя нейросеть», и подвал
        отвечал сразу на два разных вопроса. */}
      <div className="rail-foot">
        <ThemeSwitch />
        <InvitePanel />
        <button type="button" className="quiet rail-out" onClick={onLeave}>
          <Icon name="выход" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
