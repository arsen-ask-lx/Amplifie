import { Check, Copy } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api } from "../data/api.js";
import { copyQuietly, ГАЛОЧКА_МС } from "../shared/clipboard.js";
import { Button } from "../shared/ui/button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../shared/ui/dialog.js";
import { Input } from "../shared/ui/input.js";

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

/**
 * Сколько дней осталось до срока. Считаем от того, что прислал сервер:
 * писать «30 дней» словами значит завести вторую копию знания, которая
 * соврёт при первой же правке порога на сервере.
 */
function дней(до: string): number {
  return Math.max(1, Math.round((new Date(до).getTime() - Date.now()) / 86_400_000));
}

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [срок, setСрок] = useState<{ дней: number; людей: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .invite()
      .then((made) => {
        if (!alive) return;
        // Адрес собирается ЗДЕСЬ, а не на сервере: сервер не знает, по
        // какому имени к нему пришли, и подставил бы своё внутреннее.
        setLink(`${window.location.origin}/join/${made.token}`);
        setСрок({ дней: дней(made.expiresAt), людей: made.maxUses });
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
    const timer = setTimeout(() => setCopied(false), ГАЛОЧКА_МС);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    /**
     * ⚠️ ОБЩЕЕ ОКНО, А НЕ СВОЙ `div role="dialog"`. Самодельное окно
     * выглядело так же, но не умело главного: с клавиатуры из него можно
     * было уйти табуляцией в страницу под ним, а страница ехала под
     * пальцем. Escape ловился обработчиком на самом узле — то есть
     * только пока фокус внутри.
     *
     * `open` всегда истинно: окном владеет тот, кто его показал, и
     * закрытие он получает через `onClose`. Свой признак «открыто»
     * здесь был бы вторым ответом на вопрос, на который уже отвечает
     * наличие узла.
     */
    <Dialog open onOpenChange={(открыто) => !открыто && onClose()}>
      <DialogContent className="sm:max-w-[30rem]">
        <DialogHeader>
          <DialogTitle>Пригласить в пространство</DialogTitle>
          <DialogDescription>
            Передайте ссылку любым способом. Открывший её заведёт себе вход и окажется здесь же.
          </DialogDescription>
        </DialogHeader>

        {failure ? <p className="text-body text-danger">{failure}</p> : null}

        {link ? (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={link}
              aria-label="Ссылка-приглашение"
              onFocus={(event) => event.currentTarget.select()}
              className="flex-1"
            />
            <Button
              type="button"
              size="icon-sm"
              aria-label={copied ? "Скопировано" : "Копировать ссылку"}
              title="Копировать ссылку"
              onClick={() => {
                // ⚠️ ЧЕРЕЗ ОБЩЕЕ МЕСТО, А НЕ СВОИМ ОБРАЩЕНИЕМ К БУФЕРУ.
                // Здесь стоял голый `navigator.clipboard` без обработки
                // отказа: браузер мог не дать, а окно всё равно показывало
                // галочку.
                //
                // Молча — потому что галочка на кнопке уже отвечает.
                // Отказ плашкой остаётся: при нём галочки нет.
                void copyQuietly(link).then(setCopied);
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        ) : null}

        {срок ? (
          <p className="text-aside text-muted">
            Ссылка живёт {срок.дней} дней, по ней может войти до {срок.людей} человек.
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Закрыть
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
