'use client';

import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
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
import { useI18n } from '../i18n-provider';
import { useTheme } from '../theme-provider';
import { IconButton } from '../ui/icon-button';
import { IconPicker } from '../ui/icon-picker';
import {
  DocumentIcon,
  normalizeProjectIcon,
  ProjectIcon,
  type ProjectIconKey,
} from '../ui/entity-icon';
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
  const { locale, toggleLocale, t } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const projectSwitcherId = useId();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [locugardEnabled, setLocugardEnabled] = useState(false);

  const [projects, setProjects] = useState<ProjectListItemDto[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tree, setTree] = useState<DocumentTreeItemDto[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docDetail, setDocDetail] = useState<DocumentDetailDto | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('doc');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [isConflictError, setIsConflictError] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<RevisionDto[]>([]);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [previewRevision, setPreviewRevision] = useState<RevisionDto | null>(null);

  const [members, setMembers] = useState<ProjectMemberDto[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectRole>('editor');
  const [projectName, setProjectName] = useState('');
  const [projectIcon, setProjectIcon] = useState<ProjectIconKey>('folder');
  const [savingProject, setSavingProject] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const desktopSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const projectSwitcherRef = useRef<HTMLDivElement | null>(null);
  const projectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const docRequestRef = useRef(0);

  const [creatingProject, setCreatingProject] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');

  useEffect(() => {
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setCheckingAuth(false));
    api
      .getAuthProviders()
      .then((res) => setLocugardEnabled(res.providers.locugard.enabled))
      .catch(() => setLocugardEnabled(false));
  }, []);

  const confirmDiscardChanges = () =>
    !editing ||
    !editorDirty ||
    window.confirm(t('ws.confirmDiscard'));

  const changeTab = (nextTab: ActiveTab) => {
    if (!confirmDiscardChanges()) return;
    if (nextTab !== 'doc') {
      setEditing(false);
      setEditorDirty(false);
    }
    setActiveTab(nextTab);
    setMobileMenuOpen(false);
  };

  const changeDocument = (docId: string) => {
    if (docId === activeDocId && activeTab === 'doc') {
      setMobileMenuOpen(false);
      return true;
    }
    if (!confirmDiscardChanges()) return false;
    setEditing(false);
    setEditorDirty(false);
    setActiveDocId(docId);
    setActiveTab('doc');
    setMobileMenuOpen(false);
    return true;
  };

  const changeProject = (projectId: string) => {
    if (projectId === activeProjectId && activeTab === 'doc') return true;
    if (!confirmDiscardChanges()) return false;
    setEditing(false);
    setEditorDirty(false);
    setActiveProjectId(projectId || null);
    setActiveTab('doc');
    return true;
  };

  // Keyboard shortcuts: Cmd/Ctrl+K focuses the visible search input; Escape closes overlays
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.matchMedia('(min-width: 768px)').matches) {
          setMobileMenuOpen(false);
          desktopSearchInputRef.current?.focus();
        } else {
          setMobileMenuOpen(true);
          setTimeout(() => mobileSearchInputRef.current?.focus(), 0);
        }
      } else if (e.key === 'Escape') {
        setSearchResults([]);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const focusableSelector =
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusable[0]?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!projectSwitcherOpen) return;
    const switcher = projectSwitcherRef.current;
    const selectedOption = switcher?.querySelector<HTMLElement>('[data-project-option][aria-selected="true"]');
    (selectedOption ?? switcher?.querySelector<HTMLElement>('[data-project-option]'))?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !switcher?.contains(event.target)) {
        setProjectSwitcherOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setProjectSwitcherOpen(false);
      projectTriggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [projectSwitcherOpen]);

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
    const requestId = ++docRequestRef.current;
    setLoadingDoc(true);
    setDocDetail((current) => (current?.document.id === docId ? current : null));
    try {
      const res = await api.getDoc(docId);
      if (requestId !== docRequestRef.current) return false;
      setDocDetail(res);
      setDocError(null);
      setIsConflictError(false);
      return true;
    } catch (err) {
      if (requestId !== docRequestRef.current) return false;
      setDocError(err instanceof ApiClientError ? err.message : t('ws.loadPageError'));
      return false;
    } finally {
      if (requestId === docRequestRef.current) setLoadingDoc(false);
    }
  }, [t]);

  useEffect(() => {
    if (activeDocId) {
      setEditing(false);
      setEditorDirty(false);
      setShowHistory(false);
      setPreviewRevision(null);
      void loadDoc(activeDocId);
    } else {
      docRequestRef.current += 1;
      setLoadingDoc(false);
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
        err instanceof ApiClientError ? err.message : t('ws.loadMembersError'),
      );
    }
  }, [t]);

  useEffect(() => {
    if (activeTab === 'settings' && activeProjectId) {
      void loadMembers(activeProjectId);
    }
  }, [activeTab, activeProjectId, loadMembers]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query || !user) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      void api
        .searchDocs(query, activeProjectId ?? undefined)
        .then((res) => {
          if (!cancelled) setSearchResults(res.results);
        })
        .catch((err) => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchError(err instanceof ApiClientError ? err.message : t('ws.searchError'));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, activeProjectId, user, t]);

  const activeProjectEntry = useMemo(
    () => projects.find((p) => p.project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  useEffect(() => {
    setProjectName(activeProjectEntry?.project.name ?? '');
    setProjectIcon(normalizeProjectIcon(activeProjectEntry?.project.icon ?? null));
  }, [activeProjectEntry?.project.id, activeProjectEntry?.project.name, activeProjectEntry?.project.icon]);

  useEffect(() => {
    setSettingsError(null);
    setSettingsSuccess(null);
  }, [activeProjectEntry?.project.id]);

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
    if (!newProjName.trim() || !confirmDiscardChanges()) return;
    setEditing(false);
    setEditorDirty(false);
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
    if (!activeProjectId || !newDocTitle.trim() || !confirmDiscardChanges()) return;
    setEditing(false);
    setEditorDirty(false);
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
          content: t('ws.newPageInitialContent'),
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
    icon: ProjectIconKey,
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
        icon,
        summary,
      });
      await loadDoc(docDetail.document.id);
      if (activeProjectId) await loadTree(activeProjectId);
      setEditing(false);
      setEditorDirty(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setDocError(err.message);
        setIsConflictError(err.code === ERROR_CODES.HEAD_REVISION_CONFLICT);
      } else {
        setDocError(t('ws.saveDocError'));
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

  const handleUpdateProjectDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeProjectId || activeProjectEntry?.role !== 'owner' || !projectName.trim()) return;
    setSavingProject(true);
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      await api.updateProject(activeProjectId, {
        name: projectName.trim(),
        icon: projectIcon,
      });
      await loadProjects();
      setSettingsSuccess(t('ws.saveProjectSuccess'));
    } catch (err) {
      setSettingsError(
        err instanceof ApiClientError ? err.message : t('ws.saveProjectError'),
      );
    } finally {
      setSavingProject(false);
    }
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
        err instanceof ApiClientError ? err.message : t('ws.addMemberError'),
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
    if (!confirmDiscardChanges()) return;
    await api.logout();
    setUser(null);
  };

  if (checkingAuth) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-sm"
        style={{ color: 'var(--text-muted)' }}
      >
        {t('ws.loadingApp')}
      </div>
    );
  }

  if (!user) {
    return <AuthScreen locugardEnabled={locugardEnabled} onAuthenticated={setUser} />;
  }

  const totalPending = projects.reduce((acc, p) => acc + p.pendingProposalsCount, 0);

  const renderSidebar = (isMobile: boolean) => (
    <aside
      aria-label={t('ws.navAria')}
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
          <img
            src="/favicon.svg"
            alt="Docalaizer"
            width={20}
            height={20}
            className="h-5 w-5 shrink-0 rounded"
          />
          <span>Docalaizer</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleLocale}
            aria-label={t('common.switchLanguage')}
            title={t('common.switchLanguage')}
            className="rounded px-1.5 py-1 text-[11px] font-semibold uppercase transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            {locale}
          </button>
          <IconButton
            onClick={toggleTheme}
            label={theme === 'dark' ? t('common.switchToLight') : t('common.switchToDark')}
            style={{ color: 'var(--text-secondary)' }}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" strokeWidth={1.75} />
            ) : (
              <Moon className="h-4 w-4" strokeWidth={1.75} />
            )}
          </IconButton>
          <IconButton
            onClick={() => setMobileMenuOpen(false)}
            className="md:hidden"
            label={t('ws.closeMenu')}
            style={{ color: 'var(--text-secondary)' }}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      {/* Project Switcher */}
      <div className="space-y-2 border-b p-3" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex items-center gap-1.5">
          <div ref={projectSwitcherRef} className="relative min-w-0 flex-1">
            <button
              ref={projectTriggerRef}
              type="button"
              disabled={projects.length === 0}
              aria-haspopup="listbox"
              aria-expanded={projectSwitcherOpen}
              aria-controls={`${projectSwitcherId}-${isMobile ? 'mobile' : 'desktop'}`}
              aria-label={t('ws.selectProjectAria')}
              onClick={() => setProjectSwitcherOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown') return;
                event.preventDefault();
                setProjectSwitcherOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] font-medium disabled:opacity-60"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              <ProjectIcon icon={activeProjectEntry?.project.icon} className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {activeProjectEntry?.project.name ?? (projects.length > 0 ? t('ws.selectProject') : t('ws.noProjects'))}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform ${projectSwitcherOpen ? 'rotate-180' : ''}`}
                style={{ color: 'var(--text-muted)' }}
              />
            </button>

            {projectSwitcherOpen && (
              <ul
                id={`${projectSwitcherId}-${isMobile ? 'mobile' : 'desktop'}`}
                role="listbox"
                aria-label={t('ws.projectsAria')}
                className="absolute left-0 right-0 top-10 z-30 max-h-60 overflow-y-auto rounded-md border p-1 shadow-md"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Tab') {
                    setProjectSwitcherOpen(false);
                    projectTriggerRef.current?.focus();
                    return;
                  }
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const options = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>('[data-project-option]'),
                  );
                  if (options.length === 0) return;
                  const currentIndex = options.indexOf(document.activeElement as HTMLElement);
                  const nextIndex =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? options.length - 1
                        : event.key === 'ArrowDown'
                          ? (currentIndex + 1 + options.length) % options.length
                          : (currentIndex - 1 + options.length) % options.length;
                  options[nextIndex]?.focus();
                }}
              >
                {projects.map(({ project }) => {
                  const selected = project.id === activeProjectId;
                  return (
                    <li key={project.id} role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-project-option
                        onClick={() => {
                          if (!changeProject(project.id)) return;
                          setProjectSwitcherOpen(false);
                          projectTriggerRef.current?.focus();
                        }}
                        className="nav-item flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[13px]"
                        style={{
                          backgroundColor: selected ? 'var(--accent-primary-soft)' : undefined,
                          color: selected ? 'var(--accent-primary)' : 'var(--text-primary)',
                        }}
                      >
                        <ProjectIcon icon={project.icon} className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        {selected && <Check className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <IconButton
            onClick={() => setCreatingProject((v) => !v)}
            className="btn-secondary"
            label={t('ws.newProject')}
          >
            <FolderPlus className="h-4 w-4" strokeWidth={1.75} />
          </IconButton>
        </div>

        {creatingProject && (
          <form onSubmit={(e) => void handleCreateProject(e)} className="flex gap-1">
            <input
              type="text"
              value={newProjName}
              onChange={(e) => setNewProjName(e.target.value)}
              placeholder={t('ws.newProjectPlaceholder')}
              aria-label={t('ws.newProjectAria')}
              className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
            <button type="submit" className="btn-primary rounded px-2 py-1 text-[13px] font-medium">
              {t('common.ok')}
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
            ref={isMobile ? mobileSearchInputRef : desktopSearchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('ws.searchPlaceholder')}
            aria-label={t('ws.searchAria')}
            className="w-full rounded-md border py-1.5 pl-8 pr-2 text-[13px]"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          {searchQuery.trim() && (
            <div
              className="absolute left-0 right-0 top-10 z-20 max-h-56 overflow-y-auto rounded-md border shadow-md"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
            >
              {searching ? (
                <div role="status" className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('ws.searching')}
                </div>
              ) : searchError ? (
                <div role="alert" className="px-3 py-2 text-xs" style={{ color: 'var(--sem-danger-text)' }}>
                  {searchError}
                </div>
              ) : searchResults.length === 0 ? (
                <div role="status" className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {t('ws.nothingFound')}
                </div>
              ) : (
                searchResults.map((r) => (
                  <button
                    key={r.documentId}
                    type="button"
                    onClick={() => {
                      if (changeDocument(r.documentId)) setSearchQuery('');
                    }}
                    className="nav-item flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]"
                  >
                    <FileText className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{r.title}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Workspace Navigation */}
      <nav
        aria-label={t('ws.sectionsAria')}
        className="space-y-0.5 border-b p-2 text-[13px]"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <button
          type="button"
          aria-current={activeTab === 'inbox' ? 'page' : undefined}
          onClick={() => changeTab('inbox')}
          className="nav-item flex w-full items-center justify-between rounded-md px-2.5 py-1.5 font-medium"
          style={{
            backgroundColor: activeTab === 'inbox' ? 'var(--accent-primary-soft)' : undefined,
            color: activeTab === 'inbox' ? 'var(--accent-primary)' : 'var(--text-primary)',
          }}
        >
          <span className="flex items-center gap-2">
            <Inbox className="h-3.5 w-3.5" />
            {t('ws.reviewInbox')}
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
          onClick={() => changeTab('agents')}
          className="nav-item flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 font-medium"
          style={{
            backgroundColor: activeTab === 'agents' ? 'var(--accent-primary-soft)' : undefined,
            color: activeTab === 'agents' ? 'var(--accent-primary)' : 'var(--text-primary)',
          }}
        >
          <Bot className="h-3.5 w-3.5" />
          {t('ws.agentsAndMcp')}
        </button>

        {activeProjectEntry && (
          <button
            type="button"
            aria-current={activeTab === 'settings' ? 'page' : undefined}
            onClick={() => changeTab('settings')}
            className="nav-item flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 font-medium"
            style={{
              backgroundColor:
                activeTab === 'settings' ? 'var(--accent-primary-soft)' : undefined,
              color: activeTab === 'settings' ? 'var(--accent-primary)' : 'var(--text-primary)',
            }}
          >
            <Settings className="h-3.5 w-3.5" />
            {t('ws.projectSettings')}
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
            {t('ws.pages')}
          </span>
          {canEdit && (
            <IconButton
              onClick={() => setCreatingDoc((v) => !v)}
              label={t('ws.newPage')}
              style={{ color: 'var(--text-secondary)' }}
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </IconButton>
          )}
        </div>

        {creatingDoc && (
          <form onSubmit={(e) => void handleCreateDoc(e)} className="mb-2 flex gap-1 px-1">
            <input
              type="text"
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              placeholder={t('ws.newPagePlaceholder')}
              aria-label={t('ws.newPageAria')}
              className="min-w-0 flex-1 rounded border px-2 py-1 text-xs"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            />
            <button type="submit" className="btn-primary rounded px-2 py-1 text-[13px] font-medium">
              {t('common.ok')}
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
                onClick={() => changeDocument(doc.id)}
                className="nav-item flex w-full items-center justify-between rounded-md py-1.5 pr-2 text-left text-[13px]"
                style={{
                  paddingLeft: `${0.5 + Math.min(depth, 5) * 0.9}rem`,
                  backgroundColor: isSelected ? 'var(--accent-primary-soft)' : undefined,
                  color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                  fontWeight: isSelected ? 600 : 400,
                }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <DocumentIcon icon={doc.icon} className="h-4 w-4 shrink-0 opacity-60" />
                  <span className="truncate">{doc.title}</span>
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
        <IconButton
          onClick={() => void handleLogout()}
          label={t('ws.logoutAria')}
          title={t('ws.logout')}
          style={{ color: 'var(--text-secondary)' }}
        >
          <LogOut className="h-4 w-4" strokeWidth={1.75} />
        </IconButton>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      {/* Desktop sidebar */}
      <div className="hidden md:flex">{renderSidebar(false)}</div>

      {/* Mobile slide-over drawer */}
      {mobileMenuOpen && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('ws.mobileNavAria')}
          className="fixed inset-0 z-40 flex md:hidden"
        >
          <div className="relative z-10 flex h-full">{renderSidebar(true)}</div>
          <button
            type="button"
            aria-label={t('ws.closeNav')}
            onClick={() => setMobileMenuOpen(false)}
            className="flex-1 bg-black/45"
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-4 text-[13px] sm:px-5"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex min-w-0 items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <IconButton
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden"
              label={t('ws.openNav')}
              style={{ color: 'var(--text-primary)' }}
            >
              <Menu className="h-4 w-4" strokeWidth={1.75} />
            </IconButton>
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
                <span className="hidden sm:inline">{t('ws.history')}</span>
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setEditorDirty(false);
                    setEditing(true);
                  }}
                  className="btn-primary inline-flex items-center gap-1 rounded-md px-3 py-1 text-[13px] font-medium"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('ws.edit')}</span>
                </button>
              )}
            </div>
          )}
        </header>

        <main
          className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8"
          aria-busy={activeTab === 'doc' && loadingDoc}
        >
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
                {t('ws.settingsTitle', { name: activeProjectEntry.project.name })}
              </h1>

              {settingsError && (
                <div
                  role="alert"
                  className="rounded-lg border px-3.5 py-2.5 text-sm"
                  style={{
                    backgroundColor: 'var(--sem-danger-bg)',
                    borderColor: 'var(--sem-danger-border)',
                    color: 'var(--sem-danger-text)',
                  }}
                >
                  {settingsError}
                </div>
              )}

              {settingsSuccess && (
                <div
                  role="status"
                  className="rounded-lg border px-3.5 py-2.5 text-sm"
                  style={{
                    backgroundColor: 'var(--sem-clean-bg)',
                    borderColor: 'var(--sem-clean-border)',
                    color: 'var(--sem-clean-text)',
                  }}
                >
                  {settingsSuccess}
                </div>
              )}

              <form
                onSubmit={(e) => void handleUpdateProjectDetails(e)}
                className="space-y-4 rounded-xl border p-5"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: 'var(--accent-primary-soft)',
                      color: 'var(--accent-primary)',
                    }}
                  >
                    <ProjectIcon icon={projectIcon} className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">{t('ws.nameAndIcon')}</h2>
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t('ws.visibleToAll')}
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="project-name"
                    className="mb-1.5 block text-xs font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {t('ws.projectNameLabel')}
                  </label>
                  <input
                    id="project-name"
                    type="text"
                    required
                    maxLength={140}
                    disabled={activeProjectEntry.role !== 'owner' || savingProject}
                    value={projectName}
                    onChange={(e) => {
                      setProjectName(e.target.value);
                      setSettingsSuccess(null);
                    }}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-default)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <IconPicker
                  label={t('ws.projectIconLabel')}
                  value={projectIcon}
                  disabled={activeProjectEntry.role !== 'owner' || savingProject}
                  onChange={(value) => {
                    setProjectIcon(value);
                    setSettingsSuccess(null);
                  }}
                />

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {activeProjectEntry.role === 'owner'
                      ? t('ws.slugUnchanged')
                      : t('ws.ownerOnlyEdit')}
                  </p>
                  <button
                    type="submit"
                    disabled={
                      activeProjectEntry.role !== 'owner' || savingProject || !projectName.trim()
                    }
                    className="btn-primary shrink-0 rounded-md px-3.5 py-2 text-[13px] font-medium disabled:opacity-60"
                  >
                    {savingProject ? t('common.saving') : t('common.save')}
                  </button>
                </div>
              </form>

              <div
                className="space-y-3 rounded-xl border p-5"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                }}
              >
                <div className="text-sm font-medium">{t('ws.approvalPolicyTitle')}</div>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t('ws.approvalPolicyHintPrefix')} <code>humanTouched</code>{' '}
                  {t('ws.approvalPolicyHintOr')} <code>lockedByHuman</code>{' '}
                  {t('ws.approvalPolicyHintSuffix')}
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
                  {t('ws.membersTitle', { count: members.length })}
                </div>

                {activeProjectEntry.role === 'owner' && (
                  <form onSubmit={(e) => void handleAddMember(e)} className="flex flex-wrap gap-2">
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder={t('ws.memberEmailPlaceholder')}
                      aria-label={t('ws.memberEmailAria')}
                      className="min-w-[180px] flex-1 rounded-md border px-3 py-1.5 text-xs"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <select
                      aria-label={t('ws.memberRoleAria')}
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
                      className="btn-primary inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-medium"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      {t('common.add')}
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
                              aria-label={t('ws.memberRoleFor', { email: m.email })}
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
                            <IconButton
                              onClick={() => void handleRemoveMember(m.userId)}
                              label={t('ws.removeMember', { email: m.email })}
                              style={{ color: 'var(--sem-danger-text)' }}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                            </IconButton>
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
              {docError && !editing && (
                <div
                  role="alert"
                  className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-sm"
                  style={{
                    backgroundColor: 'var(--sem-danger-bg)',
                    borderColor: 'var(--sem-danger-border)',
                    color: 'var(--sem-danger-text)',
                  }}
                >
                  <span>{docError}</span>
                  <button
                    type="button"
                    onClick={() => void loadDoc(docDetail.document.id)}
                    className="btn-secondary rounded-md px-2.5 py-1 text-[13px] font-medium"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}
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
                      {t('ws.revisionHistory')}
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
                          {f === 'all' ? t('common.all') : f}
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
                          <span className="truncate">{rev.summary ?? t('ws.noComment')}</span>
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
                            {previewRevision?.id === rev.id ? t('ws.hide') : t('ws.view')}
                          </button>
                          {canEdit && rev.id !== docDetail.headRevision?.id && (
                            <button
                              type="button"
                              onClick={() => void handleRollback(rev.id)}
                              className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
                            >
                              <RotateCcw className="h-3 w-3" />
                              {t('ws.rollback')}
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
                          {t('ws.revisionSnapshot', {
                            num: previewRevision.revisionNumber,
                            author: previewRevision.authorType,
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewRevision(null)}
                          className="underline"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          {t('common.close')}
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
                  initialIcon={docDetail.document.icon}
                  initialBlocks={docDetail.headRevision?.blocksSnapshot ?? []}
                  saving={savingDoc}
                  error={docError}
                  isConflictError={isConflictError}
                  onDirtyChange={setEditorDirty}
                  onReloadDoc={() => {
                    if (!confirmDiscardChanges()) return;
                    void loadDoc(docDetail.document.id).then((loaded) => {
                      if (!loaded) return;
                      setEditing(false);
                      setEditorDirty(false);
                    });
                  }}
                  onSave={handleSaveDoc}
                  onCancel={() => {
                    setEditing(false);
                    setEditorDirty(false);
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
                  <div className="mb-6 flex items-start gap-3">
                    <DocumentIcon
                      icon={docDetail.document.icon}
                      className="mt-1 h-6 w-6 shrink-0 sm:mt-1.5"
                    />
                    <h1 className="min-w-0 text-2xl font-bold tracking-tight sm:text-3xl">
                      {docDetail.document.title}
                    </h1>
                  </div>
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
          ) : loadingDoc ? (
            <div
              className="mx-auto max-w-4xl space-y-4 rounded-xl border p-6 sm:p-8"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
              aria-label={t('ws.loadingDocAria')}
              aria-busy="true"
            >
              <div className="h-8 w-2/3 rounded-md" style={{ backgroundColor: 'var(--bg-subtle)' }} />
              <div className="h-4 w-full rounded" style={{ backgroundColor: 'var(--bg-subtle)' }} />
              <div className="h-4 w-11/12 rounded" style={{ backgroundColor: 'var(--bg-subtle)' }} />
              <div className="h-4 w-4/5 rounded" style={{ backgroundColor: 'var(--bg-subtle)' }} />
            </div>
          ) : docError ? (
            <div
              role="alert"
              className="mx-auto max-w-lg rounded-xl border p-8 text-center"
              style={{
                backgroundColor: 'var(--sem-danger-bg)',
                borderColor: 'var(--sem-danger-border)',
                color: 'var(--sem-danger-text)',
              }}
            >
              <div className="text-sm font-medium">{t('ws.failedLoadPage')}</div>
              <p className="mt-2 text-sm">{docError}</p>
              {activeDocId && (
                <button
                  type="button"
                  onClick={() => void loadDoc(activeDocId)}
                  className="btn-secondary mt-4 rounded-md px-3 py-1.5 text-sm font-medium"
                >
                  {t('ws.retryLoad')}
                </button>
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
              <div className="text-sm font-medium">{t('ws.emptyStateTitle')}</div>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {t('ws.emptyStateHint')}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
