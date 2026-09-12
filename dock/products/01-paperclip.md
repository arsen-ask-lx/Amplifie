---
title: Paperclip — разбор
description: Полный разбор paperclipai/paperclip по исходникам и отзывам. Что умеет, как устроено, плюсы, минусы, что берём себе.
tags:
  - topic/product
  - kind/analysis
---

# Paperclip — разбор

> Разобран по исходникам 2026-09-04. Локально: `/e/other_project_for_example/paperclip`.
> Отзывы — из сети, ссылки в §9. Продукт **не поднимался**, только чтение кода.

**Одной фразой:** пульт управления штатом ИИ-агентов, устроенный как компания —
с оргструктурой, бюджетами, расписанием и аудитом.

| | |
|---|---|
| Звёзд | ~79 500 |
| Язык | TypeScript 96% |
| Лицензия | **MIT** (можно закрытый продукт на его основе) |
| Размер | 7 832 файла · 122 таблицы · 62 маршрута · 268 сервисов |
| Состав | `server` (Node) + `ui` (React) + `cli` + 12 общих пакетов |

---

## 1. Что умеет — по разделам

Боковая панель, 21 пункт:

| Раздел | Что делает |
|---|---|
| Search | сквозной поиск |
| Dashboard | сводка + счётчик живых прогонов |
| Inbox | входящие |
| **Decisions** | очередь вопросов агента к человеку |
| Status | доска состояния (beta) |
| **Conference Room** | разговор с агентом-концьержем: управление компанией словами |
| Tasks | задачи |
| Cases | дела (beta) |
| **Routines** | регулярные поручения |
| Pipelines | конвейеры |
| Goals | цели |
| **Artifacts** | результаты работы агентов |
| **Skills** | навыки |
| **Workspaces** | изолированные места, где агент физически работает |
| Projects | проекты |
| **Org** | оргструктура агентов (есть отрисовка схемы в SVG) |
| Apps | подключаемые приложения |
| Timeline | лента времени |
| **Costs** | сколько потрачено |
| Activity | журнал |
| Settings | настройки |

## 2. Модель данных — 122 таблицы

| Группа | Таблиц |
|---|---|
| компания и люди | 22 |
| задачи | 20 |
| среды исполнения | 10 |
| плагины | 10 |
| решения | 8 |
| секреты | 8 |
| агенты | 7 |
| документы | 7 |
| деньги | 4 |
| сердцебиение | 3 |

**Чата нет.** Ни одной таблицы `messages`, `channels`, `conversations`.
Единственные «ветки» — примечания к документам и обсуждение внутри задачи.
«Conference Room» — по комментарию в их коде, «чат-интерфейс на основе навыка board-member;
пользователь управляет компанией через обычный разговор», то есть **человек ↔ агент**.

### Агент = сотрудник

`agents` (46 строк) — и одно поле определяет всю философию:

```
reportsTo: uuid("reports_to").references(() => agents.id)
```

Агент подчиняется агенту. Плюс `name`, `role`, `title`, `icon`, `capabilities` —
описан как штатная единица. И то, чего у человека не бывает:
`budgetMonthlyCents` / `spentMonthlyCents` (свой бюджет у каждого),
`pauseReason` + `pausedAt`, `errorReason`, `lastHeartbeatAt`, `adapterType`.

### Задача — 56 столбцов

Примечательное:

- `assigneeAgentId` / `assigneeUserId` / **`responsibleUserId`** — исполнителем может быть
  агент, но **ответственный человек есть всегда**; поля раздельные, не полиморфные;
- `originKind` / `originId` / `originRunId` / **`originFingerprint`** — откуда взялась,
  с отпечатком против дублей; рядом таблица `issue_create_idempotency_keys`;
- `requestDepth` + `MAX_ISSUE_REQUEST_DEPTH = 1024` — защита от рекурсии «агент попросил агента»;
- `status` + `statusVersion` (bigint) + `lastStatusDecisionId` — статус меняется не записью,
  а **решением**, версия защищает от гонки;
- шесть полей `monitor*` — сторож: когда проверить, сколько попыток, кто назначил;
- `ISSUE_WORK_MODES = ["standard","ask","planning","skill_test"]` — режимы «только спросить»
  и «только спланировать»;
- `ISSUE_REVIEW_POLICIES = ["anyone","not_creator","human_only"]` — кто вправе принять работу.

