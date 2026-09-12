ALTER TABLE "task" ALTER COLUMN "agreement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "status" SET DEFAULT 'к работе';--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "responsible_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_responsible_id_participant_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."participant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant" ADD CONSTRAINT "participant_id_kind_uq" UNIQUE("id","kind");--> statement-breakpoint
-- Дальше руками: генератор не умеет ни сгенерированных столбцов,
-- ни составных внешних ключей, ни проверок списком.

-- ① Старые стадии переезжают в новые имена. Явно, а не удалением столбца:
-- в задачах уже есть данные, и терять их нельзя.
--
-- Прежняя проверка снимается ПЕРВОЙ: она держит старый список
-- (open/doing/done/dropped), и без этого не пройдёт даже первый UPDATE.
ALTER TABLE "task" DROP CONSTRAINT IF EXISTS "task_status_ck";--> statement-breakpoint

UPDATE "task" SET "status" = 'к работе' WHERE "status" = 'open';--> statement-breakpoint
UPDATE "task" SET "status" = 'в работе' WHERE "status" = 'doing';--> statement-breakpoint
UPDATE "task" SET "status" = 'готово' WHERE "status" = 'done';--> statement-breakpoint
UPDATE "task" SET "status" = 'отменена' WHERE "status" = 'dropped';--> statement-breakpoint

-- ② Список стадий закрыт. Свободный текст превращает доску в свалку:
-- «в работе», «в работе », «В работе» стали бы тремя колонками.
ALTER TABLE "task" ADD CONSTRAINT "task_stage_known" CHECK (
  "status" IN ('к работе', 'в работе', 'на проверке', 'готово', 'отменена'));--> statement-breakpoint

-- ③ ГЛАВНОЕ. «За результат отвечает человек» — правило владельца, и здесь
-- оно перестаёт быть договорённостью на словах.
--
-- Столбец-константа плюс составной внешний ключ на (id, kind) участника.
-- Записать ответственным агента становится невозможно ФИЗИЧЕСКИ: строки
-- (id_агента, 'human') в participant не существует, и вставка отвергается
-- базой — хоть из приложения, хоть из psql.
--
-- Столбец сгенерированный, а не обычный: обычный можно было бы записать
-- вручную и обойти проверку.
ALTER TABLE "task" ADD COLUMN "responsible_kind" text
  GENERATED ALWAYS AS ('human') STORED;--> statement-breakpoint

-- Простой внешний ключ на participant(id) больше не нужен: составной
-- строже и включает его.
ALTER TABLE "task" DROP CONSTRAINT "task_responsible_id_participant_id_fk";--> statement-breakpoint

ALTER TABLE "task" ADD CONSTRAINT "task_responsible_is_human"
  FOREIGN KEY ("responsible_id", "responsible_kind")
  REFERENCES "public"."participant"("id", "kind") ON DELETE RESTRICT;--> statement-breakpoint

-- ④ У старых задач ответственный — тот, кто подтвердил договорённость.
-- Задача без хозяина — это то, ради чего доска и заводится.
UPDATE "task" t SET "responsible_id" = a."confirmed_by"
  FROM "agreement" a
  WHERE a."id" = t."agreement_id" AND a."confirmed_by" IS NOT NULL;
