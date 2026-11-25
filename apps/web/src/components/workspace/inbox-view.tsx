'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Code2,
  Eye,
  GitPullRequest,
  Lock,
  Pencil,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { DocumentBlock, ProposalBlockPayload } from '@docalaizer/core';
import type { ConflictState } from '@docalaizer/shared';
import {
  ApiClientError,
  type ProposalDetailDto,
  type ProposalDetailOpDto,
  type ProposalInboxItemDto,
  api,
} from '@/lib/api';
import { BlockContentView } from '../blocks/block-renderer';
import { useI18n } from '../i18n-provider';
import { TextDiffView } from '../visualizations/text-diff-view';

interface InboxViewProps {
  projectId?: string;
  onReviewed?: () => void;
}

interface OpDecisionState {
  decision: 'accepted' | 'rejected' | 'edited';
  comment: string;
  forceStaleConfirmed: boolean;
  editedText: string;
  diffMode: 'visual' | 'text';
  showBase: boolean;
}

const CONFLICT_STYLE: Record<ConflictState, { bg: string; text: string; border: string }> = {
  clean: {
    bg: 'var(--sem-clean-bg)',
    text: 'var(--sem-clean-text)',
    border: 'var(--sem-clean-border)',
  },
  human_protected: {
    bg: 'var(--sem-human-bg)',
    text: 'var(--sem-human-text)',
    border: 'var(--sem-human-border)',
  },
  locked: {
    bg: 'var(--sem-danger-bg)',
    text: 'var(--sem-danger-text)',
    border: 'var(--sem-danger-border)',
  },
  stale_conflict: {
    bg: 'var(--sem-danger-bg)',
    text: 'var(--sem-danger-text)',
    border: 'var(--sem-danger-border)',
  },
  risky_delete: {
    bg: 'var(--sem-danger-bg)',
    text: 'var(--sem-danger-text)',
    border: 'var(--sem-danger-border)',
  },
};

function blockToComparableText(block: DocumentBlock | ProposalBlockPayload | null): string {
  if (!block) return '';
  switch (block.type) {
    case 'markdown':
      return block.content;
    case 'diagram':
      return block.content.source;
    case 'chart': {
      const merged =
        block.content.data !== undefined && block.content.spec.data === undefined
          ? { ...block.content.spec, data: { values: block.content.data } }
          : block.content.spec;
      return JSON.stringify(merged, null, 2);
    }
    case 'callout':
      return block.content.markdown;
    case 'table': {
      const header = `| ${block.content.columns.join(' | ')} |`;
      const sep = `| ${block.content.columns.map(() => '---').join(' | ')} |`;
      const rows = block.content.rows.map((r) => `| ${r.join(' | ')} |`);
      return [header, sep, ...rows].join('\n');
    }
  }
}

function buildEditedPayload(
  op: ProposalDetailOpDto,
  editedText: string,
  invalidVegaMessage: string,
): { ok: true; payload: ProposalBlockPayload } | { ok: false; error: string } {
  const template = op.row.newBlockPayload ?? op.headBlock;
  if (!template) {
    return { ok: true, payload: { type: 'markdown', content: editedText } };
  }

  const baseFields = {
    ...(template.id ? { id: template.id } : {}),
    ...(template.title ? { title: template.title } : {}),
  };

  if (template.type === 'markdown') {
    return { ok: true, payload: { ...baseFields, type: 'markdown', content: editedText } };
  }
  if (template.type === 'diagram') {
    return {
      ok: true,
      payload: {
        ...baseFields,
        type: 'diagram',
        content: {
          engine: 'mermaid',
          source: editedText,
          ...(template.content.caption ? { caption: template.content.caption } : {}),
        },
      },
    };
  }
  if (template.type === 'chart') {
    try {
      const parsed = JSON.parse(editedText) as Record<string, unknown>;
      return {
        ok: true,
        payload: {
          ...baseFields,
          type: 'chart',
          content: {
            engine: 'vega-lite',
            spec: parsed,
            ...(template.content.caption ? { caption: template.content.caption } : {}),
          },
        },
      };
    } catch {
      return { ok: false, error: invalidVegaMessage };
    }
  }
  if (template.type === 'callout') {
    return {
      ok: true,
      payload: {
        ...baseFields,
        type: 'callout',
        content: { variant: template.content.variant, markdown: editedText },
      },
    };
  }
  const lines = editedText
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const splitRow = (line: string) =>
    line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const columns = lines[0] ? splitRow(lines[0]) : [];
  const rows = lines.slice(lines[1]?.includes('---') ? 2 : 1).map(splitRow);
  return { ok: true, payload: { ...baseFields, type: 'table', content: { columns, rows } } };
}

