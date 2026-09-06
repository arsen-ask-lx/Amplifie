import type { Me } from "./api.js";

/**
 * Главная. Пока намеренно почти пустая: заполнится каналом на следующем срезе.
 * Заглушки с выдуманными данными не ставим — они врут о готовности.
 */
export function HomeScreen({ me, onLeave }: { me: Me; onLeave: () => void }) {
  return (
    <div className="main">
      <div className="row">
        <div>
          <h1>{me.workspace.name}</h1>
          <p className="who">
            {me.participant.displayName} ·{" "}
            {me.participant.role === "owner" ? "владелец" : me.participant.role}
          </p>
        </div>
        <button type="button" className="out" onClick={onLeave}>
          Выйти
        </button>
      </div>

      <div className="panel">
        Здесь появится канал: люди пишут, агент слушает и предлагает договорённости. Пока готов
        только вход.
      </div>
    </div>
  );
}
