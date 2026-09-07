import { useState } from "react";
import { api } from "../data/api.js";
import { NOT_COPIED, copy as toClipboard } from "../shared/clipboard.js";
import { Button } from "../shared/ui/button.js";

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
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted"
          onClick={() => void issue()}
          disabled={busy}
        >
          {busy ? "Готовим ссылку…" : "Пригласить"}
        </Button>
        {failure ? <p className="px-2.5 text-aside text-danger">{failure}</p> : null}
      </>
    );
  }

  return (
    <div className="rounded border border-line bg-raised p-2">
      <p className="mb-2 text-mark text-muted">Ссылка на одного человека. Показывается один раз.</p>
      <input
        readOnly
        value={link}
        onFocus={(e) => e.target.select()}
        className="h-8 w-full rounded border border-edge bg-bg px-2 text-mark text-ink outline-none"
      />
      <div className="mt-2 flex gap-1">
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? "Скопировано" : "Скопировать"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setLink(null)}>
          Готово
        </Button>
      </div>
      {failure ? <p className="mt-1 text-mark text-danger">{failure}</p> : null}
    </div>
  );
}
