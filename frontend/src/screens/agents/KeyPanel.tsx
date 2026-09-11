import { useCallback, useEffect, useId, useState } from "react";
import { api, type ModelKey } from "../../data/api.js";
import { detailOf, fieldsOf } from "../../shared/failure.js";
import { Icon } from "../../shared/Icon.js";
import { keyTroubleOf } from "../../shared/trouble.js";
import { Button } from "../../shared/ui/button.js";
import { Input } from "../../shared/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select.js";

/**
 * Ключ поставщика модели: ввести, увидеть, убрать.
 *
 * ⚠️ КЛЮЧ УХОДИТ ОДИН РАЗ И ОБРАТНО НЕ ВОЗВРАЩАЕТСЯ. Сервер не отдаёт его
 * ни одной ручкой — только подсказку из последних знаков (Р-016). Поэтому
 * здесь нет «показать ключ» и не может быть: показывать нечего.
 *
 * Поле ввода очищается сразу после сохранения. Не из вежливости: набранный
 * ключ, оставшийся в поле, попадёт в снимок экрана и в восстановление формы
 * браузером.
 *
 * ⚠️ НИ ЗАГОЛОВКА, НИ ОПИСАНИЯ У ПАНЕЛИ НЕТ. Хозяев двое — раздел
 * «Агенты» и окно установки, — и говорят они разными словами. Панель,
 * несущая своё вступление, во втором хозяине давала два описания подряд.
 */

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", prefix: "sk-ant-" },
  { id: "openai", label: "OpenAI", prefix: "sk-" },
];

/**
 * Кому принадлежит ключ.
 *
 * Пояснений при выборе нет намеренно: сами названия говорят всё, а два
 * абзаца под тремя полями превращали окно в инструкцию.
 */
const SCOPES = [
  { id: "участник", label: "Только мой" },
  { id: "пространство", label: "Общий для пространства" },
];

function explain(error: unknown): string {
  switch (keyTroubleOf(error)) {
    case "не-та-форма":
      return detailOf(error) ?? Object.values(fieldsOf(error))[0] ?? "Ключ не той формы.";
    case "негде-хранить":
      return "Сервер не настроен для хранения секретов: не задан AMPLIFIE_SECRET_KEY.";
    default:
      return "Не удалось сохранить ключ.";
  }
}

/**
 * Выбор из списка. Два поля отличались только подписью и набором.
 *
 * ⚠️ КОМПОНЕНТ НАБОРА, А НЕ ГОЛЫЙ `<select>`. Родной список браузера
 * не берёт ни наших цветов, ни размеров: рядом с остальным продуктом
 * он выглядит чужим — и это ровно то, ради чего заведён набор (Р-018).
 */
function Choice({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onPick: (id: string) => void;
}) {
  // Подпись связана с кнопкой списка по имени: обернуть её `<label>`
  // нельзя — внутри не поле браузера, а свой узел, и подпись повисла бы
  // ни на чём. Это поймал сторож доступности, и он прав.
  const labelId = useId();

  return (
    <div className="flex flex-col gap-1 text-aside text-muted">
      <span id={labelId}>{label}</span>
      <Select value={value} onValueChange={onPick}>
        <SelectTrigger
          aria-labelledby={labelId}
          className="field-baseline w-full !rounded-xl !border-0 !border-b !border-line !bg-raised text-ink focus-visible:!outline-none focus-visible:!shadow-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((one) => (
            <SelectItem key={one.id} value={one.id}>
              {one.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Saved({ item, onRemove }: { item: ModelKey; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg bg-raised px-3 py-2 text-body">
      <span className="text-ink">
        {item.provider} · <span className="text-muted">…{item.hint}</span>
      </span>
      <span className="text-aside text-muted">{item.scope === "участник" ? "мой" : "общий"}</span>
      <Button variant="ghost" size="sm" onClick={onRemove}>
        Убрать
      </Button>
    </li>
  );
}

export function KeyPanel({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<ModelKey[]>([]);
  const [provider, setProvider] = useState(PROVIDERS[0]?.id ?? "anthropic");
  const [scope, setScope] = useState(SCOPES[0]?.id ?? "участник");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const keyId = useId();

  const reload = useCallback(async () => {
    try {
      setItems((await api.modelKeys()).items);
    } catch {
      // Список — не то, ради чего стоит ронять экран: ввод ниже работает.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      await api.addModelKey({ provider, key: key.trim(), scope });
      // Сразу, а не в конце: чем меньше живёт набранный ключ, тем лучше.
      setKey("");
      await reload();
      onChange();
    } catch (error) {
      setFailure(explain(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.removeModelKey(id);
    await reload();
    onChange();
  }

  const shape = PROVIDERS.find((one) => one.id === provider);

  return (
    <div>
      {items.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {items.map((item) => (
            <Saved key={item.id} item={item} onRemove={() => void remove(item.id)} />
          ))}
        </ul>
      ) : null}

      <form
        className={items.length > 0 ? "mt-4" : undefined}
        onSubmit={(event) => void save(event)}
      >
        <div className="grid gap-4">
          <Choice label="Поставщик" value={provider} options={PROVIDERS} onPick={setProvider} />

          <label className="flex flex-col gap-1 text-aside text-muted" htmlFor={keyId}>
            Ключ
            <Input
              id={keyId}
              type="password"
              value={key}
              placeholder={shape ? `${shape.prefix}…` : ""}
              className="field-baseline !rounded-xl !border-0 !border-b !border-line !bg-raised focus-visible:!outline-none focus-visible:!shadow-none"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setKey(event.target.value)}
            />
          </label>

          <Choice label="Кому" value={scope} options={SCOPES} onPick={setScope} />
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={busy || key.trim().length === 0}>
            <Icon name="plus" />
            {busy ? "Сохраняем…" : "Сохранить ключ"}
          </Button>
        </div>
      </form>

      {failure ? <p className="mt-2 text-aside text-danger">{failure}</p> : null}
    </div>
  );
}
