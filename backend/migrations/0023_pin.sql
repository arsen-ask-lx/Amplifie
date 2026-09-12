-- Закрепление в панели — ЛИЧНОЕ (task-038, закрывает Д-32).
--
-- ⚠️ СВОЯ ТАБЛИЦА, А НЕ КОЛОНКА У РАЗГОВОРА. Колонка `pinned_at`
-- у `conversation` означала бы одно закрепление на всё пространство:
-- поднял себе — поднял всем. Владелец 10.09 выбрал личное, и так же
-- устроено у всех, у кого мы смотрели: закреплённые чаты в Телеграме
-- свои у каждого, разделы боковой панели в Слаке «видны только вам».
--
-- ⚠️ ДВЕ ССЫЛКИ И `CHECK` НА РОВНО ОДНУ — А НЕ ПОЛЕ «ТИП» СО СТРОКОЙ.
-- Полиморфная пара «тип плюс номер» отняла бы у нас внешние ключи:
-- удалённый проект оставлял бы висеть закрепление в никуда, и панель
-- однажды показала бы папку, которой нет. Здесь обе ссылки настоящие,
-- обе с каскадом, а `CHECK` не даёт закрепить сразу и то и другое.
--
-- ⚠️ КЛЮЧ АРЕНДАТОРА ЛЕЖИТ РЯДОМ (Р-7). RLS у нас нет, арендатор
-- отсекается в приложении, но колонка нужна индексу: без неё выборка
-- по пространству идёт мимо него.
CREATE TABLE "pin" (
	"participant_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid,
	"project_id" uuid,
	"pinned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_participant_id_participant_id_fk"
	FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_workspace_id_workspace_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_conversation_id_conversation_id_fk"
	FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pin" ADD CONSTRAINT "pin_project_id_project_id_fk"
	FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Закрепляют ЛИБО разговор, ЛИБО проект. Ни пусто, ни оба сразу.
ALTER TABLE "pin" ADD CONSTRAINT "pin_one_subject_ck"
	CHECK (("conversation_id" IS NULL) <> ("project_id" IS NULL));
--> statement-breakpoint
-- ⚠️ ДВА ЧАСТИЧНЫХ УНИКАЛЬНЫХ, А НЕ ОДИН ОБЩИЙ. В обычном уникальном
-- индексе NULL не равен NULL, и один и тот же чат закрепился бы дважды.
-- На повторное закрепление опирается идемпотентность двери
-- (`ON CONFLICT DO NOTHING`): нажать булавку второй раз — не ошибка.
CREATE UNIQUE INDEX "pin_conversation_uq" ON "pin" USING btree ("participant_id","conversation_id")
	WHERE "conversation_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "pin_project_uq" ON "pin" USING btree ("participant_id","project_id")
	WHERE "project_id" is not null;
--> statement-breakpoint
-- Панель — самый частый запрос продукта, и она читает закрепления
-- целиком по человеку: индекс под это, а не под пару.
CREATE INDEX "pin_participant_idx" ON "pin" USING btree ("participant_id");
