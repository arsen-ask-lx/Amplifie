-- Поиск по сообщениям (task-100): таблица-производная, триггер, заполнение.
-- Порядок значим: функции → таблица → триггеры → заполнение под замком →
-- индексы. Разбор и замеры шага 0 — dock/tasks/task-100-поиск-по-сообщениям.md.

-- Текст для индекса: упоминание — его подписью. Номер участника иначе
-- рассыпается на лексемы вроде `b3fc`, и поиск по началу хэша коммита
-- находил бы чужие упоминания (проверено на базе стенда 17.09).
-- ⚠️ ВЫРАЖЕНИЕ ОБЯЗАНО СОВПАДАТЬ С `MENTION_SOURCE` В `packages/contract`:
-- это стережёт точечный `talk/search.test.ts` и приёмочный П-4.
CREATE FUNCTION search_text(body text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
    body,
    '\[([^\]\n]+)\]\(@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)',
    '\1',
    'g'
  )
$$;
--> statement-breakpoint

-- Вектор: основы слов (`russian` разбирает и английские) плюс слова как есть
-- с ё → е (`simple`, для поиска по началу слова).
CREATE FUNCTION search_doc(body text) RETURNS tsvector
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_tsvector('russian'::regconfig, search_text(body))
      || to_tsvector('simple'::regconfig, replace(lower(search_text(body)), 'ё', 'е'))
$$;
--> statement-breakpoint

CREATE TABLE "message_search" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"doc" "tsvector" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_search" ADD CONSTRAINT "message_search_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- ⚠️ ТОЧНОСТЬ СТАТИСТИКИ ВЫШЕ ОБЫЧНОЙ, И ЭТО ГЛАВНОЕ ЧИСЛО ПОИСКА. С обычной
-- (100) Postgres не знает редких слов и оценивает их заглушкой: планировщик
-- идёт обходом по номеру и на миллионе реплик читал до 391 тыс. строк (175 мс).
-- С 1000 он сам выбирает выборку из индекса слов для редкого и обход для
-- частого: худший случай 22 мс (замер шага 0, 1 млн, словарь 30 тыс. слов).
ALTER TABLE "message_search" ALTER COLUMN "doc" SET STATISTICS 1000;
--> statement-breakpoint

-- Триггер держит таблицу в согласии с репликами на любом пути записи.
-- Мягкое удаление стирает тело в '' — строка поиска уходит.
CREATE FUNCTION message_search_sync() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.body = '' THEN
    DELETE FROM message_search WHERE message_id = NEW.id;
  ELSE
    INSERT INTO message_search (message_id, workspace_id, conversation_id, seq, doc)
    VALUES (NEW.id, NEW.workspace_id, NEW.conversation_id, NEW.seq, search_doc(NEW.body))
    ON CONFLICT (message_id) DO UPDATE SET doc = EXCLUDED.doc;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER message_search_on_insert AFTER INSERT ON "message"
  FOR EACH ROW EXECUTE FUNCTION message_search_sync();
--> statement-breakpoint
-- Закрепление и сдвиг номера изменения триггер не будят: только тело и удаление.
CREATE TRIGGER message_search_on_change AFTER UPDATE OF body, deleted_at ON "message"
  FOR EACH ROW EXECUTE FUNCTION message_search_sync();
--> statement-breakpoint

-- ⚠️ ЗАПОЛНЕНИЕ ПОД ЗАМКОМ, И ЭТО НЕ ПЕРЕСТРАХОВКА. Старый `api` пишет, пока
-- идёт миграция (`compose.yml`): без замка реплика, записанная между снимком
-- этой выборки и фиксацией триггера, не искалась бы никогда. Замок держится
-- до фиксации миграции; на стенде это секунды, на миллионе — полторы минуты.
-- Порог: база больше миллиона реплик до этой миграции — заполнение порциями,
-- своим планом.
LOCK TABLE "message" IN SHARE MODE;
--> statement-breakpoint
INSERT INTO message_search (message_id, workspace_id, conversation_id, seq, doc)
SELECT id, workspace_id, conversation_id, seq, search_doc(body)
FROM "message"
WHERE deleted_at IS NULL AND body <> '';
--> statement-breakpoint

-- Индексы после заполнения: GIN, построенный разом, быстрее вставок по одной.
CREATE INDEX "message_search_doc_idx" ON "message_search" USING gin ("doc");
--> statement-breakpoint
CREATE INDEX "message_search_workspace_seq_idx" ON "message_search" USING btree ("workspace_id","seq");
--> statement-breakpoint
ANALYZE "message_search";
