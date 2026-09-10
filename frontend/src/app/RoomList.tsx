import { Plus } from "@phosphor-icons/react";
import { useState } from "react";
import type { Conversation, Project } from "../data/api.js";
import type { Panel } from "../data/usePanel.js";
import { ConfirmRemoval, NewChannel } from "./ChannelAsks.js";
import { ChannelRow } from "./ChannelRow.js";
import { ConfirmProjectRemoval, ProjectDialog } from "./ProjectDialog.js";
import { ProjectRow } from "./ProjectRow.js";
import { SidebarSection } from "./SidebarSection.js";

/**
 * Панель разговоров: чаты сверху, проекты под ними.
 *
 * ⚠️ РАЗДЕЛА «КАНАЛЫ» НЕТ, НО И В ПАПКУ ЧАТ НЕ ЗАГОНЯЕТСЯ (task-037,
 * [Р-033](../../../dock/decisions/033-проект-необязателен.md)). Секция
 * с вывеской «Каналы» делала вид, будто у чата есть второй СОРТ, —
 * человеку приходилось решать несуществующий вопрос «это канал или чат
 * проекта?». Вывески не стало; чаты без папки просто лежат сверху
 * простым списком — так же устроены несортированные каналы в Дискорде
 * и недавние чаты в Claude.
 *
 * ⚠️ ПАПКА ПРИ ЭТОМ ОСТАЛАСЬ НЕОБЯЗАТЕЛЬНОЙ НАРОЧНО. Проект скоро
 * получит своего агента, свои указания и свою память. Обязательная
 * папка «Общее» сложила бы в одну память смету, наём и курилку, и ответы
 * стали бы хуже МОЛЧА. Чат без проекта честно значит «области нет».
 *
 * Список приходит уже отсортированным по свежести: это делает сервер,
 * и переупорядочивать его здесь нельзя — два порядка разойдутся.
 *
 * ⚠️ ВЕТОК В ПАНЕЛИ НЕТ, И ЭТО ИСПРАВЛЕНИЕ. Они там были — вложенным
 * вторым уровнем со своим значком, — и это была выдумка: ни в Телеграме,
 * ни в Дискорде, ни в Слаке, ни в Buzz ветка не живёт в боковой панели.
 * В Дискорде она висит ПОД своим каналом внутри него, в Слаке открывается
 * панелью справа от сообщения.
 *
 * ⚠️ ПОИСКА ЗДЕСЬ ТОЖЕ НЕТ. В Buzz он есть — в приколотой шапке панели, —
 * но владелец сказал «точно не в боковой панели», и это его решение,
 * а не недосмотр.
 */

/**
 * Какие проекты свёрнуты. Переживает перезагрузку страницы.
 *
 * ⚠️ ЛИЧНОЕ И ТОЛЬКО ЛИЧНОЕ, поэтому в браузере, а не на сервере.
 * «Свернул папку» — это про мой сегодняшний взгляд, а не про устройство
 * пространства; уехав на сервер, оно свернуло бы папку всем сразу.
 *
 * ⚠️ ЧТЕНИЕ И ЗАПИСЬ В `try`. Хранилище бывает закрыто настройками
 * приватности, и это выбор человека, а не поломка: не прочлось — все
 * папки развёрнуты, и панель работает.
 */
const ЯЩИК = "amplifie:свёрнутые-проекты";

function useСвёрнутые() {
  const [свёрнуты, setСвёрнуты] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(ЯЩИК) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const свернуть = (id: string) => {
    setСвёрнуты((было) => {
      const стало = new Set(было);
      if (стало.has(id)) стало.delete(id);
      else стало.add(id);
      try {
        localStorage.setItem(ЯЩИК, JSON.stringify([...стало]));
      } catch {
        // Не сохранилось — папка свернётся снова после перезагрузки.
        // Это неудобство, а не поломка, и молчать о нём здесь уместно.
      }
      return стало;
    });
  };

  return { свёрнуты, свернуть };
}

/**
 * ⚠️ ОДНО СВОЙСТВО, А НЕ ДЕВЯТЬ (task-035, шаг 0). Панель принимает свой
 * предмет целиком: прибавится у неё умение — изменится этот файл и тип
 * панели, а `Rail` между ними об этом не узнает. Замер, из-за которого
 * так сделано, лежит в плане: упоминания тронули восемь файлов, проекты
 * девять, и половина правок была чистым пробросом.
 */
