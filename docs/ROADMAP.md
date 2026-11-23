# План разработки (Roadmap) — Docalaizer

План построен на зафиксированных архитектурных решениях (см. [ARCHITECTURE.md](./ARCHITECTURE.md) и [API_AND_MCP_SPEC.md](./API_AND_MCP_SPEC.md)):
- **Confluence / Coda UX**: проекты → дерево страниц → типизированные блоки.
- **Multi-user + Open-Source-ready**: пользователи, RBAC-роли в проектах и гранулярные права AI-агентов (включая `projects:create`).
- **Визуализации**: Mermaid (структура проекта и фич) + Vega-Lite (графики цифровых данных).
- **Хранилище**: PostgreSQL как источник истины; экспорт — на следующих этапах.
- **Стек**: TypeScript-монорепа (`pnpm` + Turborepo, Next.js, Hono, Drizzle ORM, `@modelcontextprotocol/sdk`).

---

## Практический ритм разработки (Medium vs High effort)

Общее правило при работе с AI-агентами над проектом: **High** — для проектирования, сложных алгоритмов, транзакций, безопасности и ревью; **Medium** — для скаффолдинга, типовых CRUD/MCP-обёрток и основного UI по уже готовой спецификации.

### Ритм для Этапов 0–1
1. **Поднять скелет монорепы и `docker-compose.yml`** → **Medium**
2. **Написать схему БД + `packages/core`** (3-way merge, парсер `annotated_markdown`, валидаторы Mermaid/Vega-Lite + тесты на краевые случаи) → **High**
3. **Собрать Auth/RBAC + транзакцию `apply_review`** (оптимистичные блокировки, скоупы агентов `projects:create`) → **High**
4. **Реализовать остальные REST-роуты, MCP-обёртки и основной Web UI** → **Medium**
5. **Собрать интерактивный экран Review Inbox** (конфликты + визуальный diff графиков) и провести финальное ревью/аудит безопасности → **High**

### Распределение по типам задач
- **High effort**: ядро `packages/core` (3-way merge, выравнивание блоков, `risky_delete`/`stale_conflict`), транзакции и конкурентность (`head_revision_id`), RBAC/безопасность/XSS-санитизация, сложная логика Review Inbox, сложный дебаг и финальное код-ревью.
- **Medium effort**: инфраструктура монорепы, типовой CRUD по [API_AND_MCP_SPEC.md](./API_AND_MCP_SPEC.md), MCP-обёртки поверх сервисов, сайдбар/формы/настройки/обёртки рендера графиков в `apps/web`, дополнительные тесты по заданным кейсам и обновление документации.

---

## Этап 0 — Инициализация монорепы и каркас данных (2–3 дня)

- [x] Инициализировать `pnpm` workspaces + Turborepo (`apps/web`, `apps/api`, `packages/core`, `packages/db`, `packages/shared`).
- [x] Поднять `docker-compose.yml` с PostgreSQL 16 + `.env.example` (включая флаг `ALLOW_PUBLIC_SIGNUP` для личного/публичного режима).
- [x] Описать схему БД в `packages/db` (Drizzle ORM) и создать первую миграцию:
  - `users`, `sessions`, `projects`, `project_members`, `agents`
  - `documents` (с `parent_id`, `sort_order`), `revisions` (с `blocks_snapshot` и `search_vector`)
  - `proposals`, `proposal_ops`
- [x] Реализовать чистую доменную логику в `packages/core` и покрыть unit-тестами:
  - Zod-схемы всех типов блоков (`markdown`, `diagram`, `chart`, `table`, `callout`)
  - Серверные валидаторы **Mermaid** и **Vega-Lite**
  - Парсер `annotated_markdown ↔ DocumentBlock[]` и выравнивание блоков
  - Движок блочного **3-way merge** и детектор `human_protected` / `locked` / `stale_conflict` / `risky_delete`

**Критерий готовности**: `pnpm test` гоняет unit-тесты на весь merge-движок и валидацию графиков; БД поднимается и мигрируется одной командой.

---

## Этап 1 — MVP: Confluence-опыт, Графики, MCP и Review Inbox (2–3 недели)

### 1.1. Auth, Проекты и RBAC (`apps/api`)
- [x] Регистрация/логин пользователей (сессии в HttpOnly cookies) + режим первого администратора.
- [x] CRUD проектов + управление участниками и ролями (`owner`, `editor`, `reviewer`, `viewer`).
- [x] Реестр AI-агентов: выпуск и отзыв Bearer-токенов, настройка скоупов (`projects:read`, `projects:create`, `docs:read`, `docs:create`, `docs:propose`) и белых списков проектов.

