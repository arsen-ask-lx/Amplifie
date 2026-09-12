-- Демо-канал с диалогом: посмотреть, как лента выглядит, когда говорит
-- не один человек. ДЕВ-ДАННЫЕ, а не миграция: живут только в этой базе
-- и стираются вместе с ней (`make reset`). Запуск: `make demo`.
--
-- ⚠️ В КОНЦЕ ОБЯЗАТЕЛЬНО ПОДВИНУТЬ СЧЁТЧИК ПРОСТРАНСТВА. Номера сообщений
-- раздаёт `workspace.last_seq`, а не сама таблица. Первая редакция этого
-- набора вставляла реплики напрямую и счётчик не трогала — после чего
-- ЛЮБАЯ отправка из приложения падала пятисоткой: сервер выдавал номер,
-- который уже занят. Поймано живым прогоном; из самой вставки это не видно
-- вовсе, потому и написано здесь заглавными.
BEGIN;

WITH me AS (
  SELECT p.id AS pid, p.workspace_id AS wid
  FROM participant p
  JOIN account a ON a.id = p.account_id
  WHERE a.email = 'arsen@amplifie.local'
),
-- Пароль намеренно негодный: войти этими учётными записями нельзя,
-- они существуют только чтобы у реплик был автор.
gosts AS (
  INSERT INTO account (email, password_hash) VALUES
    ('demo.marina@amplifie.local', 'не-пароль'),
    ('demo.pavel@amplifie.local',  'не-пароль')
  RETURNING id, email
),
folk AS (
  INSERT INTO participant (workspace_id, account_id, kind, display_name, role)
  SELECT (SELECT wid FROM me), g.id, 'human',
         CASE g.email WHEN 'demo.marina@amplifie.local' THEN 'Марина' ELSE 'Павел' END,
         'member'
  FROM gosts g
  RETURNING id, display_name
),
room AS (
  INSERT INTO conversation (workspace_id, kind, title)
  SELECT wid, 'channel', 'Демо' FROM me
  RETURNING id, workspace_id
),
script AS (
  SELECT * FROM (VALUES
    (1,  'Марина', 'Привет! Сверила цифры за август — расхождение по двум позициям.'),
    (2,  'Марина', 'Скинуть таблицей или достаточно словами?'),
    (3,  'я',      'Давай таблицей, так быстрее увижу.'),
    (4,  'Павел',  'Я тоже посмотрю. У меня как раз открыт прошлый отчёт.'),
    (5,  'Марина', 'Хорошо, через полчаса пришлю.'),
    (6,  'я',      'Спасибо. И заодно глянь, не поехали ли даты — в июле такое было.'),
    (7,  'Павел',  'В июле сдвиг был из-за выгрузки: она берёт дату записи, а не дату события. Мы тогда чинили руками, а причину не трогали — значит повторится.'),
    (8,  'я',      'Понял. Заведу задачу, чтобы починить причину, а не следствие.'),
    (9,  'Марина', 'Плюс.'),
    (10, 'я',      'Готово.')
  ) AS t(n, who, body)
)
INSERT INTO message
  (workspace_id, conversation_id, author_participant_id, body, kind, trust, client_msg_id, seq, created_at)
SELECT
  (SELECT workspace_id FROM room),
  (SELECT id FROM room),
  CASE s.who
    WHEN 'я' THEN (SELECT pid FROM me)
    ELSE (SELECT id FROM folk WHERE display_name = s.who)
  END,
  s.body,
  'human',
  'trusted',
  gen_random_uuid(),
  (SELECT COALESCE(MAX(seq), 0) FROM message WHERE workspace_id = (SELECT wid FROM me)) + s.n,
  now() - ((11 - s.n) * interval '4 minutes')
FROM script s;

-- Тот самый счётчик. Без этой строки приложение перестаёт отправлять.
UPDATE workspace w
SET last_seq = GREATEST(
  w.last_seq,
  (SELECT COALESCE(MAX(m.seq), 0) FROM message m WHERE m.workspace_id = w.id)
);

COMMIT;
