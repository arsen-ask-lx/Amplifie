import { useCallback, useState } from "react";
import { type AgentsView, api, type Bridge } from "../../data/api.js";
import { Icon } from "../../shared/Icon.js";
import { usePolling } from "../../shared/usePolling.js";
import { KeyPanel } from "./KeyPanel.js";
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

/** Короткая строка — статус, а не третья карточка с повтором имени агента. */
function AgentStatus({
  agent,
  bridge,
  via,
}: {
  agent: AgentsView["items"][number];
  bridge: AgentsView["bridge"];
  via: AgentsView["answersVia"];
}) {
  const state = bridge.online ? "на связи" : bridge.connected ? "нет связи" : "не подключён";
  const payment = via.kind === "нечем" ? null : via.kind;

  return (
    <p className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-ink">
      <Icon name="model" />
      <b>{agent.name}</b>
      <span className="text-muted">{state}</span>
      {payment ? <span className="text-muted">· отвечает через {payment}</span> : null}
    </p>
  );
}

export function AgentsScreen({ embedded = false }: { embedded?: boolean }) {
  const [view, setView] = useState<AgentsView | null>(null);
  const [bridges, setBridges] = useState<Bridge[]>([]);

  /**
   * ОДИН опрос на весь раздел. До task-012 их было два: этот экран и
   * подключение подписки внутри него ходили каждый своим таймером,
   * а состояние моста приходит в обоих ответах.
   */
  const refresh = useCallback(async () => {
    try {
      const [agents, links] = await Promise.all([api.agents(), api.bridges()]);
      setView(agents);
      setBridges(links.items);
    } catch {
      // Список агентов — не то, ради чего стоит ронять экран: подключение
      // подписки ниже работает и без него. Молчание здесь осознанное.
    }
  }, []);

  usePolling(refresh, REFRESH_MS);

  return (
    <div className={embedded ? "w-full" : "flex-1 overflow-y-auto p-5"}>
      {view?.items.map((agent) => (
        <AgentStatus key={agent.id} agent={agent} bridge={view.bridge} via={view.answersVia} />
      ))}

      <div className="w-full divide-y divide-line">
        <section className="pb-8" aria-labelledby="подписка">
          <h3 id="подписка" className="mb-5 text-lead font-semibold text-ink">
            Своя подписка
          </h3>
          <ModelScreen bridges={bridges} onChanged={refresh} />
        </section>

        <section className="pt-8" aria-labelledby="ключ">
          <h3 id="ключ" className="mb-5 text-lead font-semibold text-ink">
            Ключ API
          </h3>
          <KeyPanel onChange={() => void refresh()} />
        </section>
      </div>
    </div>
  );
}
