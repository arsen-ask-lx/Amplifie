-- Прочитанное переезжает из `conversation_member` в свою таблицу
-- (Р-029, исправление).
--
-- ⚠️ ПРИЧИНА — НАСТОЯЩИЙ ОТКАЗ, А НЕ ВКУС. Номер прочтения жил колонкой
-- в `conversation_member`, и это молча предполагало, что у читателя
-- ВСЕГДА есть строка участника. Её нет: канал виден всему пространству
-- (`visibility = 'workspace'`), и человек читает его, не будучи
-- участником. У всех, кто вошёл в пространство позже заведения канала,
-- отметка прочтения не находила строки, отвечала 404 и глохла —
-- число непрочитанного не гасло никогда. Поймано владельцем на канале
-- «Демо»: шесть непрочитанных, которые он прочёл.
--
-- ⚠️ ЧЛЕНСТВО И ПРОЧТЕНИЕ — РАЗНЫЕ ЗНАНИЯ, и это главный вывод.
-- Первое про ПРАВА, второе про ВЗГЛЯД. Соблазн дописывать строку
-- участника при первом же чтении был велик и неверен: тогда в будущем
-- списке участников канала оказались бы все, кто туда просто заглянул.
--
-- Данные переносятся: у кого номер уже стоял, тот не перечитывает.
CREATE TABLE "conversation_read" (
	"conversation_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"read_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "conversation_read_pk" PRIMARY KEY("conversation_id","participant_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_read" ADD CONSTRAINT "conversation_read_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_read" ADD CONSTRAINT "conversation_read_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "conversation_read" ("conversation_id", "participant_id", "read_seq")
	SELECT "conversation_id", "participant_id", "read_seq"
	FROM "conversation_member" WHERE "read_seq" > 0;--> statement-breakpoint
ALTER TABLE "conversation_member" DROP COLUMN "read_seq";
