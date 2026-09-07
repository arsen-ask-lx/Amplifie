import { Link } from "react-router";
import type { Me } from "../data/api.js";
import type { Chat } from "../data/useChat.js";
import { Icon } from "../shared/Icon.js";
import { InvitePanel } from "./InvitePanel.js";
import { NewRoom } from "./NewRoom.js";
import { RoomList } from "./RoomList.js";
import { ThemeSwitch } from "./ThemeSwitch.js";

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

/**
 * Раздел, его адрес, подпись и значок.
 *
 * ⚠️ АДРЕС ЗДЕСЬ — ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ О ТОМ, ГДЕ ЧЕЛОВЕК (Р-019).
 * До task-012 раздел жил в `useState` у экрана: ссылку дать было нечем,
 * «назад» выкидывал из приложения, а F5 возвращал в «Разговоры».
 */
const PARTS: Array<{
  id: Section;
  path: string;
  label: string;
  icon: "хэш" | "работа" | "модель" | "точка";
}> = [
  { id: "talk", path: "/", label: "Разговоры", icon: "хэш" },
  { id: "board", path: "/board", label: "Доска", icon: "работа" },
  // Счётчик висит здесь, а не на доске: он про то, что ЖДЁТ человека,
  // а доска показывает то, что уже в работе. Разные вопросы.
  { id: "deals", path: "/deals", label: "Договорённости", icon: "точка" },
  { id: "agents", path: "/agents", label: "Агенты", icon: "модель" },
];

/**
 * Какой раздел открыт — по адресу.
 *
 * Разговоры остаются ответом по умолчанию: и «/», и «/c/…» — это они.
 */
export function sectionOf(pathname: string): Section {
  const found = PARTS.find((part) => part.path !== "/" && pathname.startsWith(part.path));
  return found?.id ?? "talk";
}

/**
 * Переключатель разделов. Счётчик — только у того, что ждёт человека.
 *
 * Ссылки, а не кнопки: по ним работает средняя кнопка мыши, «открыть
 * в новой вкладке» и копирование адреса. Кнопка этого не умеет и молча
 * притворяется ссылкой.
 */
function Parts({ section, pending }: { section: Section; pending: number }) {
  return (
    <nav className="parts" aria-label="Разделы">
      {PARTS.map((part) => (
        <Link
          key={part.id}
          to={part.path}
          className={section === part.id ? "part part-on" : "part"}
          aria-current={section === part.id ? "page" : undefined}
        >
          <Icon name={part.icon} />
          {part.label}
          {/* Счётчик только у ждущих решения: подтверждённое внимания не
              требует, а метка на нём учит эту метку не замечать. */}
          {part.id === "deals" && pending > 0 ? (
            <span className="part-count">{pending}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

export function Rail({
  me,
  chat,
  section,
  pending,
  onLeave,
}: {
  me: Me;
  chat: Chat;
  section: Section;
  pending: number;
  onLeave: () => void;
}) {
  return (
    <aside className="rail">
      <h1>{me.workspace.name}</h1>
      <p className="who">{me.participant.displayName}</p>

      <Parts section={section} pending={pending} />

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