export function InboxView({ projectId, onReviewed }: InboxViewProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<ProposalInboxItemDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetailDto | null>(null);
  const [decisions, setDecisions] = useState<Record<string, OpDecisionState>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.listProposals({ projectId, status: 'pending' });
      setItems(res.proposals);
      setError(null);
      setSelectedId((prev) => {
        if (prev && res.proposals.some((p) => p.proposal.id === prev)) return prev;
        return res.proposals[0]?.proposal.id ?? null;
      });
      if (res.proposals.length === 0) {
        setDetail(null);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('inbox.loadError'));
    } finally {
      setLoadingList(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoadingDetail(true);

    api
      .getProposal(selectedId)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        // Safe defaults: clean -> accepted; human_protected / risky_delete / stale_conflict / locked -> rejected
        const initDecisions: Record<string, OpDecisionState> = {};
        for (const op of res.ops) {
          initDecisions[op.row.id] = {
            decision: op.defaultDecision,
            comment: op.row.reviewComment ?? '',
            forceStaleConfirmed: false,
            editedText: blockToComparableText(op.row.newBlockPayload ?? op.headBlock),
            diffMode:
              op.row.newBlockPayload?.type === 'diagram' ||
              op.row.newBlockPayload?.type === 'chart' ||
              op.headBlock?.type === 'diagram' ||
              op.headBlock?.type === 'chart'
                ? 'visual'
                : 'text',
            showBase: false,
          };
        }
        setDecisions(initDecisions);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiClientError ? err.message : t('inbox.loadDetailError'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, t]);

  const updateDecision = (opId: string, patch: Partial<OpDecisionState>) => {
    setDecisions((prev) => {
      const current = prev[opId];
      if (!current) return prev;
      return { ...prev, [opId]: { ...current, ...patch } };
    });
  };

  const handleApplyReview = async () => {
    if (!detail) return;
    setError(null);

    const payloadDecisions: Array<{
      opId: string;
      decision: 'accepted' | 'rejected' | 'edited';
      humanEditedPayload?: ProposalBlockPayload;
      reviewComment?: string;
      forceResolveStale?: boolean;
    }> = [];

    for (let i = 0; i < detail.ops.length; i++) {
      const op = detail.ops[i]!;
      const state = decisions[op.row.id];
      if (!state) continue;

      if (
        op.liveConflictState === 'stale_conflict' &&
        state.decision === 'accepted' &&
        !state.forceStaleConfirmed
      ) {
        setError(t('inbox.confirmStaleError', { n: i + 1 }));
        return;
      }

      if (state.decision === 'edited') {
        const built = buildEditedPayload(op, state.editedText, t('inbox.invalidVegaJson'));
        if (!built.ok) {
          setError(t('inbox.opError', { n: i + 1, error: built.error }));
          return;
        }
        payloadDecisions.push({
          opId: op.row.id,
          decision: 'edited',
          humanEditedPayload: built.payload,
          ...(state.comment.trim() ? { reviewComment: state.comment.trim() } : {}),
        });
      } else {
        payloadDecisions.push({
          opId: op.row.id,
          decision: state.decision,
          ...(state.comment.trim() ? { reviewComment: state.comment.trim() } : {}),
          ...(op.liveConflictState === 'stale_conflict' && state.decision === 'accepted'
            ? { forceResolveStale: true }
            : {}),
        });
      }
    }

    setSubmitting(true);
    try {
      await api.reviewProposal(detail.proposal.id, { decisions: payloadDecisions });
      setSelectedId(null);
      setDetail(null);
      await loadList();
      onReviewed?.();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t('inbox.applyError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('inbox.title')}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {t('inbox.subtitle')}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border px-3.5 py-2.5 text-xs"
          style={{
            backgroundColor: 'var(--sem-danger-bg)',
            borderColor: 'var(--sem-danger-border)',
            color: 'var(--sem-danger-text)',
          }}
        >
          {error}
        </div>
      )}

      {loadingList ? (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('inbox.loading')}
        </div>
      ) : items.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl border py-14 text-center"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <CheckCircle2 className="mb-2 h-8 w-8" style={{ color: 'var(--sem-clean-text)' }} />
          <div className="text-sm font-medium">{t('inbox.emptyTitle')}</div>
          <p className="mt-1 max-w-md text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('inbox.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2" aria-label={t('inbox.listAria')}>
            {items.map((item) => {
              const active = item.proposal.id === selectedId;
              return (
                <button
                  key={item.proposal.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setSelectedId(item.proposal.id)}
                  className="nav-item w-full rounded-lg border p-3 text-left"
                  style={{
                    backgroundColor: active ? 'var(--accent-primary-soft)' : 'var(--bg-surface)',
                    borderColor: active ? 'var(--accent-primary)' : 'var(--border-default)',
                  }}
                >
                  <div
                    className="flex items-center gap-1.5 text-[11px]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Bot className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--sem-ai-text)' }} />
                    <span className="truncate">{item.agentName}</span>
                  </div>
                  <div className="mt-1 truncate text-sm font-medium">{item.proposal.title}</div>
                  <div className="mt-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {item.projectName} / {item.documentTitle}
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="min-w-0">
            {loadingDetail || !detail ? (
              <div
                className="rounded-xl border p-8 text-center text-xs"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-muted)',
                }}
              >
                {t('inbox.computingDiff')}
              </div>
            ) : (
              <div className="space-y-4">
                <div
                  className="rounded-xl border p-4"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div
                        className="flex items-center gap-2 text-xs"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <GitPullRequest
                          className="h-4 w-4 shrink-0"
                          style={{ color: 'var(--sem-ai-text)' }}
                        />
                        <span className="truncate">{detail.document.title}</span>
                      </div>
                      <h2 className="mt-1 text-lg font-semibold">{detail.proposal.title}</h2>
                      {detail.proposal.rationale && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          {detail.proposal.rationale}
                        </p>
                      )}
                      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                        <span
                          className="rounded px-2 py-0.5 font-medium"
                          style={{
                            backgroundColor: 'var(--sem-clean-bg)',
                            color: 'var(--sem-clean-text)',
                          }}
                        >
                          Clean: {detail.summary.clean}
                        </span>
                        {detail.summary.human_protected > 0 && (
                          <span
                            className="rounded px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: 'var(--sem-human-bg)',
                              color: 'var(--sem-human-text)',
                            }}
                          >
                            Human protected: {detail.summary.human_protected}
                          </span>
                        )}
                        {detail.summary.stale_conflict > 0 && (
                          <span
                            className="rounded px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: 'var(--sem-danger-bg)',
                              color: 'var(--sem-danger-text)',
                            }}
                          >
                            Stale conflict: {detail.summary.stale_conflict}
                          </span>
                        )}
                        {detail.summary.risky_delete > 0 && (
                          <span
                            className="rounded px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: 'var(--sem-danger-bg)',
                              color: 'var(--sem-danger-text)',
                            }}
                          >
                            Risky delete: {detail.summary.risky_delete}
                          </span>
                        )}
                        {detail.summary.locked > 0 && (
                          <span
                            className="rounded px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: 'var(--sem-danger-bg)',
                              color: 'var(--sem-danger-text)',
                            }}
                          >
                            Locked: {detail.summary.locked}
                          </span>
                        )}
                      </div>
                    </div>
                    {detail.userRole === 'viewer' ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          borderColor: 'var(--border-default)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {t('inbox.viewerBadge')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleApplyReview()}
                        disabled={submitting}
                        className="btn-primary rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
                      >
                        {submitting ? t('inbox.applying') : t('inbox.applyReview')}
                      </button>
                    )}
                  </div>
                </div>

                {detail.ops.map((op) => {
                  const badge = CONFLICT_STYLE[op.liveConflictState];
                  const badgeLabel = t(`inbox.conflict.${op.liveConflictState}`);
                  const state = decisions[op.row.id];
                  if (!state) return null;

                  const isReadOnly = detail.userRole === 'viewer';
                  const isLocked = op.liveConflictState === 'locked';
                  const canManualEdit =
                    !isReadOnly &&
                    !isLocked &&
                    (op.row.opType === 'update' || op.row.opType === 'insert');

                  const editedPreview =
                    state.decision === 'edited'
                      ? buildEditedPayload(op, state.editedText, t('inbox.invalidVegaJson'))
                      : null;

                  return (
                    <div
                      key={op.row.id}
                      className="overflow-hidden rounded-xl border"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor:
                          op.liveConflictState === 'clean'
                            ? 'var(--border-default)'
                            : badge.border,
                      }}
                    >
                      <div
                        className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5"
                        style={{
                          backgroundColor: 'var(--bg-subtle)',
                          borderColor: 'var(--border-default)',
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded px-1.5 py-0.5 font-mono font-semibold uppercase">
                            {op.row.opType}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium"
                            style={{
                              backgroundColor: badge.bg,
                              color: badge.text,
                              borderColor: badge.border,
                            }}
                          >
                            {isLocked ? (
                              <Lock className="h-3 w-3" />
                            ) : op.liveConflictState !== 'clean' ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : null}
                            {badgeLabel}
                          </span>

                          {op.row.opType !== 'move' && (
                            <button
                              type="button"
                              onClick={() =>
                                updateDecision(op.row.id, {
                                  diffMode: state.diffMode === 'visual' ? 'text' : 'visual',
                                })
                              }
                              className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px]"
                            >
                              {state.diffMode === 'visual' ? (
                                <>
                                  <Code2 className="h-3 w-3" />
                                  {t('inbox.textDiff')}
                                </>
                              ) : (
                                <>
                                  <Eye className="h-3 w-3" />
                                  {t('inbox.visualDiff')}
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isReadOnly || isLocked || !op.canApply}
                            onClick={() => updateDecision(op.row.id, { decision: 'accepted' })}
                            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] font-medium disabled:opacity-40"
                            style={{
                              backgroundColor:
                                state.decision === 'accepted'
                                  ? 'var(--sem-clean-bg)'
                                  : 'var(--bg-surface)',
                              borderColor:
                                state.decision === 'accepted'
                                  ? 'var(--sem-clean-border)'
                                  : 'var(--border-default)',
                              color:
                                state.decision === 'accepted'
                                  ? 'var(--sem-clean-text)'
                                  : 'var(--text-secondary)',
                            }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {t('inbox.accept')}
                          </button>

                          {canManualEdit && (
                            <button
                              type="button"
                              onClick={() => updateDecision(op.row.id, { decision: 'edited' })}
                              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] font-medium"
                              style={{
                                backgroundColor:
                                  state.decision === 'edited'
                                    ? 'var(--sem-human-bg)'
                                    : 'var(--bg-surface)',
                                borderColor:
                                  state.decision === 'edited'
                                    ? 'var(--sem-human-border)'
                                    : 'var(--border-default)',
                                color:
                                  state.decision === 'edited'
                                    ? 'var(--sem-human-text)'
                                    : 'var(--text-secondary)',
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {t('inbox.editManually')}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => updateDecision(op.row.id, { decision: 'rejected' })}
                            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[13px] font-medium disabled:opacity-40"
                            style={{
                              backgroundColor:
                                state.decision === 'rejected'
                                  ? 'var(--sem-danger-bg)'
                                  : 'var(--bg-surface)',
                              borderColor:
                                state.decision === 'rejected'
                                  ? 'var(--sem-danger-border)'
                                  : 'var(--border-default)',
                              color:
                                state.decision === 'rejected'
                                  ? 'var(--sem-danger-text)'
                                  : 'var(--text-secondary)',
                            }}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            {t('inbox.reject')}
                          </button>
                        </div>
                      </div>

                      {op.reasons.length > 0 && (
                        <div
                          className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs"
                          style={{
                            backgroundColor: badge.bg,
                            borderColor: badge.border,
                            color: badge.text,
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                              {op.reasons.join(' ')}
                              {isLocked && t('inbox.unlockHint')}
                            </div>
                          </div>
                          {op.baseBlock && op.liveConflictState === 'stale_conflict' && (
                            <button
                              type="button"
                              onClick={() =>
                                updateDecision(op.row.id, { showBase: !state.showBase })
                              }
                              className="underline underline-offset-2 font-medium"
                            >
                              {state.showBase ? t('inbox.hideBase') : t('inbox.showBase')}
                            </button>
                          )}
                        </div>
                      )}

                      {op.liveConflictState === 'stale_conflict' &&
                        state.decision === 'accepted' && (
                          <label
                            className="flex cursor-pointer items-center gap-2 border-b px-4 py-2 text-xs font-medium"
                            style={{
                              backgroundColor: 'var(--sem-human-bg)',
                              borderColor: 'var(--sem-human-border)',
                              color: 'var(--sem-human-text)',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={state.forceStaleConfirmed}
                              onChange={(e) =>
                                updateDecision(op.row.id, {
                                  forceStaleConfirmed: e.target.checked,
                                })
                              }
                            />
                            {t('inbox.confirmStaleCheckbox')}
                          </label>
                        )}

                      {state.showBase && op.baseBlock && (
                        <div
                          className="border-b px-4 py-3"
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            borderColor: 'var(--border-default)',
                          }}
                        >
                          <div
                            className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {t('inbox.baseVersion')}
                          </div>
                          <div
                            className="rounded-lg border p-3"
                            style={{
                              backgroundColor: 'var(--bg-surface)',
                              borderColor: 'var(--border-default)',
                            }}
                          >
                            <BlockContentView block={op.baseBlock} compact />
                          </div>
                        </div>
                      )}

                      <div className="p-4">
                        {state.diffMode === 'text' ? (
                          <TextDiffView
                            beforeText={blockToComparableText(op.headBlock)}
                            afterText={
                              op.row.opType === 'delete'
                                ? ''
                                : blockToComparableText(op.row.newBlockPayload)
                            }
                          />
                        ) : (
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="min-w-0 space-y-1.5">
                              <div
                                className="text-[11px] font-semibold uppercase tracking-wide"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {t('inbox.headVersion')}
                              </div>
                              {op.headBlock ? (
                                <div
                                  className="rounded-lg border p-3"
                                  style={{ borderColor: 'var(--border-default)' }}
                                >
                                  <BlockContentView block={op.headBlock} compact />
                                </div>
                              ) : (
                                <div
                                  className="rounded-lg border border-dashed p-4 text-xs"
                                  style={{
                                    borderColor: 'var(--border-default)',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  {t('inbox.newBlock')}
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 space-y-1.5">
                              <div
                                className="text-[11px] font-semibold uppercase tracking-wide"
                                style={{ color: 'var(--sem-ai-text)' }}
                              >
                                {t('inbox.aiProposal')}
                              </div>
                              {op.row.opType === 'delete' ? (
                                <div
                                  className="rounded-lg border p-4 text-xs font-medium"
                                  style={{
                                    backgroundColor: 'var(--sem-danger-bg)',
                                    borderColor: 'var(--sem-danger-border)',
                                    color: 'var(--sem-danger-text)',
                                  }}
                                >
                                  {t('inbox.willDelete')}
                                </div>
                              ) : op.row.newBlockPayload ? (
                                <div
                                  className="rounded-lg border p-3"
                                  style={{ borderColor: 'var(--sem-ai-border)' }}
                                >
                                  <BlockContentView block={op.row.newBlockPayload} compact />
                                </div>
                              ) : (
                                <div
                                  className="rounded-lg border p-4 text-xs"
                                  style={{
                                    borderColor: 'var(--border-default)',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  {t('inbox.blockMove')}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {state.decision === 'edited' && (
                          <div
                            className="mt-4 space-y-2 rounded-lg border p-3.5"
                            style={{
                              backgroundColor: 'var(--bg-subtle)',
                              borderColor: 'var(--sem-human-border)',
                            }}
                          >
                            <div
                              className="text-xs font-semibold"
                              style={{ color: 'var(--sem-human-text)' }}
                            >
                              {t('inbox.manualVersionTitle')}
                            </div>
                            <div className="grid gap-3 lg:grid-cols-2">
                              <textarea
                                value={state.editedText}
                                onChange={(e) =>
                                  updateDecision(op.row.id, { editedText: e.target.value })
                                }
                                rows={8}
                                aria-label={t('inbox.manualEditAria')}
                                className="w-full rounded-md border p-2.5 font-mono text-xs leading-relaxed"
                                style={{
                                  backgroundColor: 'var(--bg-surface)',
                                  borderColor: 'var(--border-default)',
                                  color: 'var(--text-primary)',
                                }}
                              />
                              <div className="min-w-0">
                                {editedPreview?.ok ? (
                                  <div
                                    className="rounded-lg border p-3"
                                    style={{
                                      backgroundColor: 'var(--bg-surface)',
                                      borderColor: 'var(--border-default)',
                                    }}
                                  >
                                    <BlockContentView block={editedPreview.payload} compact />
                                  </div>
                                ) : (
                                  <div
                                    role="alert"
                                    className="rounded-lg border p-3 text-xs"
                                    style={{
                                      backgroundColor: 'var(--sem-danger-bg)',
                                      borderColor: 'var(--sem-danger-border)',
                                      color: 'var(--sem-danger-text)',
                                    }}
                                  >
                                    {editedPreview?.error}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div
                        className="border-t px-4 py-2.5"
                        style={{
                          borderColor: 'var(--border-default)',
                          backgroundColor: 'var(--bg-subtle)',
                        }}
                      >
                        <input
                          type="text"
                          value={state.comment}
                          onChange={(e) =>
                            updateDecision(op.row.id, { comment: e.target.value })
                          }
                          aria-label={t('inbox.commentAria')}
                          placeholder={t('inbox.commentPlaceholder')}
                          className="w-full rounded-md border px-2.5 py-1.5 text-xs"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            borderColor: 'var(--border-default)',
                            color: 'var(--text-primary)',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