**Откуда берутся задачи** — 13 значений `originKind`, и человек среди них ровно один
(`manual`). Остальные система заводит себе сама: `task_watchdog`, `stranded_issue_recovery`,
`stale_active_run_evaluation`, `harness_liveness_escalation`, `issue_productivity_review`,
`routine_execution`, `pipeline_automation`, `pipeline_case_conversation`, `task_bridge`,
`built_in_agent_bundle`, `skill_test`, `task_watchdog_product_bug`.

## 3. «Решение» как объект — сильнейшая часть продукта

Пять таблиц: `decisions`, `decision_bundles`, `decision_queues`, `decision_queue_items`,
`decision_triage`. Одно решение — вопрос агента человеку:

```
title · body · options[] {id, label, description, style, effects[]} · inputs[] {label, required, maxLength}
```

`style`: `default` · `primary` · `destructive` — опасный вариант выглядит опасно.

**У варианта ответа есть машинные эффекты**, всего шесть видов:
`create_issue` · `assign_issue` · `update_issue_status` · `comment_on_issue` ·
`resolve_blocker` · `cancel_issue_tree`.

Человек не пишет ответ словами — жмёт кнопку, за которой стоит конкретное действие.
Агенту нечего «истолковывать».

Пять защит, вшитых в схему:

1. **`expiresAt` — `notNull`.** Срок годности обязателен; есть статус `expired`.
2. **`targetSnapshots` — `notNull`** + у каждого эффекта `staleness: "strict" | "lenient"`.
   Ответили через два часа, обстановка изменилась → при `strict` эффект не применяется.
3. **`signedSpec` — `notNull`.** Сервис `decision-signing.ts`: HMAC, ключ в файле `0600`,
   проверка владельца файла, `timingSafeEqual`, версия схемы `"decision-spec-v1"`.
   Агент не может подделать вопрос, на который уже ответили.
4. **`idempotencyKey`** — ответ не применится дважды.
5. **`continuationPolicy`**: `none` · `wake_assignee` · `wake_assignee_on_accept` ·
   `wake_origin_agent` — кого будить после ответа.

**Очереди**: `decision_queues` с `seedRules` (что попадает автоматически) и
`seedRulesEnabled`. У каждого элемента — `responsibleUserId`, конкретный человек.

**Обучение на своих решениях**: `decision_training_examples` хранит `snapshot` +
`cutoffAt` + `decisionOutcome` + `notes`/`notesHistory`. Позволяет прокрутить заново:
«зная только то, что было известно до отсечки, что бы решил агент?».
`retentionPolicy: "scrub_deleted_comments_v1"` — удалённые комментарии вычищаются
и из обучающих данных.

## 4. Доверие к источнику — архитектурный ответ на подмену промпта

`packages/shared/src/trust-policy.ts`, 85 строк. У задачи есть поле `sourceTrust`:

```
TRUST_PRESETS = ["standard", "low_trust_review"]
SourceTrustDisposition = "quarantined" | "promoted"
SourceTrustArtifactKind = "issue" | "comment" | "document" | "work_product"
```

В режиме `low_trust_review` — механически, не текстом:

- инструменты урезаны до чтения: `["git.read", "github.pr.read", "tests.local"]`;
- результат в карантине: `rawOutputDisposition: "quarantine"`;
- границы явные: `LowTrustBoundary` перечисляет дозволенные компании, проекты, задачи,
  агентов, **привязки секретов** и классы инструментов;
- выход из карантина — отдельное действие человека, `outputPromotionTarget` говорит куда.

## 5. Сердцебиение и внимание

`heartbeat_runs` — каждый запуск агента: `invocationSource` (`on_demand`/`automation`),
`triggerDetail`, `usageJson`, `resultJson`, `exitCode`, `signal`, `completionContractSha256`,
`sessionIdBefore`/`sessionIdAfter`, `nextEventSeq`.

`agent_wakeup_requests` — заявки разбудить агента, с **`coalescedCount`** (несколько
заявок схлопываются в один запуск) и `idempotencyKey`.

`attention` — единая лента «что требует меня», 11 источников:
`approval` · `decision` · `issue_thread_interaction` · `join_request` · `recovery_action` ·
`productivity_review` · `blocker_attention` · `review` · `failed_run` · **`budget_alert`** ·
**`agent_error_alert`**. Важность: `critical`/`high`/`medium`/`low`.
Сортировка двумя способами: `activity` (по свежести) и **`decide`** (по срочности решения).

## 6. Сквозной приём: кто это сделал

Вместо одного поля «автор» — пять:

