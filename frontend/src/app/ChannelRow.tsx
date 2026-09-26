import {
  DotsThreeVertical,
  FolderSimple,
  PushPin,
  PushPinSlash,
  Trash,
} from "@phosphor-icons/react";
import type { Conversation, Project } from "../data/api.js";
import { ContextMenu, ContextMenuTrigger } from "../shared/ui/context-menu.js";
import { DropdownMenu, DropdownMenuTrigger } from "../shared/ui/dropdown-menu.js";
import { contextKit, dropdownKit, type MenuKit } from "../shared/ui/menuKit.js";

/**
 * Строка канала в боковой панели.
 *
 * ⚠️ ВЫНЕСЕНА ИЗ `RoomList`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА.
 * Шов по вопросу, а не по числу строк: `RoomList` отвечает на «из чего
 * состоит список и как в него добавляют», а это — на «как устроена одна
 * строка». Второй вопрос за задачу про непрочитанное оброс числом,
 * скрытым словом для чтения с экрана и плотностью названия.
 */

/**
 * Число непрочитанного у канала.
 *
 * ⚠️ ПОТОЛОК «999+», И ОН НЕ КОСМЕТИКА. Сервер считает не дальше тысячи
 * (Р-029): выше этого число уже ничего не сообщает человеку, а счёт
 * по огромному каналу стоит денег. Показываем ровно то, что посчитано.
 */
function Unread({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-pill bg-accent px-1.5 py-0.5 text-mark text-on-accent tabular-nums">
      {/* ⚠️ СЛОВО ДЛЯ ЧТЕНИЯ С ЭКРАНА, А НЕ `aria-label` НА `span`.
          Голая «7» вслух не говорит ничего, а `aria-label` на узле без
          роли браузеры и читалки имеют право не заметить — линтер прав.
          Спрятанное слово читается всегда и никому не мешает.

          Оно же входит в ДОСТУПНОЕ ИМЯ кнопки канала: «Совещание
          непрочитанных: 2». Поэтому в проверках канал ищется по началу
          имени, а не целиком (fixtures.ts). */}
      <span className="sr-only">непрочитанных: </span>
      {count > 999 ? "999+" : count}
    </span>
  );
}

/**
 * Значок «тебя звали» (Р-031).
 *
 * ⚠️ РЯДОМ С ЧИСЛОМ НЕПРОЧИТАННОГО, А НЕ ВМЕСТО НЕГО. Это разные новости:
 * «тут что-то написали» и «обратились к тебе». В канале с сотней
 * непрочитанных вторая иначе не находится. Так у Телеграма: значок
 * с собачкой живёт своим кружком.
 *
 * Число показываем только со второго зова: один — это просто «позвали»,
 * и цифра «1» рядом с собачкой ничего не добавляет. Так же у них.
 */
function Mentions({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-pill bg-accent px-1.5 py-0.5 text-mark text-on-accent tabular-nums">
      {/* Вслух — число, глазами — собачка: «упоминаний: @» не значит
          ничего, а один зов цифрой на экране не поясняет собой ничего. */}
      <span className="sr-only">упоминаний: {count > 999 ? "999+" : count}</span>
      <span aria-hidden="true">{count > 1 ? `@${count > 999 ? "999+" : count}` : "@"}</span>
    </span>
  );
}

/**
 * Два значка справа от названия: «тебя звали» и «сколько нового».
 *
 * ⚠️ ОДНИМ КУСКОМ, А НЕ ДВУМЯ УСЛОВИЯМИ В РАЗМЕТКЕ СТРОКИ. Порядок
 * значков и отступ между ними — знание про эту пару, а не про строку
 * канала; вписанное в строку, оно добавляло ей два ветвления, и линтер
 * сложности был прав.
 */
function Badges({ unread, mentions }: { unread: number; mentions: number }) {
  if (mentions <= 0 && unread <= 0) return null;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {mentions > 0 ? <Mentions count={mentions} /> : null}
      {unread > 0 ? <Unread count={unread} /> : null}
    </span>
  );
}

/**
 * Подменю «В проект»: куда переложить этот чат (Р-032).
 *
 * ⚠️ ЗАВЕДЕНИЕ ПРОЕКТА ЖИВЁТ ЗДЕСЬ, А НЕ ПЛЮСОМ В ЗАГОЛОВКЕ ПАНЕЛИ.
 * Папку заводят не «вообще», а когда есть что в неё положить: человек
 * смотрит на чат и решает, что он про объект. Отдельная кнопка сверху
 * предлагала бы завести пустую папку — и в панели появлялись бы пустые.
 */
function ToProject({
  kit: { Item, Separator, Sub, SubTrigger, SubContent },
  channel,
  projects,
  onMove,
}: {
  kit: MenuKit;
  channel: Conversation;
  projects: Project[];
  onMove: (conversationId: string, projectId: string | null) => Promise<void>;
}) {
  return (
    <Sub>
      <SubTrigger>
        <FolderSimple />В проект
      </SubTrigger>
      <SubContent className="w-56">
        {projects.map((project) => (
          <Item
            key={project.id}
            disabled={project.id === channel.projectId}
            onSelect={() => void onMove(channel.id, project.id)}
          >
            {project.title}
          </Item>
        ))}
        {/* ⚠️ «НОВЫЙ ПРОЕКТ…» ОТСЮДА УБРАН (task-035). Он открывал
            браузерное окно `window.prompt` — чужое по виду и не знающее
            наших тем, — и был единственным путём завести папку. Теперь
            проекты заводятся плюсом в своём разделе, а здесь осталось
            только перекладывание. */}
        {projects.length === 0 ? <Item disabled>Проектов пока нет</Item> : null}
        {channel.projectId ? (
          <>
            <Separator />
            <Item onSelect={() => void onMove(channel.id, null)}>Убрать из проекта</Item>
          </>
        ) : null}
      </SubContent>
    </Sub>
  );
}

