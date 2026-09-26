---
description: Run OCR in delegation mode — OCR handles file selection and rules, the host agent performs the actual review.
---

Invoke OpenCodeReview (OCR) in delegation mode. OCR determines which files to review and provides review rules; you perform the actual code review using your own capabilities.

## Workflow

### Step 1: Preview

```bash
ocr delegate preview [user-args]
```

- Default (no user arguments): workspace mode (staged + unstaged + untracked).
- If the user provides `--commit` or `-c`: pass through as-is.
- If the user provides `--from` and `--to`: pass through as-is.
- (Optional) Provide `--background "context"` or `-b "context"` for business context.
- If `ocr` is not found, install it: `npm i -g @alibaba-group/open-code-review`.

This outputs mode/ref metadata and the reviewable file list.

### Step 2: Get Rules

Pass all reviewable file paths to get their review checklists:

```bash
ocr delegate rule <path1> <path2> ...
```

### Step 3: Get Diffs and Review

For each reviewable file, get its diff using git (based on mode/ref from Step 1):
- Range: `git diff <merge_base>..<to> -- <path>`
- Commit: `git show <commit> -- <path>`
- Workspace: `git diff HEAD -- <path>` (or read directly for untracked files)

Then review focusing on: correctness, security, performance, error handling, concurrency, maintainability. Only comment on changed code (+ lines).

### Step 4: Report and Fix

Classify each issue by severity:

- **High**: Obvious bugs, security issues, data loss, or clear mistakes with precise fix proposals
- **Medium**: Reasonable concerns, performance suggestions, or fixes requiring manual work
- **Low**: Discard silently (likely false positives, nitpicks, or insufficient context)

Automatically fix High and Medium issues that are safe and well-defined.

## В этом проекте (Amplifie, Р-046)

- Прогон — перед каждым коммитом по готовому набору правок: `make review`
  (то же, что `ocr delegate preview`) или `make review ARGS="--commit <hash>"`.
- Ревью отдельно от создания (корневой `AGENTS.md`, раздел «Ревью»): сначала список
  замечаний в формате `файл:строка — вес — сценарий — исправление`, каждое проверено
  в текущем коде; исправление — отдельным шагом, с красным тестом, где это поведение.
- Шаг 4 выше («чини High и Medium сразу») здесь действует только для правок самой
  задачи; найденное в чужом коде идёт в `dock/debt.md`.
- Модель — подписка агента: OCR в режиме делегирования сам модель не зовёт,
  ключ API не нужен, телеметрия по умолчанию выключена.

Источник команды: [alibaba/open-code-review](https://github.com/alibaba/open-code-review),
`plugins/open-code-review/claude-code/commands/delegate-review.md`, Apache-2.0.
