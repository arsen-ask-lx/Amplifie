import { useEffect, useState } from "react";
import type { SearchHit } from "../../data/api.js";
import { type SearchState, useSearch } from "../../data/useSearch.js";
import { lineOf, marksIn, snippetAround } from "../../shared/searchLine.js";
import { Button } from "../../shared/ui/button.js";
import { CommandField } from "../../shared/ui/command-field.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/ui/dialog.js";
import { focusField } from "../../shared/ui/focusAfterClose.js";
import { dayFormat } from "../../shared/when.js";

/**
 * Поиск по сообщениям всех видимых разговоров — окно по Ctrl+K (task-100).
 *
 * ⚠️ ОКНО НАБОРА (`Dialog`), А НЕ СВОЙ СЛОЙ (27.09). Свой слой держал только
 * Escape и щелчок мимо — Tab уводил фокус в ленту под окном.
 *
 * Выбор найденного — щелчком или стрелками и Enter: переход тем же адресом
 * `/c/<чат>/<номер>`, что у цитаты, и лента откроется вокруг сообщения
 * любой давности (task-099).
 */

/** Ширина строки выдачи в знаках: видно найденное и немного вокруг. */
const SNIPPET = 140;

/** Насколько близко к низу выдачи догружается следующая страница. */
const NEAR_BOTTOM = 120;

function Hit({
  hit,
  words,
  active,
  onPick,
}: {
  hit: SearchHit;
  words: string[];
  active: boolean;
  onPick: () => void;
}) {
  const line = snippetAround(lineOf(hit.body), words, SNIPPET);
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === "Enter") onPick();
      }}
      className={[
        "flex cursor-pointer flex-col gap-0.5 rounded px-3 py-2 text-left transition-colors",
        active ? "bg-raised" : "hover:bg-raised",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-baseline gap-2 text-mark text-muted">
        <span className="truncate font-medium text-accent-ink">{hit.conversationTitle}</span>
        <span className="truncate">{hit.author.name}</span>
        <span className="ml-auto shrink-0">{dayFormat.format(new Date(hit.createdAt))}</span>
      </span>
      <span className="line-clamp-2 text-aside text-ink">
        {marksIn(line, words).map((mark, at) =>
          mark.hit ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: куски позиционные, строка пересобирается целиком
            <mark key={at} className="rounded-sm bg-accent/20 text-ink">
              {mark.text}
            </mark>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: см. выше
            <span key={at}>{mark.text}</span>
          ),
        )}
      </span>
    </div>
  );
}

/** Строка состояния под полем: подсказка, ожидание, пусто, отказ. */
function Status({ state, onRetry }: { state: SearchState; onRetry: () => void }) {
  if (state.kind === "отказ") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 text-aside text-danger">
        <p>Не удалось выполнить поиск</p>
        <Button variant="outline" size="xs" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  }
  const shown = hintOf(state);
  return shown ? <p className="px-4 py-3 text-aside text-muted">{shown}</p> : null;
}

/** Подсказка состояния; `null` — выдача говорит сама. */
function hintOf(state: SearchState): string | null {
  if (state.kind === "пусто") return "Найдите сообщение по слову во всех своих чатах";
  if (state.kind === "коротко") return "Введите хотя бы два знака";
  if (state.kind === "ищем") return "Ищем…";
  if (state.kind === "найдено" && state.items.length === 0) return "Ничего не нашли";
  return null;
}

export function SearchDialog({
  onOpen,
  onClose,
}: {
  /** Открыть найденное: разговор и номер реплики. */
  onOpen: (conversationId: string, seq: number) => void;
  onClose: () => void;
}) {
  const { query, setQuery, words, state, loadMore, retry } = useSearch();
  const [active, setActive] = useState(0);
  const items = state.kind === "найдено" ? state.items : [];

  // Новая выдача — выбор снова сверху.
  // biome-ignore lint/correctness/useExhaustiveDependencies: сброс по смене запроса и есть смысл
  useEffect(() => setActive(0), [words.join(" ")]);

  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onOpen(hit.conversationId, hit.seq);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusField();
        }}
        className="top-[12vh] flex max-h-[70vh] w-full translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Поиск по сообщениям</DialogTitle>
        <CommandField
          value={query}
          label="Что искать"
          placeholder="Поиск по сообщениям"
          onChange={setQuery}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((at) => Math.min(at + 1, items.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((at) => Math.max(at - 1, 0));
            } else if (event.key === "Enter") {
              pick(items[active]);
            }
          }}
        />

        <Status state={state} onRetry={retry} />

        {items.length > 0 ? (
          <div
            role="listbox"
            aria-label="Найденные сообщения"
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-1"
            onScroll={(event) => {
              const node = event.currentTarget;
              if (node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM) loadMore();
            }}
          >
            {items.map((hit, at) => (
              <Hit
                key={hit.id}
                hit={hit}
                words={words}
                active={at === active}
                onPick={() => pick(hit)}
              />
            ))}
            {state.kind === "найдено" && state.broken ? (
              <div className="flex items-center gap-3 px-3 py-2 text-aside text-danger">
                <p>Не удалось загрузить ещё</p>
                <Button variant="outline" size="xs" onClick={loadMore}>
                  Повторить
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