/**
 * Меню чата — одно на любой чат, в проекте и вне его (task-102).
 *
 * ⚠️ ОДИН НАБОР, А НЕ ДВА ПО ПРИНАДЛЕЖНОСТИ. Прежде у чата в проекте были
 * булавка и корзина при наведении, у чата вне — три точки с переносом:
 * развилка жила только из-за места под кнопки. Кнопок больше нет — и развилки тоже.
 */
function ChannelMenu({
  kit,
  channel,
  projects,
  onPin,
  onMove,
  onRemove,
}: {
  kit: MenuKit;
  channel: Conversation;
  projects: Project[];
  onPin: (pinned: boolean) => Promise<void>;
  onMove: (conversationId: string, projectId: string | null) => Promise<void>;
  onRemove: () => void;
}) {
  const { Content, Item, Separator } = kit;
  return (
    <Content className="w-52">
      <Item onSelect={() => void onPin(!channel.pinned)}>
        {channel.pinned ? <PushPinSlash /> : <PushPin />}
        {channel.pinned ? "Открепить" : "Закрепить"}
      </Item>
      <Separator />
      <ToProject kit={kit} channel={channel} projects={projects} onMove={onMove} />
      <Separator />
      {/* «Чат», а не «канал»: так его называет панель и сам человек (владелец 26.09). */}
      <Item variant="destructive" onSelect={onRemove}>
        <Trash />
        Удалить чат
      </Item>
    </Content>
  );
}

/**
 * Строка канала: название и число у правого края; действия — правой кнопкой
 * и тремя точками.
 *
 * ⚠️ ТРИ ТОЧКИ ДОБАВЛЕНЫ К ПРАВОЙ КНОПКЕ (владелец 26.09). Видны при
 * наведении и фокусе, рядом с числом; оба пути открывают одно меню. С клавиатуры — `Shift+F10`
 * или Tab до точек.
 *
 * ⚠️ ОБЛАСТЬ МЕНЮ — ВСЯ СТРОКА, А КНОПКА ВНУТРИ ОДНА. Вложенная кнопка —
 * неверная разметка, а меню на одной кнопке не открывалось бы по краю строки.
 */
export function ChannelRow({
  channel,
  projects,
  current,
  unread,
  mentions,
  onSelect,
  onMove,
  onPin,
  onRemove,
}: {
  channel: Conversation;
  /** Куда можно переложить. Пустой список — только «Новый проект…». */
  projects: Project[];
  current: boolean;
  /** Сколько чужих реплик человек тут не видел (Р-029). */
  unread: number;
  /** Сколько раз тут позвали его самого и он этого не видел (Р-031). */
  mentions: number;
  onSelect: (id: string) => void;
  onMove: (conversationId: string, projectId: string | null) => Promise<void>;
  /** Закрепить в СВОЕЙ панели либо снять (task-038). */
  onPin: (pinned: boolean) => Promise<void>;
  onRemove: () => void;
}) {
  const menu = { channel, projects, onPin, onMove, onRemove };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            "group/room flex items-center rounded transition-colors",
            current ? "bg-selected" : "bg-transparent hover:bg-raised",
          ].join(" ")}
        >
          <button
            type="button"
            aria-current={current ? "page" : undefined}
            onClick={() => onSelect(channel.id)}
            className={[
              "flex min-w-0 flex-1 items-center gap-2 rounded bg-transparent px-2.5 py-1.5 text-left text-body transition-colors",
              current ? "font-medium text-ink" : "text-muted group-hover/room:text-ink",
              // Название канала с непрочитанным набрано плотнее: у Телеграма
              // так же, и это второй признак помимо числа — тот, кто читает
              // панель по диагонали, замечает вес раньше цифры.
              unread > 0 && !current ? "font-medium text-ink" : "",
            ].join(" ")}
          >
            {/* ⚠️ БУЛАВКА ОСТАЁТСЯ ТОЛЬКО У ЗАКРЕПЛЁННОГО ЧАТА: это состояние,
                а не декоративный знак. У обычного чата значок не нужен. */}
            {channel.pinned ? (
              <PushPin className="size-4 shrink-0 opacity-60" weight="fill" aria-hidden="true" />
            ) : null}
            <span className="truncate">{channel.title}</span>
            {/* ⚠️ ЧИСЛО ВНУТРИ КНОПКИ КАНАЛА, А НЕ РЯДОМ С НЕЙ. Оно про этот
                канал, и нажатие по нему обязано открывать его же — как
                и нажатие по названию. Отдельный узел снаружи означал бы
                мёртвую зону в строке. */}
            <Badges unread={unread} mentions={mentions} />
          </button>
          <DropdownMenu>
            {/* ⚠️ ВИДНЫ ПРИ НАВЕДЕНИИ, ФОКУСЕ И ОТКРЫТОМ МЕНЮ. Без последнего
                точки пропадали бы из-под открытого меню: фокус уходит в него,
                и строка перестаёт быть «под курсором». */}
            <DropdownMenuTrigger
              aria-label={`Настройки чата «${channel.title}»`}
              className="hidden size-6 shrink-0 place-items-center rounded bg-transparent text-muted hover:bg-selected hover:text-ink group-focus-within/room:grid group-hover/room:grid data-[state=open]:grid"
            >
              <DotsThreeVertical className="size-4" weight="bold" />
            </DropdownMenuTrigger>
            <ChannelMenu kit={dropdownKit} {...menu} />
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ChannelMenu kit={contextKit} {...menu} />
    </ContextMenu>
  );
}
