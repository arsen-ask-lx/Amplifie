import { useCallback, useEffect, useState } from "react";
import { api, type ModelKey } from "../../data/api.js";
import { detailOf, fieldsOf } from "../../shared/failure.js";
import { Icon } from "../../shared/Icon.js";
import { keyTroubleOf } from "../../shared/trouble.js";
import { Button } from "../../shared/ui/button.js";

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
 */

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", prefix: "sk-ant-" },
  { id: "openai", label: "OpenAI", prefix: "sk-" },
];

const SCOPES = [
  { id: "участник", label: "Только мой", why: "Платите вы, видите только вы." },
  {
    id: "пространство",
    label: "Общий для пространства",
    why: "Им пользуются все, у кого нет своего. Законная замена «поделиться подпиской».",
  },
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

/** Выбор из списка. Два поля отличались только подписью и набором. */
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
  return (
    <label className="flex flex-col gap-1 text-aside text-muted">
      {label}
      <select value={value} onChange={(event) => onPick(event.target.value)}>
        {options.map((one) => (
          <option key={one.id} value={one.id}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Saved({ item, onRemove }: { item: ModelKey; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-body">
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
    <section className="mb-6" aria-labelledby="ключ">
      <h3 id="ключ" className="mb-3 text-lead font-semibold text-ink">
        Ключ API
      </h3>

      <p className="mt-2 text-body leading-relaxed text-muted">
        Второй путь, кроме подписки: обычный ключ поставщика, целиком на сайте и без терминала. Ключ
        шифруется и <b>обратно не показывается никогда</b> — только последние знаки, чтобы вы его
        узнали.
      </p>

      {items.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {items.map((item) => (
            <Saved key={item.id} item={item} onRemove={() => void remove(item.id)} />
          ))}
        </ul>
      ) : null}

      <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <Choice label="Поставщик" value={provider} options={PROVIDERS} onPick={setProvider} />

        <label className="flex flex-col gap-1 text-aside text-muted">
          Ключ
          <input
            type="password"
            value={key}
            placeholder={shape ? `${shape.prefix}…` : ""}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>

        <Choice label="Кому" value={scope} options={SCOPES} onPick={setScope} />

        <p className="text-aside text-muted">{SCOPES.find((one) => one.id === scope)?.why}</p>

        <Button type="submit" disabled={busy || key.trim().length === 0}>
          <Icon name="плюс" />
          {busy ? "Сохраняем…" : "Сохранить ключ"}
        </Button>
      </form>

      {failure ? <p className="mt-2 text-aside text-danger">{failure}</p> : null}
    </section>
  );
}
