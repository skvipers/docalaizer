<img src="assets/icon.svg" width="64" height="64" alt="">

# Docalaizer

**Confluence / Coda для эпохи AI-агентов** — сервис документации, структурных диаграмм и графиков данных, где AI-агенты работают через MCP и REST API, но **никогда не перезаписывают ручные правки без явного аппрува**.

## Архитектурная документация

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — общая архитектура системы, модель проектов и дерева страниц, схема БД (PostgreSQL), RBAC и права AI-агентов (`projects:create` и др.), движок диаграмм (Mermaid) и графиков (Vega-Lite).
- [docs/VERSIONING_AND_APPROVAL.md](docs/VERSIONING_AND_APPROVAL.md) — модель версионирования (`Single Timeline + Proposals + Block Ownership`), блочный 3-way merge, политики аппрува и защита ручных правок.
- [docs/API_AND_MCP_SPEC.md](docs/API_AND_MCP_SPEC.md) — контракты MCP-инструментов, формат аннотированного Markdown и спецификация REST API.
- [docs/ROADMAP.md](docs/ROADMAP.md) — поэтапный план реализации (Этапы 0 → 3).
- [AGENTS.md](AGENTS.md) — правила, доменные инварианты и соглашения для AI-агентов, работающих над кодовой базой.
