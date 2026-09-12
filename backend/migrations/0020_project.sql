-- Проект: папка чатов и область чтения агента (Р-032, task-034).
--
-- ⚠️ ПРИНАДЛЕЖНОСТЬ — КОЛОНКА У РАЗГОВОРА, А НЕ ТАБЛИЦА СВЯЗЕЙ, И ЭТО
-- ВЫБОР С НАЗВАННЫМ ПОРОГОМ. Matrix позволяет комнате быть сразу
-- в нескольких пространствах (`m.space.child`/`m.space.parent`), и это
-- у них замысел, а не побочный эффект. Мы берём одну принадлежность:
-- владелец назвал именно её, а от ответа «в каком проекте он на самом
-- деле» зависит область чтения агента — с двумя ответами она перестаёт
-- быть определённой.
--
-- Порог пересмотра: первый чат, который по-настоящему нужен в двух
-- проектах. Тогда колонка превращается в таблицу связей обычной
-- миграцией. Обратный путь дороже: он требует выбросить половину
-- связей и решить, какую именно.
--
-- ⚠️ ПРАВ ПРОЕКТ НЕ НЕСЁТ. Ни состава участников, ни видимости: кто
-- видит чат — решает чат (Р-010). У Rocket.Chat команда носит свой
-- состав поверх состава каналов, и тогда на вопрос «почему он это
-- видит» приходится отвечать двумя проверками вместо одной.
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_workspace_idx" ON "project" USING btree ("workspace_id");
--> statement-breakpoint
-- ⚠️ `ON DELETE SET NULL`, А НЕ КАСКАД. Удаление проекта — это снятие
-- ярлыка, а не уничтожение переписки. Каскад унёс бы чаты вместе
-- с папкой, и это было бы худшей возможной трактовкой слова «удалить».
ALTER TABLE "conversation" ADD COLUMN "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk"
	FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Чатов вне проектов много и будет много: частичный индекс, а не полный.
CREATE INDEX "conversation_project_idx" ON "conversation" USING btree ("project_id") WHERE "project_id" is not null;
