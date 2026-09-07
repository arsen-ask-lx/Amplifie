import { Link } from "react-router";
import type { Me } from "../data/api.js";
import type { Chat } from "../data/useChat.js";
import { Icon } from "../shared/Icon.js";
import { Button } from "../shared/ui/button.js";
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
    <nav className="flex flex-col gap-0.5" aria-label="Разделы">
      {PARTS.map((part) => (
        <Link
          key={part.id}
          to={part.path}
          className={[
            "flex items-center gap-2.5 rounded px-2.5 py-2 text-body no-underline transition-colors",
            section === part.id
              ? "bg-selected font-medium text-ink"
              : "bg-transparent text-muted hover:bg-raised hover:text-ink",
          ].join(" ")}
          aria-current={section === part.id ? "page" : undefined}
        >
          <Icon name={part.icon} />
          {part.label}
          {/* Счётчик только у ждущих решения: подтверждённое внимания не
              требует, а метка на нём учит эту метку не замечать. */}
          {part.id === "deals" && pending > 0 ? (
            <span className="ml-auto rounded-pill bg-accent px-1.5 text-mark text-on-accent">
              {pending}
            </span>
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
    <aside className="flex h-full w-64 shrink-0 flex-col gap-4 overflow-hidden border-r border-line bg-panel p-3">
      {/* Название пространства — единственное место, где живёт засечная
          гарнитура (Р-008): у продукта должно быть лицо хотя бы в одной
          точке, но ровно в одной. */}
      <div className="px-2.5 pt-2">
        <h1 className="font-serif text-brand leading-tight text-ink">{me.workspace.name}</h1>
        <p className="text-aside text-muted">{me.participant.displayName}</p>
      </div>

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
          <div className="flex flex-col gap-0.5">
            <NewRoom label="+ Канал" placeholder="Название канала" onCreate={chat.addChannel} />
            {chat.current ? (
              <NewRoom label="+ Ветка" placeholder="О чём ветка" onCreate={chat.addThread} />
            ) : null}
          </div>
        </>
      ) : (
        <div className="flex-1" />
      )}

      {/* Только настройки: три однородные вещи, ни одна не переключает
        раздел. Раньше здесь же стояла «Своя нейросеть», и подвал
        отвечал сразу на два разных вопроса. */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-line pt-3">
        <ThemeSwitch />
        <InvitePanel />
        <Button variant="ghost" size="sm" className="justify-start" onClick={onLeave}>
          <Icon name="выход" />
          Выйти
        </Button>
      </div>
    </aside>
  );
}
