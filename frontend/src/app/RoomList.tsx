import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * Какие проекты свёрнуты.
 *
 * ⚠️ ПРИ ВХОДЕ СВЁРНУТО ВСЁ, КРОМЕ ПРОЕКТА ОТКРЫТОГО ЧАТА (Р-037), И
 * РЕШАЕТСЯ ЭТО В ТОМ ЖЕ КАДРЕ, ГДЕ ПРИШЛИ ПРОЕКТЫ. Прежде решал эффект —
 * уже после того, как сто проектов успевали раскрыться и смонтировать
 * пять тысяч строк; замер 11.09 — 4 секунды до первого экрана. Теперь
 * первое же состояние после ответа сервера свёрнуто.
 *
 * ⚠️ ПОЯВИВШИЙСЯ ПОСЛЕ ВХОДА ПРОЕКТ РАСКРЫТ. Его только что завёл человек
 * или коллега, в нём — то, что сейчас произошло; прятать новое значит
 * заставить его искать.
 *
 * ⚠️ ЛИЧНОЕ И ТОЛЬКО В ПАМЯТИ ВКЛАДКИ. На сервере оно свернуло бы папку
 * всем сразу; в хранилище браузера — пережило бы вход, а вход всё равно
 * сворачивает всё.
 */
function useCollapsed(loaded: boolean, projects: Project[], currentProjectId: string | null) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [started, setStarted] = useState(false);

  // Правка состояния прямо при отрисовке — приём React «запомнить из
  // прошлой отрисовки»: он перерисует список ДО того, как тот попадёт на экран.
  if (loaded && !started) {
    setStarted(true);
    setCollapsed(
      new Set(projects.filter((one) => one.id !== currentProjectId).map((one) => one.id)),
    );
  }

  const toggle = (id: string) => {
    setCollapsed((before) => {
      const after = new Set(before);
      if (after.has(id)) after.delete(id);
      else after.add(id);
      return after;
    });
  };

  const expand = useCallback((id: string) => {
    setCollapsed((before) => {
      if (!before.has(id)) return before;
      const after = new Set(before);
      after.delete(id);
      return after;
    });
  }, []);

  return { collapsed, toggle, expand };
}

/** Пустой проект — один и тот же пустой список, а не новый на каждый кадр. */
const NO_CHANNELS: Conversation[] = [];

/**
 * ⚠️ ОДНО СВОЙСТВО, А НЕ ДЕВЯТЬ (task-035, шаг 0). Панель принимает свой
 * предмет целиком: прибавится у неё умение — изменится этот файл и тип
 * панели, а `Rail` между ними об этом не узнает. Замер, из-за которого
 * так сделано, лежит в плане: упоминания тронули восемь файлов, проекты
 * девять, и половина правок была чистым пробросом.
 */
