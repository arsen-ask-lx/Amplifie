-- Кого позвали в сообщении (Р-031, task-033).
--
-- ⚠️ ОТДЕЛЬНАЯ ТАБЛИЦА, ХОТЯ УПОМИНАНИЕ ЛЕЖИТ В ТЕЛЕ. Это не вторая
-- копия разметки: здесь нет ни смещений, ни текста — только «этого
-- позвали здесь». Без неё число упоминаний у канала считалось бы
-- поиском подстроки по всей переписке, и считалось бы на каждом
-- открытии списка каналов.
--
-- ⚠️ КАСКАД ОТ СООБЩЕНИЯ, А НЕ ОТ УЧАСТНИКА, — РАЗНЫЕ ПРИЧИНЫ.
-- Сообщение удаляется жёстко только вместе с разговором или
-- пространством: тогда и звать некого. Участник же уходит из
-- пространства целиком — и его строки уходят с ним, иначе счётчик
-- считал бы упоминания того, кого нет.
--
-- Ключ — пара. Позвать одного человека дважды в одном сообщении
-- значит позвать его один раз.
CREATE TABLE "message_mention" (
	"message_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	CONSTRAINT "message_mention_pk" PRIMARY KEY("message_id","participant_id")
);
--> statement-breakpoint
ALTER TABLE "message_mention" ADD CONSTRAINT "message_mention_message_id_message_id_fk"
	FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_mention" ADD CONSTRAINT "message_mention_participant_id_participant_id_fk"
	FOREIGN KEY ("participant_id") REFERENCES "public"."participant"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Счёт идёт всегда от человека: «сколько раз позвали МЕНЯ». Номер
-- участника первым полем, иначе индекс на этот вопрос не отвечает.
CREATE INDEX "message_mention_participant_idx" ON "message_mention" USING btree ("participant_id","message_id");
