'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  ChevronRight,
  Edit3,
  Eye,
  FileText,
  FolderPlus,
  History,
  Inbox,
  LogOut,
  Menu,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { DocumentBlock, ProposalBlockPayload } from '@docalaizer/core';
import {
  APPROVAL_POLICIES,
  type ApprovalPolicy,
  ERROR_CODES,
  PROJECT_ROLES,
  type ProjectRole,
} from '@docalaizer/shared';
import {
  ApiClientError,
  type AuthUser,
  type DocumentDetailDto,
  type DocumentTreeItemDto,
  type ProjectListItemDto,
  type ProjectMemberDto,
  type RevisionDto,
  type SearchResultDto,
  api,
} from '@/lib/api';
import { BlockContentView, DocumentBlockCard } from '../blocks/block-renderer';
import { DocumentEditor } from '../blocks/document-editor';
import { useTheme } from '../theme-provider';
import { AgentsView } from './agents-view';
import { AuthScreen } from './auth-screen';
import { InboxView } from './inbox-view';

type ActiveTab = 'doc' | 'inbox' | 'agents' | 'settings';
type HistoryFilter = 'all' | 'human' | 'ai' | 'merge';

interface FlatTreeRow {
  doc: DocumentTreeItemDto;
  depth: number;
}

function flattenTreeHierarchy(docs: DocumentTreeItemDto[]): FlatTreeRow[] {
  const byParent = new Map<string | null, DocumentTreeItemDto[]>();
  const existingIds = new Set(docs.map((d) => d.id));

  for (const doc of docs) {
    const parentKey = doc.parentId && existingIds.has(doc.parentId) ? doc.parentId : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(doc);
    byParent.set(parentKey, list);
  }

  const out: FlatTreeRow[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      out.push({ doc: child, depth });
      walk(child.id, depth + 1);
    }
  };

  walk(null, 0);
  return out;
}