### 1.2. Документы, Дерево страниц и Proposals (`apps/api`)
- [x] Иерархия страниц внутри проекта (`GET /projects/:id/tree`, создание, перемещение `parent_id` / `sort_order` с защитой от циклов).
- [x] Ручное редактирование страниц (`PATCH /docs/:id`) с 3-way merge, оптимистичной блокировкой `head_revision_id` и автоматическим выставлением `humanTouched = true` на изменённых блоках.
- [x] Управление защитой блока (`lockedByHuman`, сброс `humanTouched`).
- [x] Полный цикл `Proposals`: создание с идемпотентностью и валидацией графиков, расчёт живого 3-way diff на лету, транзакционное применение ревью (`POST /proposals/:id/review`) с поблочными решениями (`accepted` / `rejected` / `edited`).
- [x] История ревизий документа и append-only откат (всего документа или одного блока).
- [x] Полнотекстовый поиск (`tsvector` + `ILIKE`) по проектам и страницам.

### 1.3. MCP-сервер для AI-агентов (`apps/api/src/mcp`)
- [x] Streamable HTTP endpoint `/mcp` с авторизацией по токену агента и проверкой скоупов.
- [x] Инструменты проектов: `list_projects`, `create_project` (с проверкой `projects:create`), `get_project_tree`.
- [x] Инструменты документации: `search_docs`, `get_doc` (`blocks` и `annotated_markdown`), `get_doc_history`, `create_doc`.
- [x] Инструменты правок и графиков: `validate_visualization`, `propose_changes`, `propose_markdown_update`, `list_proposals`, `get_proposal`, `update_proposal`.
- [ ] E2E-проверка подключения реальных агентов (Claude Code / Cursor / T3 Code).

### 1.4. Web UI (`apps/web`)
- [x] **Confluence/Coda Layout**: переключатель проектов + левый сайдбар с вложенным деревом страниц и поиском.
- [x] **Просмотр и редактор страницы**:
  - Блочное редактирование Markdown, таблиц, callout'ов.
  - Живой рендер **Mermaid** (`securityLevel: 'strict'`) и **Vega-Lite** графиков прямо в странице.
  - Визуальные маркеры на блоках: бейдж «Правлено вручную», кнопка замка (`lockedByHuman`), действие «Передать AI».
- [x] **Review Inbox**:
  - Список входящих `Proposals` по проектам со статусами и бейджами конфликтов.
  - Визуальный side-by-side diff (Было ↔ Стало) для Markdown, диаграмм Mermaid и графиков Vega-Lite.
  - Кнопки `Принять` / `Отклонить` на каждый блок + поле комментария агенту.
  - Яркое предупреждение и снятый по умолчанию выбор для `human_protected`, `stale_conflict` и `risky_delete`; блокировка `locked`.
- [x] **Панель настроек**: политика аппрувов проекта, управление токенами и правами AI-агентов (в т.ч. тумблер `projects:create`).
- [x] **История версий**: лента ревизий и append-only откат документа.

**Критерий готовности MVP**: вы создаёте токен для своего AI-агента с правом `projects:create` → агент через MCP создаёт проект, дерево из 3 страниц, архитектурную Mermaid-диаграмму и Vega-Lite график метрик → вы правите абзац и ставите замок на важную секцию → агент предлагает обновление всего документа → в Review Inbox вы видите визуальный diff графика и текстовый diff, принимаете график, отклоняете перезапись вашего абзаца с комментарием, и в истории документа сохраняется чистая линейка ревизий.

---

## Этап 2 — Удобство ведения и петля обратной связи (1–2 недели)

- [ ] **Интерактивная таблица-источник (Coda-style мини-фича)**: блок `table`, на который может ссылаться `chart`-блок на той же странице.
- [ ] **Политики авто-применения** (`protect_human` / `auto_new_docs`) с отдельной лентой «Автопринятые AI-обновления» и откатом в 1 клик.
- [ ] **Поблочная история**: просмотр всех версий одного конкретного графика или текстового блока.
- [ ] **Уведомления и Webhooks**: отправка уведомлений в Telegram / Slack / Webhook о новых Proposals.
- [ ] **Публичный режим для Open-Source**: read-only публичные проекты/страницы по ссылке, OAuth (GitHub/Google), готовый Docker-образ и документация по self-hosting.

---

## Этап 3 — Расширения и экспорт (по мере необходимости)

- [ ] **Экспорт**: выгрузка проекта/страницы в Markdown-архив (с SVG/PNG графиков), PDF, или синхронизация с Git-репозиторием.
- [ ] **Дополнительные визуализации**: поддержка Excalidraw (свободные схемы) и/или ECharts (сложные дашборды).
- [ ] **Live Data Sources**: read-only коннекторы (REST/SQL) для графиков с кэшированием снапшота данных в ревизии.
- [ ] **CLI / MCP stdio-bridge** (`npx @docalaizer/mcp`) для агентов без поддержки Streamable HTTP.
