import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "../../data/api.js";
import { type SearchState, useSearch } from "../../data/useSearch.js";
import { lineOf, marksIn, snippetAround } from "../../shared/searchLine.js";
import { Button } from "../../shared/ui/button.js";
import { useDismiss } from "../../shared/useDismiss.js";
import { dayFormat } from "../../shared/when.js";

/**
 * Поиск по сообщениям всех видимых разговоров — окно по Ctrl+K (task-100).
 *
 * ⚠️ СВОЙ СЛОЙ, КАК У ОКНА ПЕРЕСЫЛКИ, А НЕ ДИАЛОГ НАБОРА. Нужны ровно два
 * правила — Escape и щелчок мимо (`useDismiss`).
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
  const box = useRef<HTMLDivElement>(null);
  const { query, setQuery, words, state, loadMore, retry } = useSearch();
  const [active, setActive] = useState(0);
  const items = state.kind === "найдено" ? state.items : [];

  // Новая выдача — выбор снова сверху.
  // biome-ignore lint/correctness/useExhaustiveDependencies: сброс по смене запроса и есть смысл
  useEffect(() => setActive(0), [words.join(" ")]);

  // Escape и щелчок мимо — общим правилом слоёв.
  useDismiss(box, onClose);

  const pick = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onOpen(hit.conversationId, hit.seq);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-ink/20 p-4 pt-[12vh]">
      <div
        ref={box}
        role="dialog"
        aria-label="Поиск по сообщениям"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-card shadow-float"
      >
        <label className="flex items-center gap-2 border-b border-line px-4 py-3">
          <MagnifyingGlass className="size-5 shrink-0 text-muted" aria-hidden="true" />
          <input
            type="search"
            // biome-ignore lint/a11y/noAutofocus: окно открыто сочетанием ради набора — фокус и есть его назначение
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
            placeholder="Поиск по сообщениям"
            aria-label="Что искать"
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-muted"
          />
        </label>

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
      </div>
    </div>
  );
}