export function RoomList({
  panel,
  onAddChannel,
  projectToReveal,
}: {
  panel: Panel;
  onAddChannel: (project: Project) => void;
  /** Проект, где только что успешно появился чат: раскрыть результат действия. */
  projectToReveal: { id: string; revision: number } | null;
}) {
  const { items, projects, currentId, unreadOf, mentionsOf } = panel;
  const currentProjectId = items.find((item) => item.id === currentId)?.projectId ?? null;
  const { collapsed, toggle, expand } = useCollapsed(panel.loaded, projects, currentProjectId);

  useEffect(() => {
    if (projectToReveal) expand(projectToReveal.id);
  }, [projectToReveal, expand]);

  /**
   * Раскрытая папка просит свои чаты. Их привозит сервер порциями (Р-037),
   * поэтому список папки пуст, пока о нём не спросили.
   */
  useEffect(() => {
    for (const project of projects) {
      if (!collapsed.has(project.id)) panel.openProject(project.id);
    }
  }, [projects, collapsed, panel.openProject]);

  /**
   * «Недавние» догружаются, когда низ списка входит в окно панели.
   *
   * ⚠️ НАБЛЮДАТЕЛЬ, А НЕ ОБРАБОТЧИК ПРОКРУТКИ. Обработчик срабатывает
   * на каждый пиксель движения и считает размеры сам; наблюдатель будит
   * нас ровно тогда, когда край показался.
   */
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const edge = bottom.current;
    if (!edge || !panel.moreRecent) return;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((one) => one.isIntersecting)) void panel.loadMoreRecent();
    });
    watcher.observe(edge);
    return () => watcher.disconnect();
  }, [panel.moreRecent, panel.loadMoreRecent]);

  /**
   * Что спрашиваем про проекты прямо сейчас.
   *
   * ⚠️ ОДНО СОСТОЯНИЕ НА ТРИ ОКНА, А НЕ ТРИ ФЛАЖКА. Заводим, переименовываем
   * и убираем — вещи взаимоисключающие: два таких окна не бывают открыты
   * разом. Тремя флажками это состояние однажды оказалось бы в двух
   * значениях сразу.
   */
  const [asking, setAsking] = useState<
    | { kind: "create" }
    | { kind: "rename"; project: Project }
    | { kind: "remove"; project: Project }
    | null
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
  //
  // ⚠️ РАСКЛАДКА ПО ПРОЕКТАМ — ОДИН ПРОХОД, А НЕ ОТБОР НА КАЖДЫЙ ПРОЕКТ.
  // Сто проектов × пять тысяч чатов — полмиллиона сравнений на каждое
  // перечитывание списка, то есть на каждое сообщение в пространстве.
  const { loose, byProject } = useMemo(() => {
    const outside: Conversation[] = [];
    const inside = new Map<string, Conversation[]>();
    for (const one of items) {
      if (one.projectId === null) {
        outside.push(one);
        continue;
      }
      const same = inside.get(one.projectId);
      if (same) same.push(one);
      else inside.set(one.projectId, [one]);
    }
    return { loose: outside, byProject: inside };
  }, [items]);

  /**
   * Строка канала одна и та же внутри проекта и снаружи.
   *
   * ⚠️ ФУНКЦИЕЙ, А НЕ ДВУМЯ КУСКАМИ РАЗМЕТКИ. Два куска разъедутся
   * на первой же правке — у одного появится значок, у другого нет.
   */
  const close = () => setAsking(null);

  const row = (channel: Conversation) => (
    <ChannelRow
      key={channel.id}
      channel={channel}
      projects={projects}
      current={channel.id === currentId}
      unread={unreadOf(channel.id)}
      mentions={mentionsOf(channel.id)}
      onSelect={panel.select}
      onMove={(conversationId, projectId) => {
        // Итог действия — на виду: перенесённый в свёрнутый проект чат
        // иначе исчезал из панели, будто его не стало.
        //
        // ⚠️ РАСКРЫВАЕМ ДО ОТВЕТА СЕРВЕРА, А НЕ ПОСЛЕ. Раскрытие после
        // ответа отменяло сворачивание, которое человек успел сделать,
        // пока ответ шёл: сценарий на медленной машине CI это поймал.
        if (projectId) expand(projectId);
        return panel.moveToProject(conversationId, projectId);
      }}
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
          onAdd={() => setAsking({ kind: "create" })}
        >
          <div className="flex flex-col gap-0.5">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                channels={byProject.get(project.id) ?? NO_CHANNELS}
                collapsed={collapsed.has(project.id)}
                onToggle={() => toggle(project.id)}
                onAddChannel={() => onAddChannel(project)}
                onPin={(pinned) => panel.pin({ projectId: project.id }, pinned)}
                onRename={() => setAsking({ kind: "rename", project })}
                onRemove={() => setAsking({ kind: "remove", project })}
                more={panel.moreIn(project.id)}
                onMore={() => void panel.loadMoreIn(project.id)}
                renderChannel={row}
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
        {loose.length > 0 ? (
          <SidebarSection title="Недавние">
            <div className="flex flex-col gap-0.5">
              {loose.map((channel) => row(channel))}
              {/* Край списка: показался — значит человек долистал донизу
                  и пора привезти следующую порцию. */}
              <div ref={bottom} aria-hidden="true" className="h-px" />
            </div>
          </SidebarSection>
        ) : null}
      </div>

      <ProjectAsks asking={asking} panel={panel} onClose={close} />

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
