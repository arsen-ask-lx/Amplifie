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
import { focusField } from "../shared/ui/focusAfterClose.js";
import { contextKit, dropdownKit, type MenuKit } from "../shared/ui/menuKit.js";
import { rowState, SpokenCounts, StatusMark } from "./RowStatus.js";

/**
 * Строка канала в боковой панели.
 *
 * ⚠️ ВЫНЕСЕНА ИЗ `RoomList`, КОГДА ТОТ ПЕРЕВАЛИЛ ЗА ПРЕДЕЛ РАЗМЕРА.
 * Шов по вопросу, а не по числу строк: `RoomList` отвечает на «из чего
 * состоит список и как в него добавляют», а это — на «как устроена одна
 * строка». Состояние строки — значок слева — живёт в `RowStatus`: его
 * делит с ней папка проекта.
 */

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
  const { Content, Item } = kit;
  return (
    <Content className="w-52">
      <Item onSelect={() => void onPin(!channel.pinned)}>
        {channel.pinned ? <PushPinSlash /> : <PushPin />}
        {channel.pinned ? "Открепить" : "Закрепить"}
      </Item>
      <ToProject kit={kit} channel={channel} projects={projects} onMove={onMove} />
      {/* «Чат», а не «канал»: так его называет панель и сам человек (владелец 26.09). */}
      <Item variant="destructive" onSelect={onRemove}>
        <Trash />
        Удалить чат
      </Item>
    </Content>
  );
}

/**
 * Строка канала: значок состояния слева, название; действия — правой кнопкой
 * и тремя точками.
 *
 * ⚠️ ТРИ ТОЧКИ ДОБАВЛЕНЫ К ПРАВОЙ КНОПКЕ (владелец 26.09). Место под них
 * отведено всегда, видны они при наведении и фокусе — строка не прыгает
 * (Р-044); оба пути открывают одно меню. С клавиатуры — `Shift+F10`
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
            current
              ? "bg-selected"
              : "bg-transparent hover:bg-raised has-[button:focus-visible]:bg-raised",
          ].join(" ")}
        >
          <button
            type="button"
            aria-current={current ? "page" : undefined}
            onClick={() => {
              onSelect(channel.id);
              // Уже открытый чат: адрес не меняется, и курсор в поле
              // возвращаем сами — «включил чат — печатаешь».
              if (current) focusField();
            }}
            className={[
              "flex min-w-0 flex-1 items-center gap-1.5 rounded bg-transparent px-2 py-1.5 text-left text-body transition-colors outline-none",
              current ? "font-medium text-ink" : "text-muted group-hover/room:text-ink",
              // Жирное название — главный признак нового (Р-044, как в Slack):
              // панель читают по диагонали, и вес заметен раньше значка.
              unread > 0 && !current ? "font-medium text-ink" : "",
            ].join(" ")}
          >
            {/* Булавка — тоже состояние: видна, пока нет нового и зова. */}
            <StatusMark state={rowState({ unread, mentions, pinned: channel.pinned })} />
            <span className="truncate">{channel.title}</span>
            <SpokenCounts unread={unread} mentions={mentions} />
          </button>
          <DropdownMenu>
            {/* ⚠️ `invisible`, А НЕ `hidden`: место занято всегда, и появление
                точек ничего не сдвигает (Р-044).
                ⚠️ ВИДНЫ ПРИ НАВЕДЕНИИ, ФОКУСЕ И ОТКРЫТОМ МЕНЮ. Без последнего
                точки пропадали бы из-под открытого меню: фокус уходит в него,
                и строка перестаёт быть «под курсором». */}
            <DropdownMenuTrigger
              aria-label={`Настройки чата «${channel.title}»`}
              className="invisible mr-1 grid size-6 shrink-0 place-items-center rounded bg-transparent text-muted outline-none hover:bg-selected hover:text-ink focus-visible:bg-selected focus-visible:text-ink group-focus-within/room:visible group-hover/room:visible data-[state=open]:visible"
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