export function RoomList({ panel }: { panel: Panel }) {
  const { items, projects, currentId, unreadOf, mentionsOf } = panel;
  /**
   * Где заводим чат: `null` — не заводим, `""` — без папки,
   * иначе номер проекта. Одно состояние вместо флажка и номера рядом.
   */
  const [adding, setAdding] = useState<string | null>(null);
  const { свёрнуты, свернуть } = useСвёрнутые();

  /**
   * Что спрашиваем про проекты прямо сейчас.
   *
   * ⚠️ ОДНО СОСТОЯНИЕ НА ТРИ ОКНА, А НЕ ТРИ ФЛАЖКА. Заводим, переименовываем
   * и убираем — вещи взаимоисключающие: два таких окна не бывают открыты
   * разом. Тремя флажками это состояние однажды оказалось бы в двух
   * значениях сразу.
   */
  const [спрашиваем, setСпрашиваем] = useState<
    { вид: "новый" } | { вид: "имя"; project: Project } | { вид: "убрать"; project: Project } | null
  >(null);
  /**
   * Какой канал спрашиваем «точно удалить?».
   *
   * ⚠️ СПРАШИВАЕМ, И ЭТО НЕ ПЕРЕСТРАХОВКА. Реплику удаляет её автор
   * и только свою; канал сносит переписку целиком и у всех. Действие
   * необратимое для того, кто смотрит, — значит между «промахнулся мышью»
   * и «переписки нет» обязан стоять один явный шаг.
   */
  const [removing, setRemoving] = useState<Conversation | null>(null);

  // Что панель показывает, решено при её сборке (`usePanel`): сюда
  // приезжают уже только корневые разговоры.
  const безПапки = items.filter((one) => one.projectId === null);

  /**
   * Строка канала одна и та же внутри проекта и снаружи.
   *
   * ⚠️ ФУНКЦИЕЙ, А НЕ ДВУМЯ КУСКАМИ РАЗМЕТКИ. Два куска разъедутся
   * на первой же правке — у одного появится значок, у другого нет.
   */
  const закрыть = () => setСпрашиваем(null);

  const строка = (channel: Conversation) => (
    <ChannelRow
      key={channel.id}
      channel={channel}
      projects={projects}
      current={channel.id === currentId}
      unread={unreadOf(channel.id)}
      mentions={mentionsOf(channel.id)}
      onSelect={panel.select}
      onMove={panel.moveToProject}
      onRemove={() => setRemoving(channel)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ⚠️ «НОВЫЙ ЧАТ» ВИДЕН ВСЕГДА, А НЕ ПО НАВЕДЕНИЮ, И ЭТО ОТСТУПЛЕНИЕ
          ОТ ПРАВИЛА СЕКЦИЙ. Там плюс прячется намеренно: канал заводят
          раз в месяц, а список читают каждый день. Здесь наоборот —
          завести разговор стало главным действием панели, как «New chat»
          у Claude и ChatGPT. Спрятанное главное действие человек ищет. */}
      <button
        type="button"
        onClick={() => setAdding("")}
        className="flex shrink-0 items-center gap-2 rounded bg-transparent px-2.5 py-1.5 text-left text-body text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        <Plus className="size-4 shrink-0" weight="bold" />
        Новый чат
      </button>

      {/* Прокрутка одна на обе части: чаты и папки растут вместе,
          и две полосы рядом читались бы как два разных списка. */}
      <div className="hide-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex shrink-0 flex-col gap-0.5">
          {adding === "" ? (
            <NewChannel
              // Пустая строка — «без папки»: чат заводится сам по себе.
              onCreate={(title) => panel.addChannel(title)}
              onDone={() => setAdding(null)}
            />
          ) : null}

          {безПапки.map((channel) => строка(channel))}
        </div>

        <SidebarSection
          title="Проекты"
          addLabel="Новый проект"
          onAdd={() => setСпрашиваем({ вид: "новый" })}
        >
          <div className="flex flex-col gap-0.5">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                channels={items.filter((one) => one.projectId === project.id)}
                collapsed={свёрнуты.has(project.id)}
                onToggle={() => свернуть(project.id)}
                onAddChat={() => setAdding(project.id)}
                onRename={() => setСпрашиваем({ вид: "имя", project })}
                onRemove={() => setСпрашиваем({ вид: "убрать", project })}
                unreadOf={unreadOf}
                mentionsOf={mentionsOf}
                renderChannel={строка}
                // Поле нового чата встаёт на место кнопки «Новый чат» —
                // внутри той папки, куда чат и заводится.
                newChat={
                  adding === project.id ? (
                    <NewChannel
                      onCreate={(title) => panel.addChannel(title, project.id)}
                      onDone={() => setAdding(null)}
                    />
                  ) : null
                }
              />
            ))}

            {projects.length === 0 ? (
              <p className="px-2.5 py-1.5 text-aside text-muted">
                Проектов нет. Заведите первый — плюс в заголовке.
              </p>
            ) : null}
          </div>
        </SidebarSection>
      </div>

      <ProjectDialog
        open={спрашиваем?.вид === "новый" || спрашиваем?.вид === "имя"}
        title={спрашиваем?.вид === "имя" ? "Переименовать проект" : "Новый проект"}
        было={спрашиваем?.вид === "имя" ? спрашиваем.project.title : ""}
        кнопка={спрашиваем?.вид === "имя" ? "Переименовать" : "Завести"}
        // ⚠️ КЛЮЧ ПО СЛУЧАЮ: без него поле помнит прежнее имя, когда окно
        // открывают второй раз с другим проектом.
        key={спрашиваем?.вид === "имя" ? спрашиваем.project.id : "новый"}
        onSubmit={async (title) => {
          if (спрашиваем?.вид === "имя") await panel.renameProject(спрашиваем.project.id, title);
          else await panel.addProject(title);
        }}
        onClose={закрыть}
      />

      <ConfirmProjectRemoval
        title={спрашиваем?.вид === "убрать" ? спрашиваем.project.title : null}
        onCancel={закрыть}
        onConfirm={async () => {
          if (спрашиваем?.вид !== "убрать") return;
          const id = спрашиваем.project.id;
          закрыть();
          await panel.removeProject(id);
        }}
      />

      <ConfirmRemoval
        channel={removing}
        onCancel={() => setRemoving(null)}
        onConfirm={async (id) => {
          setRemoving(null);
          await panel.removeChannel(id);
        }}
      />
    </div>
  );
}
