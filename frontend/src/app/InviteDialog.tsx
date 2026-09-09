import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api } from "../data/api.js";
import { copyAndTell } from "../shared/clipboard.js";
import { СКОПИРОВАНО } from "../shared/toast.js";
import { Button } from "../shared/ui/button.js";

/**
 * Окно «Пригласить в пространство».
 *
 * ⚠️ ССЫЛКА ВЫДАЁТСЯ ПРИ ОТКРЫТИИ, А НЕ ЛЕЖИТ ГОТОВОЙ. В базе живёт
 * только хеш токена, поэтому показать «текущую ссылку» второй раз нельзя
 * ни нам, ни кому-либо ещё: значение существует ровно один раз, в этом
 * ответе сервера. Потерял — открыл снова и получил новую.
 *
 * ⚠️ КОПИРОВАНИЕ ЗНАЧКОМ, БЕЗ НАДПИСИ «СКОПИРОВАНО». После нажатия
 * значок на полторы секунды становится галочкой — так у Телеграма,
 * и так у нас в блоке кода. Одно поведение на две кнопки.
 */

/** Сколько держится галочка после копирования. Столько же, что в коде. */
const COPIED_MS = 1500;

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .invite()
      .then((made) => {
        // Адрес собирается ЗДЕСЬ, а не на сервере: сервер не знает, по
        // какому имени к нему пришли, и подставил бы своё внутреннее.
        if (alive) setLink(`${window.location.origin}/join/${made.token}`);
      })
      .catch(() => {
        if (alive) setFailure("Не вышло сделать ссылку. Попробуйте ещё раз.");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <div className="w-full max-w-[30rem] rounded-xl border border-line bg-card p-5 shadow-float">
        <h2 id="invite-title" className="text-lead font-medium text-ink">
          Пригласить в пространство
        </h2>
        <p className="mt-2 text-body leading-relaxed text-muted">
          Передайте ссылку любым способом. Открывший её заведёт себе вход и окажется здесь же.
        </p>

        {failure ? <p className="mt-4 text-body text-danger">{failure}</p> : null}

        {link ? (
          <div className="mt-4 flex items-center gap-2">
            <input
              readOnly
              value={link}
              aria-label="Ссылка-приглашение"
              onFocus={(event) => event.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 text-body text-ink outline-none"
            />
            <Button
              type="button"
              size="icon-sm"
              aria-label={copied ? "Скопировано" : "Копировать ссылку"}
              title="Копировать ссылку"
              onClick={() => {
                // ⚠️ ЧЕРЕЗ ОБЩИЙ `copyAndTell`, А НЕ СВОИМ ОБРАЩЕНИЕМ
                // К БУФЕРУ. Здесь стоял голый `navigator.clipboard` без
                // обработки отказа: браузер мог не дать, а окно всё равно
                // показывало галочку. Общее место и копирует, и говорит.
                void copyAndTell(link, СКОПИРОВАНО.ссылка).then(setCopied);
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        ) : null}

        <p className="mt-3 text-aside text-muted">
          Ссылка живёт 30 дней, по ней может войти до 50 человек.
        </p>

        <div className="mt-5 flex justify-end">
          <Button type="button" variant="ghost" autoFocus onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  );
}