```
createdByType · createdByUserId · createdByAgentId · createdByRunId · createdByAgentApiKeyId
```

След ведёт не к «агенту вообще», а к **конкретному прогону и конкретному ключу доступа**.
Повторяется в `issues`, `decision_queues`, `decision_queue_items`.

## 7. Плюсы и минусы

### Плюсы

- **MIT** — единственный из крупных, кто разрешает закрытый продукт на своей основе;
- **TypeScript 96%** — совпадает с нашим языком;
- зрелость в безопасности действий агента: решения, карантин, подписи, бюджеты, секреты;
- **не привязан к модели**: Claude Code, Codex, Cursor, OpenClaw, Hermes подключаются
  как исполнители; агент — сменная деталь;
- по отзывам, качество панели — сильная сторона: «при 5+ агентах надзор наконец управляем»;
- бюджеты останавливают агента на 100% расхода автоматически.

### Минусы

- **Чата между людьми нет вообще** — для нас это отсутствие главного;
- ⚠️ **История с безопасностью**: CVE-2026-41679 — при настройках регистрации по умолчанию
  неаутентифицированный пользователь мог сам зарегистрироваться, сам одобрить свою же
  заявку на доступ через CLI и получить постоянный доступ уровня доски **без одобрения
  администратора**. Плюс две дыры с выполнением команд на сервере и на машине
  разработчика через импорт вредоносного агента. Исправлено в 2026.416.0 и 0.3.1
  (требование прав администратора на импорт, проверка имени хоста, ограничение адаптеров);
- по отзывам: ошибки, 404 на файлах инструкций, агенты игнорируют переопределения,
  «стабильности пока нет»;
- требует самостоятельно поднять Node, Postgres и обвязку моделей — «не для тех, кто ждёт простоты»;
- мало обучающих материалов по сравнению со старыми каркасами.

## 8. Что берём себе

| Приём | Зачем нам |
|---|---|
| **«Решение» как объект с машинными эффектами** | наш К4: человек жмёт кнопку, а не пишет «да, давай» |
| **Обязательный срок годности решения** | зависший вопрос = остановившийся агент |
| **Снимок + `staleness: strict`** | ответ на устаревший вопрос не применяется |
| **Подпись спецификации решения** | агент не подделает вопрос задним числом |
| **`originFingerprint` + таблица идемпотентности** | агент дважды услышал договорённость → одна задача |
| **`responsibleUserId` отдельно от исполнителя** | ответственный человек есть всегда |
| **Пять полей «кто сделал»** | след до прогона и ключа, а не «это агент» |
| **Карантин недоверенного (`low_trust_review`)** | всё, что агент слышит в чате, — недоверенный ввод |
| **`review_policy: not_creator`** | кто сделал — не принимает сам |
| **Бюджет в самой сущности агента** | слушающий агент — главная статья расходов |
| **`coalescedCount` у заявок на пробуждение** | десять сообщений подряд → один запуск, не десять |
| **Сортировка внимания по `decide`** | список «что от меня ждут решения» ≠ лента новостей |

### Чего НЕ брать

- 20 таблиц вокруг задачи (`issue_watchdogs`, `issue_tree_holds`, `issue_recovery_actions`,
  `issue_plan_decompositions`) — это обвязка «агент сам делает работу и застревает»,
  наша вторая часть, не первая;
- 10 таблиц сред исполнения — там же;
- оргструктуру агентов с `reportsTo` — красиво, но у нас один человек и нет штата агентов.

## 9. Источники отзывов

- [eesel.ai — обзор и тест](https://www.eesel.ai/blog/paperclip-ai-review)
- [codexpedite — плюсы, минусы, разбор архитектуры](https://codexpedite.com/paperclip-ai-review-the-control-plane-that-tames-autonomous-agent-chaos/)
- [the4thpath — «если агенты сотрудники, это компания»](https://www.the4thpath.com/2026/03/paperclip-ai-review-if-agents-are.html)
- [CSO Online — критические дыры и провал доверия к агентам](https://www.csoonline.com/article/4205630/critical-paperclip-bugs-expose-ai-agent-trust-failures.html)
- [The Hacker News — выполнение команд через вредоносного агента](https://thehackernews.com/2026/08/paperclip-ai-flaws-let-attackers-run.html)
- [ToolCenter](https://www.toolcenter.ai/en/articles/paperclip-review-2026) ·
  [vibecoding](https://vibecoding.app/blog/paperclip-review) ·
  [knolli](https://www.knolli.ai/post/paperclip-ai-review)
