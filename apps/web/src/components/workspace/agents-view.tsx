'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Bot, Copy, Check, KeyRound, ShieldAlert, Ban } from 'lucide-react';
import { AGENT_SCOPES, type AgentScope, type ProjectScopeMode } from '@docalaizer/shared';
import { ProjectIcon } from '../ui/entity-icon';
import { type AgentDto, ApiClientError, type ProjectListItemDto, api } from '@/lib/api';

interface AgentsViewProps {
  projects: ProjectListItemDto[];
}

const SCOPE_LABELS: Record<AgentScope, string> = {
  'projects:read': 'Чтение проектов и дерева',
  'projects:create': 'Создание новых проектов',
  'docs:read': 'Чтение документов и истории',
  'docs:create': 'Создание страниц',
  'docs:propose': 'Отправка Proposals на ревью',
};

export function AgentsView({ projects }: AgentsViewProps) {
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scopes, setScopes] = useState<AgentScope[]>([
    'projects:read',
    'docs:read',
    'docs:create',
    'docs:propose',
  ]);
  const [projectScopeMode, setProjectScopeMode] = useState<ProjectScopeMode>('selected');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(() =>
    projects[0] ? [projects[0].project.id] : [],
  );
  const [submitting, setSubmitting] = useState(false);

  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listAgents();
      setAgents(res.agents);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Не удалось загрузить агентов.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const toggleScope = (scope: AgentScope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const toggleProjectId = (id: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createAgent({
        name: name.trim(),
        description: description.trim() || undefined,
        scopes,
        projectScopeMode,
        allowedProjectIds: projectScopeMode === 'selected' ? selectedProjectIds : [],
      });
      setCreatedToken(res.token);
      setName('');
      setDescription('');
      await loadAgents();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Ошибка создания токена.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (agentId: string) => {
    try {
      await api.revokeAgent(agentId);
      await loadAgents();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Не удалось отозвать токен.');
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const mcpUrl = `${api.getApiBaseUrl()}/mcp`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI-агенты и MCP-токены</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Подключайте Claude Code, Cursor, Codex, T3 Code и другие агенты к{' '}
          <code className="font-mono text-xs">{mcpUrl}</code>. Токены хранятся в БД только как
          SHA-256 хэш.
        </p>
      </div>

      {createdToken && (
        <div
          className="rounded-xl border p-4"
          style={{
            backgroundColor: 'var(--sem-clean-bg)',
            borderColor: 'var(--sem-clean-border)',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--sem-clean-text)' }}>
              <KeyRound className="h-4 w-4" />
              Токен создан — скопируйте его сейчас (повторно он не показывается)
            </div>
            <button
              type="button"
              onClick={() => void copyToken()}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span aria-live="polite">{copied ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>
          <pre
            className="mt-2 overflow-x-auto rounded-md border p-2.5 font-mono text-xs"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            {createdToken}
          </pre>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            MCP Streamable HTTP: <code>{mcpUrl}</code> · Заголовок:{' '}
            <code>Authorization: Bearer {createdToken.slice(0, 16)}…</code>
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border px-3.5 py-2.5 text-sm"
          style={{
            backgroundColor: 'var(--sem-danger-bg)',
            borderColor: 'var(--sem-danger-border)',
            color: 'var(--sem-danger-text)',
          }}
        >
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="space-y-4 rounded-xl border p-5"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <h2 className="text-sm font-semibold">Выпустить новый токен агента</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="agent-name" className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Название агента
            </label>
            <input
              id="agent-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Claude Code — Laptop"
              className="w-full rounded-md border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div>
            <label htmlFor="agent-description" className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Описание (опционально)
            </label>
            <input
              id="agent-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Для ведения архитектуры и графиков"
              className="w-full rounded-md border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Права (Scopes)
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {AGENT_SCOPES.map((scope) => {
              const checked = scopes.includes(scope);
              const isElevated = scope === 'projects:create';
              return (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs"
                  style={{
                    backgroundColor: checked ? 'var(--bg-subtle)' : 'transparent',
                    borderColor: isElevated && checked ? 'var(--sem-human-border)' : 'var(--border-default)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScope(scope)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="flex items-center gap-1.5 font-mono font-medium">
                      {scope}
                      {isElevated && (
                        <ShieldAlert
                          className="h-3.5 w-3.5"
                          style={{ color: 'var(--sem-human-text)' }}
                        />
                      )}
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>{SCOPE_LABELS[scope]}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Доступ к проектам
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="scopeMode"
                checked={projectScopeMode === 'selected'}
                onChange={() => setProjectScopeMode('selected')}
              />
              Только выбранные проекты
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="scopeMode"
                checked={projectScopeMode === 'all_owner_projects'}
                onChange={() => setProjectScopeMode('all_owner_projects')}
              />
              Все мои проекты
            </label>
          </div>

          {projectScopeMode === 'selected' && projects.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {projects.map(({ project }) => {
                const selected = selectedProjectIds.includes(project.id);
                return (
                  <button
                    key={project.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleProjectId(project.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors"
                    style={{
                      backgroundColor: selected ? 'var(--accent-primary-soft)' : 'var(--bg-subtle)',
                      borderColor: selected ? 'var(--accent-primary)' : 'var(--border-default)',
                      color: selected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    }}
                  >
                    <ProjectIcon icon={project.icon} />
                    <span>{project.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium disabled:opacity-60"
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: 'var(--accent-primary-fg)',
          }}
        >
          <Bot className="h-4 w-4" />
          {submitting ? 'Выпуск…' : 'Создать токен агента'}
        </button>
      </form>

      <div className="space-y-2.5">
        <h2 className="text-sm font-semibold">Выпущенные агенты ({agents.length})</h2>
        {loading ? (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Загрузка…
          </div>
        ) : agents.length === 0 ? (
          <div
            className="rounded-lg border p-6 text-center text-xs"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          >
            Пока нет зарегистрированных AI-агентов.
          </div>
        ) : (
          agents.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                opacity: a.isActive ? 1 : 0.6,
              }}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{a.name}</span>
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {a.tokenPrefix}…
                  </span>
                  {!a.isActive && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: 'var(--sem-danger-bg)',
                        color: 'var(--sem-danger-text)',
                      }}
                    >
                      Отозван
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {a.scopes.map((s) => (
                    <span
                      key={s}
                      className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                      style={{
                        backgroundColor:
                          s === 'projects:create' ? 'var(--sem-human-bg)' : 'var(--bg-subtle)',
                        borderColor:
                          s === 'projects:create' ? 'var(--sem-human-border)' : 'var(--border-default)',
                        color:
                          s === 'projects:create' ? 'var(--sem-human-text)' : 'var(--text-secondary)',
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {a.isActive && (
                <button
                  type="button"
                  onClick={() => void handleRevoke(a.id)}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs"
                  style={{
                    borderColor: 'var(--sem-danger-border)',
                    color: 'var(--sem-danger-text)',
                  }}
                >
                  <Ban className="h-3.5 w-3.5" />
                  Отозвать
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
