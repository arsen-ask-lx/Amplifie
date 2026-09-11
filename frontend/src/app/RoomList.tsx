import { useState } from "react";
import type { Conversation, Project } from "../data/api.js";
import type { Panel } from "../data/usePanel.js";
import { ConfirmRemoval } from "./ChannelAsks.js";
import { ChannelRow } from "./ChannelRow.js";
import { ProjectAsks } from "./ProjectDialog.js";
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
      onPin={(pinned) => panel.pin({ conversationId: channel.id }, pinned)}
      onRemove={() => setRemoving(channel)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Прокрутка одна на обе части: чаты и папки растут вместе,
          и две полосы рядом читались бы как два разных списка. */}
      <div className="hide-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {/* ⚠️ ПРОЕКТЫ ВЫШЕ НЕДАВНИХ (владелец 10.09: «проекты поменять
            местами с недавние»). Наверху то, что человек назвал сам
            и вернётся к нему завтра; ниже — то, что просто случилось
            сегодня. Так же в Codex. */}
        <SidebarSection
          title="Проекты"
          addLabel="Новый проект"
          addAlwaysVisible={projects.length === 0}
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
                onPin={(pinned) => panel.pin({ projectId: project.id }, pinned)}
                onRename={() => setСпрашиваем({ вид: "имя", project })}
                onRemove={() => setСпрашиваем({ вид: "убрать", project })}
                unreadOf={unreadOf}
                mentionsOf={mentionsOf}
                renderChannel={строка}
              />
            ))}

            {projects.length === 0 ? (
              <p className="px-2.5 py-1.5 text-aside text-muted">
                Проектов нет. Заведите первый — плюс справа от подписи.
              </p>
            ) : null}
          </div>
        </SidebarSection>

        {/* ⚠️ «НЕДАВНИЕ» — ЭТО ПРО ПОРЯДОК, А НЕ ПРО СОРТ ЧАТОВ, и потому
            подпись не воскрешает раздел «Каналы». Список и правда идёт
            по свежести — это делает сервер. Без подписи он читался
            как свалка ничьих чатов.

            Пусто — подписи нет вовсе: заголовок над пустотой говорит
            только о том, что мы чего-то ждём от человека. */}
        {безПапки.length > 0 ? (
          <SidebarSection title="Недавние">
            <div className="flex flex-col gap-0.5">
              {безПапки.map((channel) => строка(channel))}
            </div>
          </SidebarSection>
        ) : null}
      </div>

      <ProjectAsks спрашиваем={спрашиваем} panel={panel} onClose={закрыть} />

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
