import { useCallback, useEffect, useState } from "react";
import { type AgentsView, api } from "./api.js";
import { Icon } from "./Icon.js";
import { ModelScreen } from "./ModelScreen.js";

/**
 * Раздел «Агенты»: кто у меня есть и почему он молчит.
 *
 * ПОЧЕМУ ПОДКЛЮЧЕНИЕ ПОДПИСКИ ЖИВЁТ ЗДЕСЬ, А НЕ В НАСТРОЙКАХ. Агент
 * отвечает через мост того, кто его позвал. Значит «агент молчит»
 * и «мост погашен» — одно событие, увиденное с двух сторон. Развести
 * их по разным экранам значит заставить человека догадываться о связи.
 *
 * ⚠️ Пустой список — не поломка. Агент заводится при первом обращении,
 * и до него его честно нет. Рисовать участника, которого не существует,
 * значит соврать: он не появится в списке участников и не подпишет
 * ни одного события.
 */

/** Пока раздел открыт, состояние моста может измениться в другом окне. */
const REFRESH_MS = 4000;

function State({ bridge }: { bridge: AgentsView["bridge"] }) {
  if (bridge.online) {
    return (
      <p className="agent-state">
        Отвечает через <b>{bridge.name}</b> — машина на связи.
      </p>
    );
  }
  if (bridge.connected) {
    return (
      <p className="agent-state agent-state-off">
        Мост «{bridge.name}» подключён, но сейчас не на связи. Пока окно терминала закрыто, Сводка
        не ответит.
      </p>
    );
  }
  return (
    <p className="agent-state agent-state-off">
      Своя нейросеть не подключена — Сводка не сможет ответить. Подключение ниже.
    </p>
  );
}

export function AgentsScreen() {
  const [view, setView] = useState<AgentsView | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await api.agents());
    } catch {
      // Список агентов — не то, ради чего стоит ронять экран: подключение
      // подписки ниже работает и без него. Молчание здесь осознанное.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    // Тот же контейнер, что у остальных экранов: иначе карточка агента
    // и блок подписки под ней стоят в разной сетке и разной ширины.
    <div className="work">
      {/* Заголовок «Агенты» уже стоит в шапке экрана. Второй такой же
          под ним — не структура, а эхо. */}
      {view && view.items.length === 0 ? (
        <p className="work-note">
          Агентов пока нет. Сводка появится сама, как только её позовут впервые: напишите в любом
          канале <code>@Сводка</code> и вопрос.
        </p>
      ) : null}

      {view?.items.map((agent) => (
        <section key={agent.id} className="work-part agent-card">
          <h3>
            <Icon name="модель" />
            {agent.name}
          </h3>
          <p className="agent-what">
            Читает разговор и отвечает <b>только по обращению</b> — <code>@{agent.name}</code> в
            тексте. Сам ничего не слушает.
          </p>
          <State bridge={view.bridge} />
        </section>
      ))}

      <ModelScreen />
    </div>
  );
}
