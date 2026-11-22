# AGENTS.md — Инструкции для AI-агентов в репозитории Docalaizer

**Docalaizer** — сервис документации и визуализации данных (Confluence / Coda для эпохи AI), в котором AI-агенты работают через MCP и REST API, но **никогда не перезаписывают ручные правки без явного аппрува**.

Перед началом работы над новой подсистемой прочитайте профильный документ:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — архитектура, стек, схема БД, RBAC и права агентов.
- [docs/VERSIONING_AND_APPROVAL.md](docs/VERSIONING_AND_APPROVAL.md) — единая история (`main`), Proposals, блочный 3-way merge и политики аппрува.
- [docs/API_AND_MCP_SPEC.md](docs/API_AND_MCP_SPEC.md) — контракты MCP-инструментов, формат `annotated_markdown` и REST API.
- [docs/ROADMAP.md](docs/ROADMAP.md) — поэтапный план разработки.

---

## 1. Жёсткие доменные инварианты (нельзя нарушать)

1. **Защита ручных правок**: блок с `humanTouched = true` или `lockedByHuman = true` **никогда** не может быть изменён или удалён AI-агентом без явного аппрува пользователя (`owner` / `editor` / `reviewer`) в UI — независимо от `approval_policy`. Защита обеспечивается на уровне доменной логики сервера, а не промптами.
2. **Единая append-only история**: `revisions` неизменяемы; откат всегда создаёт новую ревизию `v(N+1)`. Обновление `documents.head_revision_id` выполняется только в транзакции PostgreSQL с оптимистичной блокировкой (`WHERE id = $1 AND head_revision_id = $2`).
3. **Чистое ядро (`packages/core`)**: парсер `annotated_markdown ↔ DocumentBlock[]`, блочный 3-way merge, детектор конфликтов (`human_protected`, `locked`, `stale_conflict`, `risky_delete`) и валидаторы Mermaid/Vega-Lite не зависят от HTTP-фреймворка и БД.
4. **Безопасность визуализаций и контента**:
   - Все схемы `Vega-Lite` и `Mermaid` валидируются на сервере **до** создания Proposal; ошибки возвращаются структурированно (`CHART_VALIDATION_ERROR`), чтобы агент мог исправить их сам.
   - Запрещено выполнять произвольный JS из AI-контента: Markdown санитизируется (`rehype-sanitize`), Mermaid рендерится с `securityLevel: 'strict'`, Vega-Lite — строго декларативный JSON.
5. **Права AI-агентов (RBAC)**:
   - Токены агентов хранятся в БД только как SHA-256 хэш + несекретный префикс.
   - Право `projects:create` выключено по умолчанию и всегда проверяется на сервере (`403 FORBIDDEN_SCOPE`).
   - Доступ к проектам ограничивается `project_scope_mode` (`all_owner_projects` / `selected` + `allowed_project_ids`).
6. **Идемпотентность и лимиты**: `propose_changes` / `propose_markdown_update` поддерживают `idempotency_key`; размер inline-датасетов графиков ограничивается на сервере.

---

## 2. Целевая структура монорепозитория

```text
docalaizer/
├── apps/
│   ├── web/            # Next.js (App Router), React, Tailwind, shadcn/ui, Mermaid, Vega-Embed
│   └── api/            # Hono: REST API (/api/v1/*) + MCP Streamable HTTP (/mcp) + Auth
├── packages/
│   ├── core/           # Zod-схемы блоков, парсер Markdown ↔ Blocks, 3-way merge, валидаторы графиков
│   ├── db/             # Drizzle ORM схема PostgreSQL, миграции, seed
│   └── shared/         # Общие DTO, роли, скоупы агентов, коды ошибок
├── docs/               # Архитектурная документация
└── docker-compose.yml  # PostgreSQL 16 + self-hosted запуск
```

---

## 3. Правила разработки

- **Язык и типизация**: TypeScript в режиме `strict: true`. Не использовать `any` в публичных контрактах и доменных моделях; валидировать все входные данные API/MCP через `Zod`.
- **Границы слоёв**:
  - Бизнес-правила merge/политик/валидации → в `packages/core`.
  - SQL-запросы и транзакции → через `packages/db` (Drizzle ORM).
  - HTTP-обработчики и MCP-инструменты → тонкие адаптеры поверх общих сервисов в `apps/api` (не дублировать бизнес-логику между REST и MCP).
- **Миграции БД**: не редактировать уже применённые миграции; добавлять новые через Drizzle Kit.
- **Синхронизация документации**: при изменении схемы БД, MCP-инструментов или матрицы политик аппрува обновлять соответствующий файл в `docs/`.

---

## 4. Проверки перед завершением задачи

После настройки монорепы (Этап 0+) перед сдачей изменений запускать:
- `pnpm typecheck`
- `pnpm test` (обязательно для любых правок в `packages/core` и логике прав/транзакций `apps/api`)
- `pnpm lint`

Для изменений в `packages/core` (merge, парсер, защита ручных блоков) обязательно добавлять unit-тесты на краевые случаи (параллельные правки, `humanTouched`, `lockedByHuman`, `risky_delete`, невалидный Vega-Lite/Mermaid).
