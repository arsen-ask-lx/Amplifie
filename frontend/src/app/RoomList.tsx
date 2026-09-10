import { useState } from "react";
import type { Conversation, Project } from "../data/api.js";
import type { Panel } from "../data/usePanel.js";
import { ConfirmRemoval, NewChannel } from "./ChannelAsks.js";
import { ChannelRow } from "./ChannelRow.js";
import { ConfirmProjectRemoval, ProjectDialog } from "./ProjectDialog.js";
import { ProjectRow } from "./ProjectRow.js";
import { SidebarSection } from "./SidebarSection.js";

/**
 * Панель разговоров: проекты, а внутри них чаты.
 *
 * ⚠️ РАЗДЕЛА «КАНАЛЫ» НЕТ (task-037), И ЭТО НЕ ПЕРЕСТАНОВКА МЕСТАМИ.
 * У чата было два дома: «Проекты» и «Каналы». Разница между ними была
 * ровно одна — заполнено поле принадлежности или нет, — и человеку
 * приходилось решать вопрос, у которого нет смысла: «это канал или чат
 * проекта?». Владелец 10.09: «мне не нужны отдельные каналы». Дом стал
 * один, и теперь разделов здесь ровно столько, сколько СОРТОВ разговора:
 * проекты сейчас, Избранное и личные — когда появятся.
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
   * В каком проекте заводим чат. `null` — не заводим.
   *
   * ⚠️ ПУСТАЯ СТРОКА ЗДЕСЬ БОЛЬШЕ НЕ ЗНАЧИТ НИЧЕГО. Прежде она значила
   * «вне проектов» — этого случая не стало вместе с разделом «Каналы».
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

  const закрыть = () => setСпрашиваем(null);

  /**
   * Строка чата — одной функцией, а не куском разметки внутри папки.
   *
   * ⚠️ ОНА ПЕРЕЖИЛА ИСЧЕЗНОВЕНИЕ ВТОРОГО ДОМА. Заводилась она ради того,
   * чтобы чат внутри проекта и снаружи выглядел одинаково; «снаружи»
   * не стало, а функция осталась нужной: рисует её `ProjectRow`, знать
   * же про меню, значки и выбор ему незачем.
   */
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
      <SidebarSection
        title="Проекты"
        addLabel="Новый проект"
        onAdd={() => setСпрашиваем({ вид: "новый" })}
      >
        {/* Прокрутка живёт на списке проектов: он единственный, кто здесь
            растёт, и теперь в нём же лежат все чаты. */}
        <div className="hide-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
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
        // Число чатов берётся из того же списка, который человек видит
        // на экране: второго способа сосчитать здесь нет.
        чатов={
          спрашиваем?.вид === "убрать"
            ? items.filter((one) => one.projectId === спрашиваем.project.id).length
            : 0
        }
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
