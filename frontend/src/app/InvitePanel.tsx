import { useState } from "react";
import { api } from "../data/api.js";
import { NOT_COPIED, copy as toClipboard } from "../shared/clipboard.js";

/**
 * Приглашение в пространство.
 *
 * Ссылка показывается ОДИН раз и больше не восстановима: в базе лежит
 * только хеш токена (Р-009). Это сказано человеку прямо, а не спрятано —
 * иначе он закроет панель и потом будет искать, где посмотреть ещё раз.
 *
 * Одноразовость ссылки тоже названа вслух: приглашение на каждого своё,
 * и это не недоделка, а способ не давать одной утёкшей ссылке впустить
 * всех подряд.
 */

function linkFor(token: string): string {
  return `${window.location.origin}/?invite=${encodeURIComponent(token)}`;
}

export function InvitePanel() {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setCopied(false);
    try {
      const created = await api.createInvite();
      setLink(linkFor(created.token));
    } catch {
      setFailure("Не удалось выпустить приглашение");
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    if (!link) return;
    // Ссылка при этом на экране и выделяется — поэтому отказ буфера
    // не поломка, а повод сказать словами (shared/clipboard.ts).
    if (await toClipboard(link)) setCopied(true);
    else setFailure(NOT_COPIED);
  }

  if (!link) {
    return (
      <>
        <button type="button" className="rail-add" onClick={() => void issue()} disabled={busy}>
          {busy ? "Готовим ссылку…" : "Пригласить"}
        </button>
        {failure ? <p className="err rail-err">{failure}</p> : null}
      </>
    );
  }

  return (
    <div className="invite">
      <p className="invite-note">Ссылка на одного человека. Показывается один раз.</p>
      <input className="invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
      <div className="invite-row">
        <button type="button" className="quiet" onClick={() => void copy()}>
          {copied ? "Скопировано" : "Скопировать"}
        </button>
        <button type="button" className="quiet" onClick={() => setLink(null)}>
          Готово
        </button>
      </div>
      {failure ? <p className="err">{failure}</p> : null}
    </div>
  );
}
