<img src="assets/icon.svg" width="64" height="64" alt="Docalaizer">

# Docalaizer

*Read this in other languages: [Русский](README.ru.md)*

**Documentation for the AI-agent era** — a self-hosted documentation, Mermaid diagram, and Vega-Lite chart platform where AI agents collaborate via **MCP** and **REST API**, but **never overwrite human edits without explicit approval**.

## Key Features

- **Human-edit protection**: blocks touched (`humanTouched`) or locked (`lockedByHuman`) by a human can never be modified or deleted by AI agents without explicit UI approval — enforced at the server domain level, not by prompts.
- **Single append-only history + Proposals**: immutable revisions, block-level 3-way merge, conflict detection (`human_protected`, `locked`, `stale_conflict`, `risky_delete`), and cherry-pick Review Inbox.
- **Native visualizations**: server-validated **Mermaid** diagrams (`securityLevel: 'strict'`) and declarative **Vega-Lite** charts with fullscreen/zoom viewer.
- **MCP Streamable HTTP (`/mcp`) & REST API (`/api/v1/*`)**: scoped, SHA-256-hashed AI agent tokens with per-project access control and opt-in `projects:create`.
- **Optional Passkey auth via LocuGard v0.1.0**: WebAuthn login alongside standard email/password authentication.
- **Bilingual Web UI**: built-in **English (`en`)** and **Russian (`ru`)** localization with instant switching and Light/Dark themes.

## Quick Start

### 1. Docker Compose (recommended for self-hosted)

```bash
cp .env.example .env
# Set strong passwords and URLs in .env
docker compose up -d --build
```

Once running:
- Web UI: `http://localhost:3000`
- API & MCP: `http://localhost:3001` (`/health`, `/api/v1/*`, `/mcp`)

### 2. Local Setup (Node.js 20+, pnpm 10+)

```bash
# Start PostgreSQL only
docker compose up -d postgres

# Install dependencies, build, and run migrations
pnpm install
pnpm build
pnpm db:migrate

# (Optional) Seed demo data
# In production, SEED_ADMIN_PASSWORD is required
pnpm db:seed

# Run in production mode
pnpm start:api
pnpm start:web

# Or run in development mode
pnpm dev
```

The first registered user via `/api/v1/auth/register` (or the sign-in screen) automatically receives the `admin` role. Public signup is disabled by default (`ALLOW_PUBLIC_SIGNUP=false`).

## Architecture Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture, projects & page tree, PostgreSQL schema, RBAC & AI agent scopes, Mermaid/Vega-Lite rendering.
- [docs/VERSIONING_AND_APPROVAL.md](docs/VERSIONING_AND_APPROVAL.md) — `Single Timeline + Proposals + Block Ownership`, block-level 3-way merge, and approval policies.
- [docs/API_AND_MCP_SPEC.md](docs/API_AND_MCP_SPEC.md) — MCP tools catalog, `annotated_markdown` format, and REST API specification.
- [docs/ROADMAP.md](docs/ROADMAP.md) — development roadmap.
- [AGENTS.md](AGENTS.md) — domain invariants and guidelines for AI coding agents working in this repository.

## Passkey Sign-In with LocuGard v0.1.0

Docalaizer supports optional WebAuthn/passkey sign-in via [LocuGard](https://github.com/skvipers/locugard/tree/v0.1.0) while keeping email/password sign-in available.

1. Deploy LocuGard following its [integration guide](https://github.com/skvipers/locugard/blob/v0.1.0/docs/INTEGRATION.md) and bootstrap the first owner via local CLI.
2. In LocuGard `AuthService`, set `expected_origin` to match the exact origin of the Docalaizer Web UI (e.g. `https://docalaizer.home.arpa:3000`), with `rp_id` set to its hostname or parent domain. WebAuthn requires HTTPS and an exact origin match.
3. Configure the Docalaizer API:
   - `LOCUGARD_URL=https://locugard.home.arpa:8443` — HTTPS URL of the LocuGard HTTP API;
   - `LOCUGARD_ORIGIN=https://docalaizer.home.arpa:3000` — the same origin as `expected_origin`;
   - if using a private CA, set `NODE_EXTRA_CA_CERTS` to the root CA certificate path or run Node.js 22+ with `NODE_OPTIONS=--use-system-ca` (never disable TLS verification).
4. Restart the API. A "Sign in with passkey via LocuGard" button will appear on the login screen.

Each LocuGard account is mapped by `account_id` to `<account_id>@locugard.invalid` with the global `member` role (external owners are never auto-promoted to `admin`). The upstream session is re-verified on every authenticated request, so revoking it immediately blocks access. LocuGard session and CSRF tokens are stored exclusively in Secure HttpOnly cookies.

## License

Docalaizer is distributed under a **Source-Available / Fair Source** model (similar to *PolyForm Small Business*):

- **Free** for personal, educational, non-commercial use, open-source/non-profit organizations, and small startups (< 20 employees and < $1M annual revenue).
- **Larger companies** are expected to support the project via sponsorship/donations or obtain a commercial license.

See [LICENSE](LICENSE) for full terms.