export function WorkspaceShell() {
  const { theme, toggleTheme } = useTheme();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [projects, setProjects] = useState<ProjectListItemDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tree, setTree] = useState<DocumentTreeItemDto[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docDetail, setDocDetail] = useState<DocumentDetailDto | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('doc');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [isConflictError, setIsConflictError] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<RevisionDto[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [previewRevision, setPreviewRevision] = useState<RevisionDto | null>(null);

  const [members, setMembers] = useState<ProjectMemberDto[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectRole>('editor');
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultDto[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
  }, []);

  // Keyboard shortcuts: Cmd/Ctrl+K focuses search; Escape closes overlays
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMobileMenuOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      } else if (e.key === 'Escape') {
        setSearchResults([]);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const loadProjects = useCallback(async () => {
    const res = await api.listProjects();
    setProjects(res.projects);
    setActiveProjectId((prev) => {
      if (prev && res.projects.some((p) => p.project.id === prev)) return prev;
      return res.projects[0]?.project.id ?? null;
    });
  }, []);

  useEffect(() => {
    if (user) {
      void loadProjects();
    }
  }, [user, loadProjects]);

  const loadTree = useCallback(async (projectId: string) => {
    const res = await api.getProjectTree(projectId);
    setTree(res.documents);
    setActiveDocId((prev) => {
      if (prev && res.documents.some((d) => d.id === prev)) return prev;
      return res.documents[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    if (activeProjectId) {
      void loadTree(activeProjectId);
    } else {
      setTree([]);
      setActiveDocId(null);
      setDocDetail(null);
    }
  }, [activeProjectId, loadTree]);

  const loadDoc = useCallback(async (docId: string) => {
    try {
      const res = await api.getDoc(docId);
      setDocDetail(res);
      setDocError(null);
      setIsConflictError(false);
    } catch (err) {
      setDocError(err instanceof ApiClientError ? err.message : 'Ошибка загрузки страницы.');
    }
  }, []);

  useEffect(() => {
    if (activeDocId) {
      setEditing(false);
      setShowHistory(false);
      setPreviewRevision(null);
      void loadDoc(activeDocId);
    } else {
      setDocDetail(null);
    }
  }, [activeDocId, loadDoc]);

  const loadMembers = useCallback(async (projectId: string) => {
    try {
      const res = await api.listProjectMembers(projectId);
      setMembers(res.members);
      setSettingsError(null);
    } catch (err) {
      setSettingsError(
        err instanceof ApiClientError ? err.message : 'Не удалось загрузить участников.',
      );
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'settings' && activeProjectId) {
      void loadMembers(activeProjectId);
    }
  }, [activeTab, activeProjectId, loadMembers]);

  useEffect(() => {
    if (!searchQuery.trim() || !user) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .searchDocs(searchQuery, activeProjectId ?? undefined)
        .then((res) => setSearchResults(res.results))
        .catch(() => setSearchResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, activeProjectId, user]);

  const activeProjectEntry = useMemo(
    () => projects.find((p) => p.project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const flatTree = useMemo(() => flattenTreeHierarchy(tree), [tree]);

  const filteredRevisions = useMemo(
    () =>
      historyFilter === 'all'
        ? revisions
        : revisions.filter((r) => r.authorType === historyFilter),
    [revisions, historyFilter],
  );

  const canEdit =
    activeProjectEntry?.role === 'owner' || activeProjectEntry?.role === 'editor';

  const handleCreateProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!newProjName.trim()) return;
    const slug =
      newProjName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `project-${Date.now()}`;
    const res = await api.createProject({ name: newProjName.trim(), slug });
    setNewProjName('');
    setCreatingProject(false);
    await loadProjects();
    setActiveProjectId(res.project.id);
    setActiveTab('doc');
  };

  const handleCreateDoc = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeProjectId || !newDocTitle.trim()) return;
    const slug =
      newDocTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `page-${Date.now()}`;
    const res = await api.createDoc(activeProjectId, {
      title: newDocTitle.trim(),
      slug,
      blocks: [
        {
          type: 'markdown',
          content: `# ${newDocTitle.trim()}\n\nНачните описывать архитектуру или добавьте диаграмму Mermaid / график Vega-Lite.`,
        },
      ],
    });
    setNewDocTitle('');
    setCreatingDoc(false);
    await loadTree(activeProjectId);
    setActiveDocId(res.document.id);
    setActiveTab('doc');
    setMobileMenuOpen(false);
  };

  const handleSaveDoc = async (
    title: string,
    blocks: ProposalBlockPayload[],
    summary: string,
  ) => {
    if (!docDetail?.headRevision) return;
    setSavingDoc(true);
    setDocError(null);
    setIsConflictError(false);
    try {
      await api.updateDoc(docDetail.document.id, {
        expectedHeadRevisionId: docDetail.headRevision.id,
        proposedBlocks: blocks,
        title,
        summary,
      });
      await loadDoc(docDetail.document.id);
      if (activeProjectId) await loadTree(activeProjectId);
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setDocError(err.message);
        setIsConflictError(err.code === ERROR_CODES.HEAD_REVISION_CONFLICT);
      } else {
        setDocError('Ошибка сохранения документа.');
      }
    } finally {
      setSavingDoc(false);
    }
  };

  const handleToggleLock = async (block: DocumentBlock) => {
    if (!docDetail) return;
    await api.updateBlockProtection(docDetail.document.id, block.id, {
      lockedByHuman: !block.meta.lockedByHuman,
    });
    await loadDoc(docDetail.document.id);
  };

  const handleReleaseToAi = async (block: DocumentBlock) => {
    if (!docDetail) return;
    await api.updateBlockProtection(docDetail.document.id, block.id, {
      humanTouched: false,
    });
    await loadDoc(docDetail.document.id);
  };

  const openHistory = async () => {
    if (!docDetail) return;
    const nextOpen = !showHistory;
    setShowHistory(nextOpen);
    setPreviewRevision(null);
    if (nextOpen) {
      const res = await api.getDocRevisions(docDetail.document.id);
      setRevisions(res.revisions);
    }
  };

  const handleRollback = async (revisionId: string) => {
    if (!docDetail) return;
    await api.rollbackDoc(docDetail.document.id, { targetRevisionId: revisionId });
    setPreviewRevision(null);
    await loadDoc(docDetail.document.id);
    const res = await api.getDocRevisions(docDetail.document.id);
    setRevisions(res.revisions);
  };

  const handleUpdatePolicy = async (policy: ApprovalPolicy) => {
    if (!activeProjectId) return;
    await api.updateProject(activeProjectId, { defaultApprovalPolicy: policy });
    await loadProjects();
  };

  const handleAddMember = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeProjectId || !inviteEmail.trim()) return;
    setSettingsError(null);
    try {
      await api.addProjectMember(activeProjectId, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInviteEmail('');
      await loadMembers(activeProjectId);
    } catch (err) {
      setSettingsError(
        err instanceof ApiClientError ? err.message : 'Не удалось добавить участника.',
      );
    }
  };

  const handleChangeMemberRole = async (memberUserId: string, role: ProjectRole) => {
    if (!activeProjectId) return;
    await api.updateProjectMemberRole(activeProjectId, memberUserId, role);
    await loadMembers(activeProjectId);
  };

  const handleRemoveMember = async (memberUserId: string) => {
    if (!activeProjectId) return;
    await api.removeProjectMember(activeProjectId, memberUserId);
    await loadMembers(activeProjectId);
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  if (checkingAuth) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-sm"
        style={{ color: 'var(--text-muted)' }}
      >
        Загрузка Docalaizer…
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  const totalPending = projects.reduce((acc, p) => acc + p.pendingProposalsCount, 0);

  const sidebarContent = (
    <aside
      aria-label="Навигация по проектам и страницам"
      className="flex h-full w-64 shrink-0 flex-col border-r"
      style={{
        backgroundColor: 'var(--bg-subtle)',
        borderColor: 'var(--border-default)',
      }}
    >
      <div
        className="flex h-12 items-center justify-between border-b px-3"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
          <span>Docalaizer</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="nav-item rounded p-1.5"
            style={{ color: 'var(--text-secondary)' }}
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="nav-item rounded p-1.5 md:hidden"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Закрыть меню"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Project Switcher */}
      <div className="space-y-2 border-b p-3" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Выбор проекта"
            value={activeProjectId ?? ''}
            onChange={(e) => {
              setActiveProjectId(e.target.value || null);
              setActiveTab('doc');
            }}
            className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs font-medium"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            {projects.length === 0 && <option value="">Нет проектов</option>}
            {projects.map(({ project }) => (
              <option key={project.id} value={project.id}>
                {project.icon ?? '📘'} {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreatingProject((v) => !v)}
            className="btn-secondary rounded-md p-1.5"
            aria-label="Новый проект"
            title="Новый проект"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>

        {creatingProject && (
          <form onSubmit={(e) => void handleCreateProject(e)} className="flex gap-1">
            <input
              type="text"
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              placeholder="Имя проекта…"
              aria-label="Имя нового проекта"
              className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
            <button type="submit" className="btn-primary rounded px-2 py-1 text-xs font-medium">
              OK
            </button>
          </form>
        )}

        {/* Search (Cmd/Ctrl+K) */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск… (Ctrl+K)"
            aria-label="Поиск по документации"
            className="w-full rounded-md border py-1.5 pl-8 pr-2 text-xs"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          {searchResults.length > 0 && (
            <div
              className="absolute left-0 right-0 top-9 z-20 max-h-56 overflow-y-auto rounded-md border shadow-md"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
            >
              {searchResults.map((r) => (
                <button
                  key={r.documentId}
                  type="button"
                  onClick={() => {
                    setActiveDocId(r.documentId);
                    setActiveTab('doc');
                    setSearchQuery('');
                    setMobileMenuOpen(false);
                  }}
                  className="nav-item flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{r.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Workspace Navigation */}
      <nav
        aria-label="Разделы рабочего пространства"
        className="space-y-0.5 border-b p-2 text-xs"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <button
          type="button"
          aria-current={activeTab === 'inbox' ? 'page' : undefined}
          onClick={() => {
            setActiveTab('inbox');
            setMobileMenuOpen(false);
          }}
          className="nav-item flex w-full items-center justify-between rounded-md px-2.5 py-1.5 font-medium"
          style={{
            backgroundColor: activeTab === 'inbox' ? 'var(--accent-primary-soft)' : undefined,
            color: activeTab === 'inbox' ? 'var(--accent-primary)' : 'var(--text-primary)',
          }}
        >
          <span className="flex items-center gap-2">
            <Inbox className="h-3.5 w-3.5" />
            Review Inbox
          </span>
          {totalPending > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: 'var(--sem-human-bg)',
                color: 'var(--sem-human-text)',
              }}
            >
              {totalPending}
            </span>
          )}
        </button>

        <button
          type="button"
          aria-current={activeTab === 'agents' ? 'page' : undefined}
          onClick={() => {
            setActiveTab('agents');
            setMobileMenuOpen(false);
          }}
          className="nav-item flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 font-medium"
          style={{
            backgroundColor: activeTab === 'agents' ? 'var(--accent-primary-soft)' : undefined,
            color: activeTab === 'agents' ? 'var(--accent-primary)' : 'var(--text-primary)',
          }}
        >
          <Bot className="h-3.5 w-3.5" />
          AI-агенты и MCP
        </button>

        {activeProjectEntry && (
          <button
            type="button"
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            onClick={() => {
              setActiveTab('settings');
              setMobileMenuOpen(false);
            }}
            className="nav-item flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 font-medium"
            style={{
              backgroundColor:
                activeTab === 'settings' ? 'var(--accent-primary-soft)' : undefined,
              color: activeTab === 'settings' ? 'var(--accent-primary)' : 'var(--text-primary)',
            }}
          >
            <Settings className="h-3.5 w-3.5" />
            Настройки проекта
          </button>
        )}
      </nav>

      {/* Multi-level Document Tree */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-1.5 flex items-center justify-between px-2">
          <span
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Страницы
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={() => setCreatingDoc((v) => !v)}
              className="nav-item rounded p-0.5"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Новая страница"
              title="Новая страница"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {creatingDoc && (
          <form onSubmit={(e) => void handleCreateDoc(e)} className="mb-2 flex gap-1 px-1">
            <input
              type="text"
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              placeholder="Название страницы…"
              aria-label="Название новой страницы"
              className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
            <button type="submit" className="btn-primary rounded px-2 py-1 text-xs font-medium">
              OK
            </button>
          </form>
        )}

        <div className="space-y-0.5">
          {flatTree.map(({ doc, depth }) => {
            const isSelected = activeTab === 'doc' && doc.id === activeDocId;
            return (
              <button
                key={doc.id}
                type="button"
                aria-current={isSelected ? 'page' : undefined}
                onClick={() => {
                  setActiveDocId(doc.id);
                  setActiveTab('doc');
                  setMobileMenuOpen(false);
                }}
                className="nav-item flex w-full items-center justify-between rounded-md py-1.5 pr-2 text-left text-xs"
                style={{
                  paddingLeft: `${0.5 + Math.min(depth, 5) * 0.9}rem`,
                  backgroundColor: isSelected ? 'var(--accent-primary-soft)' : undefined,
                  color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
                  <span className="truncate">
                    {doc.icon ? `${doc.icon} ` : ''}
                    {doc.title}
                  </span>
                </span>
                {doc.pendingProposalsCount > 0 && (
                  <span
                    className="ml-1 shrink-0 rounded-full px-1.5 text-[10px] font-semibold"
                    style={{
                      backgroundColor: 'var(--sem-ai-bg)',
                      color: 'var(--sem-ai-text)',
                    }}
                  >
                    {doc.pendingProposalsCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* User Footer */}
      <div
        className="flex items-center justify-between border-t px-3 py-2.5 text-xs"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <div className="min-w-0">
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {user.email}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="nav-item rounded p-1.5"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Выйти из аккаунта"
          title="Выйти"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      {/* Desktop sidebar */}
      <div className="hidden md:flex">{sidebarContent}</div>

      {/* Mobile slide-over drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="relative z-10 flex h-full">{sidebarContent}</div>
          <button
            type="button"
            aria-label="Закрыть навигацию"
            onClick={() => setMobileMenuOpen(false)}
            className="flex-1 bg-black/45"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4 text-xs sm:px-5"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex min-w-0 items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="nav-item rounded p-1.5 md:hidden"
              style={{ color: 'var(--text-primary)' }}
              aria-label="Открыть навигацию"
            >
              <Menu className="h-4 w-4" />
            </button>
            <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>
              {activeProjectEntry?.project.name ?? 'Docalaizer'}
            </span>
            {activeTab === 'doc' && docDetail && (
              <>
                <span>/</span>
                <span className="truncate">{docDetail.document.title}</span>
                {docDetail.headRevision && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    v{docDetail.headRevision.revisionNumber}
                  </span>
                )}
              </>
            )}
          </div>

          {activeTab === 'doc' && docDetail && !editing && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void openHistory()}
                className="btn-secondary inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs"
              >
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">История</span>
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="btn-primary inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Редактировать</span>
                </button>
              )}
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
          {activeTab === 'inbox' ? (
            <InboxView
              projectId={activeProjectId ?? undefined}
              onReviewed={() => {
                void loadProjects();
                if (activeProjectId) void loadTree(activeProjectId);
                if (activeDocId) void loadDoc(activeDocId);
              }}
            />
          ) : activeTab === 'agents' ? (
            <AgentsView projects={projects} />
          ) : activeTab === 'settings' && activeProjectEntry ? (
            <div className="mx-auto max-w-2xl space-y-6">
              <h1 className="text-2xl font-semibold">
                Настройки проекта · {activeProjectEntry.project.name}
              </h1>

              {settingsError && (
                <div
                  role="alert"
                  className="rounded-lg border px-3.5 py-2.5 text-xs"
                  style={{
                    backgroundColor: 'var(--sem-danger-bg)',
                    borderColor: 'var(--sem-danger-border)',
                    color: 'var(--sem-danger-text)',
                  }}
                >
                  {settingsError}
                </div>
              )}

              <div
                className="space-y-3 rounded-xl border p-5"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
              >
                <div className="text-sm font-medium">Политика аппрувов AI-правок</div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Независимо от выбранного режима, блоки с флагом <code>humanTouched</code> или{' '}
                  <code>lockedByHuman</code> никогда не перезаписываются AI без явного аппрува.
                </p>
                <div className="flex flex-wrap gap-2">
                  {APPROVAL_POLICIES.map((pol) => {
                    const active = activeProjectEntry.project.defaultApprovalPolicy === pol;
                    return (
                      <button
                        key={pol}
                        type="button"
                        disabled={activeProjectEntry.role !== 'owner'}
                        onClick={() => void handleUpdatePolicy(pol)}
                        className="rounded-md border px-3 py-1.5 font-mono text-xs disabled:opacity-50"
                        style={{
                          backgroundColor: active
                            ? 'var(--accent-primary-soft)'
                            : 'var(--bg-subtle)',
                          borderColor: active ? 'var(--accent-primary)' : 'var(--border-default)',
                          color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                        }}
                      >
                        {pol}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div
                className="space-y-4 rounded-xl border p-5"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4" style={{ color: 'var(--accent-primary)' }} />
                  Участники проекта ({members.length})
                </div>

                {activeProjectEntry.role === 'owner' && (
                  <form onSubmit={(e) => void handleAddMember(e)} className="flex flex-wrap gap-2">
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="Email пользователя…"
                      aria-label="Email участника"
                      className="min-w-[180px] flex-1 rounded-md border px-3 py-1.5 text-xs"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <select
                      aria-label="Роль участника"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as ProjectRole)}
                      className="rounded-md border px-2.5 py-1.5 text-xs"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="btn-primary inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Добавить
                    </button>
                  </form>
                )}

                <div className="space-y-2">
                  {members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                      style={{ borderColor: 'var(--border-default)' }}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.name}</div>
                        <div className="truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {m.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {activeProjectEntry.role === 'owner' && m.userId !== user.id ? (
                          <>
                            <select
                              aria-label={`Роль для ${m.email}`}
                              value={m.role}
                              onChange={(e) =>
                                void handleChangeMemberRole(
                                  m.userId,
                                  e.target.value as ProjectRole,
                                )
                              }
                              className="rounded border px-2 py-1 text-xs"
                              style={{
                                backgroundColor: 'var(--bg-subtle)',
                                borderColor: 'var(--border-default)',
                                color: 'var(--text-primary)',
                              }}
                            >
                              {PROJECT_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void handleRemoveMember(m.userId)}
                              className="rounded p-1"
                              style={{ color: 'var(--sem-danger-text)' }}
                              aria-label={`Удалить ${m.email}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <span
                            className="rounded px-2 py-0.5 font-mono text-[11px]"
                            style={{
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {m.role}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : docDetail ? (
            <div className="mx-auto max-w-4xl">
              {showHistory && (
                <div
                  className="mb-6 space-y-3 rounded-xl border p-4"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      className="text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      История ревизий (append-only)
                    </div>
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      {(['all', 'human', 'ai', 'merge'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setHistoryFilter(f)}
                          className="rounded border px-2 py-0.5 uppercase"
                          style={{
                            backgroundColor:
                              historyFilter === f ? 'var(--accent-primary-soft)' : 'var(--bg-subtle)',
                            borderColor:
                              historyFilter === f ? 'var(--accent-primary)' : 'var(--border-default)',
                            color:
                              historyFilter === f ? 'var(--accent-primary)' : 'var(--text-secondary)',
                          }}
                        >
                          {f === 'all' ? 'Все' : f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {filteredRevisions.map((rev) => (
                      <div
                        key={rev.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs"
                        style={{
                          borderColor:
                            previewRevision?.id === rev.id
                              ? 'var(--accent-primary)'
                              : 'var(--border-default)',
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-mono font-semibold">v{rev.revisionNumber}</span>
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] uppercase"
                            style={{
                              backgroundColor: 'var(--bg-subtle)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {rev.authorType}
                          </span>
                          <span className="truncate">{rev.summary ?? 'Без комментария'}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewRevision((cur) => (cur?.id === rev.id ? null : rev))
                            }
                            className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
                          >
                            <Eye className="h-3 w-3" />
                            {previewRevision?.id === rev.id ? 'Скрыть' : 'Просмотр'}
                          </button>
                          {canEdit && rev.id !== docDetail.headRevision?.id && (
                            <button
                              type="button"
                              onClick={() => void handleRollback(rev.id)}
                              className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Откатить
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {previewRevision && (
                    <div
                      className="rounded-lg border p-4"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        borderColor: 'var(--border-strong)',
                      }}
                    >
                      <div className="mb-3 flex items-center justify-between text-xs">
                        <span className="font-semibold">
                          Снимок ревизии v{previewRevision.revisionNumber} ({previewRevision.authorType})
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewRevision(null)}
                          className="underline"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          Закрыть
                        </button>
                      </div>
                      <div className="space-y-3">
                        {previewRevision.blocksSnapshot.map((b) => (
                          <div
                            key={b.id}
                            className="rounded-md border p-3"
                            style={{
                              backgroundColor: 'var(--bg-surface)',
                              borderColor: 'var(--border-default)',
                            }}
                          >
                            <BlockContentView block={b} compact />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {editing ? (
                <DocumentEditor
                  initialTitle={docDetail.document.title}
                  initialBlocks={docDetail.headRevision?.blocksSnapshot ?? []}
                  saving={savingDoc}
                  error={docError}
                  isConflictError={isConflictError}
                  onReloadDoc={() => {
                    void loadDoc(docDetail.document.id).then(() => setEditing(false));
                  }}
                  onSave={handleSaveDoc}
                  onCancel={() => {
                    setEditing(false);
                    setDocError(null);
                    setIsConflictError(false);
                  }}
                />
              ) : (
                <div
                  className="rounded-xl border px-5 py-6 sm:px-8 sm:py-8"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <h1 className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">
                    {docDetail.document.icon ? `${docDetail.document.icon} ` : ''}
                    {docDetail.document.title}
                  </h1>
                  <div className="space-y-4">
                    {(docDetail.headRevision?.blocksSnapshot ?? []).map((block) => (
                      <DocumentBlockCard
                        key={block.id}
                        block={block}
                        canEdit={canEdit}
                        onToggleLock={(b) => void handleToggleLock(b)}
                        onReleaseToAi={(b) => void handleReleaseToAi(b)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="mx-auto max-w-lg rounded-xl border p-10 text-center"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
            >
              <FileText className="mx-auto mb-3 h-8 w-8" style={{ color: 'var(--text-muted)' }} />
              <div className="text-sm font-medium">Выберите или создайте страницу</div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Создайте первую страницу в сайдбаре слева или подключите AI-агента через MCP.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
