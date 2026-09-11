import { NotePencil } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router";
import type { Me } from "../data/api.js";
import type { Chat } from "../data/useChat.js";
import { Icon } from "../shared/Icon.js";
import { Logo } from "../shared/Logo.js";
import { NewChatDialog } from "./ChannelAsks.js";
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
export type Section = "talk" | "board";

/**
 * Раздел, его адрес, подпись и значок.
 *
 * ⚠️ АДРЕС ЗДЕСЬ — ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ О ТОМ, ГДЕ ЧЕЛОВЕК (Р-019).
 * До task-012 раздел жил в `useState` у экрана: ссылку дать было нечем,
 * «назад» выкидывал из приложения, а F5 возвращал в «Разговоры».
 */
/**
 * ⚠️ «ЧАТА» СРЕДИ РАЗДЕЛОВ БОЛЬШЕ НЕТ (владелец, 10.09: «нам тогда
 * из боковой панели слово чат нужно убрать»). Он стал лишним в тот миг,
 * когда список разговоров начал стоять в панели ВСЕГДА: строка «Чат»
 * вела туда, где человек и так находится, — а рядом уже висит «Новый
 * чат», и два похожих слова подряд читаются как ошибка.
 *
 * Так же у Codex: в верхнем блоке нет пункта «чат», потому что чаты —
 * это и есть сама панель.
 */
const PARTS: Array<{
  id: Section;
  path: string;
  label: string;
  icon: "хэш" | "работа" | "модель" | "точка";
}> = [{ id: "board", path: "/board", label: "Доска", icon: "работа" }];

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
  const [creating, setCreating] = useState(false);

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

        {/* ⚠️ «НОВЫЙ ЧАТ» СТОИТ ПЕРВЫМ В ВЕРХНЕМ БЛОКЕ, А НЕ НАД СПИСКОМ
            ЧАТОВ. Владелец показал пальцем 10.09: «вот этого нет в Codex,
            там же по-другому сделано». У них это первая строка того же
            блока, что и разделы, с карандашом вместо плюса — потому что
            завести разговор человек хочет чаще, чем перейти в раздел.

            ⚠️ ДЕЙСТВИЕ, НАРИСОВАННОЕ КАК ССЫЛКА, — отступление от нашего
            же правила «одинаковое поведение выглядит одинаково» (см. ниже
            про «Свою нейросеть»). Отступление осознанное: в Codex так,
            и место в ряду важнее, чем разница «ведёт» против «делает».
            Кнопка при этом остаётся кнопкой в разметке — читалка скажет
            «кнопка», а не «ссылка». */}
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2.5 rounded bg-transparent px-2.5 py-2 text-left text-body text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <NotePencil className="size-4 shrink-0" />
            Новый чат
          </button>

          <Parts section={section} />
        </div>

        <NewChatDialog
          open={creating}
          onCreate={(title) => chat.panel.addChannel(title)}
          onClose={() => setCreating(false)}
        />

        {/* ⚠️ СПИСОК РАЗГОВОРОВ СТОИТ ВСЕГДА, А НЕ ТОЛЬКО В «ЧАТЕ», И ЭТО
            ОТМЕНА ПРЕЖНЕГО РЕШЕНИЯ. Раньше он прятался в «Доске»
            и «Агентах» — с доводом «там ему нечего делать». Довод
            перевесило другое: из «Доски» стало не вернуться в разговор,
            как только строка «Чат» ушла из разделов. У Codex список тоже
            стоит всегда — он и есть панель.

            ⚠️ ОДНО СВОЙСТВО, А НЕ ДЕВЯТЬ. Оболочка передаёт панель целиком
            и не знает, что та умеет: прибавится действие — этот файл
            не изменится (task-035, шаг 0). */}
        <RoomList panel={chat.panel} />

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
