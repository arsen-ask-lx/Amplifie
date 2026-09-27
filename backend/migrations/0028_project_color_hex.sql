-- Цвет проекта — значение, а не имя из набора (task-104, отмена Р-041).
--
-- ⚠️ СХЕМА НЕ МЕНЯЕТСЯ: колонка и раньше была `text` без `CHECK` (0024),
-- и это ровно тот случай, ради которого так решили — набор значений держит
-- граница входа, а не база. Меняются ДАННЫЕ: прежние имена переводятся
-- в те самые значения, которыми они рисовались (`--tag-*` в styles.css),
-- поэтому папки выглядят как вчера.
--
-- ⚠️ НЕИЗВЕСТНОЕ ИМЯ СТАНОВИТСЯ ПУСТЫМ, А НЕ ОСТАЁТСЯ СТРОКОЙ. Строка, которую
-- не понимает ни клиент, ни граница входа, — это цвет, который нельзя ни
-- показать, ни сохранить заново: проект молча перестал бы сохраняться при
-- следующем переименовании. Пусто значит «без цвета», и это состояние
-- продукту известно.
UPDATE "project"
SET "color" = CASE "color"
  WHEN 'red' THEN '#e05a5a'
  WHEN 'orange' THEN '#b86d1e'
  WHEN 'yellow' THEN '#98790f'
  WHEN 'green' THEN '#2e8b58'
  WHEN 'blue' THEN '#4180d2'
  WHEN 'violet' THEN '#8a6bd2'
  WHEN 'pink' THEN '#c4568c'
  WHEN 'rose' THEN '#d1466a'
  WHEN 'brown' THEN '#8b5e3c'
  WHEN 'lime' THEN '#5f7d12'
  WHEN 'teal' THEN '#1f7f78'
  WHEN 'cyan' THEN '#0b7fb3'
  WHEN 'navy' THEN '#2c4a8c'
  WHEN 'indigo' THEN '#5a5fd6'
  WHEN 'purple' THEN '#9a4fc9'
  WHEN 'slate' THEN '#5f6b7a'
  ELSE NULL
END
WHERE "color" IS NOT NULL AND "color" !~ '^#[0-9a-f]{6}$';
