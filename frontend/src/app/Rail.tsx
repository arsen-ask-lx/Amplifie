import { Link } from "react-router";
import type { Me } from "../data/api.js";
import type { Chat } from "../data/useChat.js";
import { Icon } from "../shared/Icon.js";
import { Logo } from "../shared/Logo.js";
import { Profile } from "./Profile.js";
import { RoomList } from "./RoomList.js";

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
export type Section = "talk" | "board" | "agents";

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
  { id: "talk", path: "/", label: "Чат", icon: "хэш" },
  { id: "board", path: "/board", label: "Доска", icon: "работа" },
  { id: "agents", path: "/agents", label: "Агенты", icon: "модель" },
];

/**
 * Какой раздел открыт — по адресу.
 *
 * Чат остаётся ответом по умолчанию: и «/», и «/c/…» — это он.
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
function Parts({ section }: { section: Section }) {
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
        </Link>
      ))}
    </nav>
  );
}

export function Rail({
  me,
  chat,
  section,
  open,
  onLeave,
}: {
  me: Me;
  chat: Chat;
  section: Section;
  /** Панель раскрыта. Задвинутая остаётся в разметке — см. ниже. */
  open: boolean;
  onLeave: () => void;
}) {
  return (
    /* ⚠️ ЗАДВИНУТАЯ ПАНЕЛЬ НЕ УДАЛЯЕТСЯ, А СХЛОПЫВАЕТСЯ ДО НУЛЯ. Убрать её
       из разметки значило бы каждый раз пересоздавать список каналов —
       и терять его прокрутку и раскрытые секции. Ширина едет плавно,
       содержимое внутри остаётся прежней ширины (`w-64` на обёртке),
       иначе на время перехода панель сминалась бы в столбик букв.

       `inert` — не украшение: у задвинутой панели нулевая ширина, но её
       кнопки без него по-прежнему ловятся Tab'ом, и фокус уезжает
       в невидимое. */
    <aside
      inert={!open}
      aria-hidden={!open}
      className={[
        "h-full shrink-0 overflow-hidden border-r bg-panel transition-[width] duration-200",
        open ? "w-64 border-line" : "w-0 border-transparent",
      ].join(" ")}
    >
      <div className="flex h-full w-64 flex-col gap-4 p-3">
        {/* Название продукта — ЕДИНСТВЕННОЕ место, где живёт плакатная
          гарнитура (`--brand`, отступление от Р-008): у продукта должно
          быть лицо хотя бы в одной точке, но ровно в одной. Заголовок
          входа её примерил и потерял — там это заголовок экрана, а не имя.
          Имя пространства и человека уехали в профиль внизу: там всё,
          что относится «ко мне». */}
        <h1 className="lockup px-2.5 pt-2 text-ink">
          <Logo />
          <span className="font-brand">Amplifie</span>
        </h1>

        <Parts section={section} />

        {/* Содержимое ТЕКУЩЕГО раздела. Список каналов — навигация внутри
        «Разговоров», а не общая: в «Работе» и «Агентах» ему нечего
        делать, и его присутствие там сбивало прицел. */}
        {section === "talk" ? (
          <RoomList
            rooms={chat.conversations}
            currentId={chat.current?.id ?? null}
            onSelect={(id) => chat.select(id)}
            onCreate={chat.addChannel}
          />
        ) : (
          <div className="flex-1" />
        )}

        {/* Подвал — одна строка вместо трёх. Всё «про меня» под ней:
        тема и выход. Раньше здесь стояли три равновесные кнопки,
        и панель заканчивалась списком несвязанных действий. */}
        <div className="shrink-0 border-t border-line pt-2">
          <Profile me={me} onLeave={onLeave} />
        </div>
      </div>
    </aside>
  );
}
