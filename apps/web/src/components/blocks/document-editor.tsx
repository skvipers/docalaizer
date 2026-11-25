'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, X, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import type { DocumentBlock, ProposalBlockPayload } from '@docalaizer/core';
import { useI18n } from '../i18n-provider';
import { MermaidView } from '../visualizations/mermaid-view';
import { VegaChartView } from '../visualizations/vega-chart-view';
import { IconButton } from '../ui/icon-button';
import { IconPicker } from '../ui/icon-picker';
import {
  DocumentIcon,
  getEntityIconLabel,
  normalizeDocumentIcon,
  type EntityIconKey,
} from '../ui/entity-icon';

interface DocumentEditorProps {
  initialTitle: string;
  initialIcon: string | null;
  initialBlocks: DocumentBlock[];
  saving: boolean;
  error: string | null;
  isConflictError?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
  onReloadDoc?: () => void;
  onSave: (
    title: string,
    icon: EntityIconKey,
    blocks: ProposalBlockPayload[],
    summary: string,
  ) => Promise<void>;
  onCancel: () => void;
}

interface DraftBlock {
  key: string;
  id?: string;
  type: DocumentBlock['type'];
  title: string;
  markdownText: string;
  mermaidSource: string;
  vegaJson: string;
  caption: string;
  calloutVariant: 'info' | 'warning' | 'danger' | 'decision';
}

function toDraftBlock(block: DocumentBlock, idx: number): DraftBlock {
  const base: DraftBlock = {
    key: block.id || `draft_${idx}`,
    id: block.id,
    type: block.type,
    title: block.title ?? '',
    markdownText: '',
    mermaidSource: '',
    vegaJson: '',
    caption: '',
    calloutVariant: 'info',
  };

  if (block.type === 'markdown') {
    base.markdownText = block.content;
  } else if (block.type === 'diagram') {
    base.mermaidSource = block.content.source;
    base.caption = block.content.caption ?? '';
  } else if (block.type === 'chart') {
    const merged =
      block.content.data !== undefined && block.content.spec.data === undefined
        ? { ...block.content.spec, data: { values: block.content.data } }
        : block.content.spec;
    base.vegaJson = JSON.stringify(merged, null, 2);
    base.caption = block.content.caption ?? '';
  } else if (block.type === 'callout') {
    base.calloutVariant = block.content.variant;
    base.markdownText = block.content.markdown;
  } else if (block.type === 'table') {
    const header = `| ${block.content.columns.join(' | ')} |`;
    const sep = `| ${block.content.columns.map(() => '---').join(' | ')} |`;
    const rows = block.content.rows.map((r) => `| ${r.join(' | ')} |`);
    base.markdownText = [header, sep, ...rows].join('\n');
  }
  return base;
}

export function DocumentEditor({
  initialTitle,
  initialIcon,
  initialBlocks,
  saving,
  error,
  isConflictError = false,
  onDirtyChange,
  onReloadDoc,
  onSave,
  onCancel,
}: DocumentEditorProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState<EntityIconKey>(() => normalizeDocumentIcon(initialIcon));
  const [summary, setSummary] = useState('');
  const [drafts, setDrafts] = useState<DraftBlock[]>(() =>
    initialBlocks.map((b, i) => toDraftBlock(b, i)),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const updateDraft = (idx: number, patch: Partial<DraftBlock>) => {
    setIsDirty(true);
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const handleCancelClick = () => {
    if (isDirty && !window.confirm(t('editor.confirmCancel'))) {
      return;
    }
    onCancel();
  };

  const addBlock = (type: DraftBlock['type']) => {
    setIsDirty(true);
    const key = `new_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const next: DraftBlock = {
      key,
      type,
      title:
        type === 'diagram'
          ? t('editor.newDiagramTitle')
          : type === 'chart'
            ? t('editor.newChartTitle')
            : '',
      markdownText:
        type === 'markdown'
          ? t('editor.newSectionTemplate')
          : type === 'table'
            ? t('editor.newTableTemplate')
            : t('editor.newCalloutTemplate'),
      mermaidSource: 'flowchart LR\n  Client --> API --> DB[(PostgreSQL)]',
      vegaJson: JSON.stringify(
        {
          $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
          mark: { type: 'bar' },
          data: {
            values: [
              { label: 'A', value: 28 },
              { label: 'B', value: 55 },
              { label: 'C', value: 43 },
            ],
          },
          encoding: {
            x: { field: 'label', type: 'ordinal' },
            y: { field: 'value', type: 'quantitative' },
          },
        },
        null,
        2,
      ),
      caption: '',
      calloutVariant: 'info',
    };
    setDrafts((prev) => [...prev, next]);
  };

  const moveBlock = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= drafts.length) return;
    setIsDirty(true);
    setDrafts((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      if (item) copy.splice(target, 0, item);
      return copy;
    });
  };

  const removeBlock = (idx: number) => {
    setIsDirty(true);
    setDrafts((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    setLocalError(null);
    const payloads: ProposalBlockPayload[] = [];

    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i]!;
      const baseFields = {
        ...(d.id ? { id: d.id } : {}),
        ...(d.title.trim() ? { title: d.title.trim() } : {}),
      };

      if (d.type === 'markdown') {
        payloads.push({ ...baseFields, type: 'markdown', content: d.markdownText });
      } else if (d.type === 'diagram') {
        payloads.push({
          ...baseFields,
          type: 'diagram',
          content: {
            engine: 'mermaid',
            source: d.mermaidSource,
            ...(d.caption.trim() ? { caption: d.caption.trim() } : {}),
          },
        });
      } else if (d.type === 'chart') {
        try {
          const parsed = JSON.parse(d.vegaJson) as Record<string, unknown>;
          payloads.push({
            ...baseFields,
            type: 'chart',
            content: {
              engine: 'vega-lite',
              spec: parsed,
              ...(d.caption.trim() ? { caption: d.caption.trim() } : {}),
            },
          });
        } catch {
          setLocalError(t('editor.invalidVegaJson', { n: i + 1 }));
          return;
        }
      } else if (d.type === 'callout') {
        payloads.push({
          ...baseFields,
          type: 'callout',
          content: { variant: d.calloutVariant, markdown: d.markdownText },
        });
      } else if (d.type === 'table') {
        const lines = d.markdownText
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
        payloads.push({ ...baseFields, type: 'table', content: { columns, rows } });
      }
    }

    await onSave(title.trim() || initialTitle, icon, payloads, summary.trim() || t('editor.defaultSummary'));
  };

  return (
    <div className="space-y-4">
      <div
        className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
        }}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setIsDirty(true);
            setTitle(e.target.value);
          }}
          placeholder={t('editor.pageTitlePlaceholder')}
          aria-label={t('editor.pageTitleAria')}
          className="min-w-[200px] flex-1 bg-transparent text-lg font-semibold focus:outline-none"
          style={{ color: 'var(--text-primary)' }}
        />
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={summary}
            onChange={(e) => {
              setIsDirty(true);
              setSummary(e.target.value);
            }}
            placeholder={t('editor.summaryPlaceholder')}
            aria-label={t('editor.summaryAria')}
            className="hidden w-52 rounded-md border px-2.5 py-1 text-xs sm:block"
            style={{
              backgroundColor: 'var(--bg-subtle)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            onClick={handleCancelClick}
            disabled={saving}
            className="btn-secondary inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium"
          >
            <X className="h-3.5 w-3.5" />
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="btn-primary inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>

      <details
        className="rounded-lg border"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-xs font-medium">
          <DocumentIcon icon={icon} className="h-4 w-4" />
          <span>{t('editor.pageIcon')}</span>
          <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>
            {getEntityIconLabel(icon)}
          </span>
        </summary>
        <div className="border-t p-3.5" style={{ borderColor: 'var(--border-default)' }}>
          <IconPicker
            label={t('editor.choosePageIcon')}
            value={icon}
            disabled={saving}
            onChange={(value) => {
              setIsDirty(true);
              setIcon(value);
            }}
          />
        </div>
      </details>

      {(localError || error) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-xs"
          style={{
            backgroundColor: 'var(--sem-danger-bg)',
            borderColor: 'var(--sem-danger-border)',
            color: 'var(--sem-danger-text)',
          }}
        >
          <span>{localError ?? error}</span>
          {isConflictError && onReloadDoc && (
            <button
              type="button"
              onClick={onReloadDoc}
              className="btn-secondary inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('editor.reloadLatest')}
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {drafts.map((d, idx) => (
          <div
            key={d.key}
            className="rounded-lg border p-3.5"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="rounded px-1.5 py-0.5 font-mono text-[11px] uppercase"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {d.type}
                </span>
                {d.id && (
                  <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {d.id}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  onClick={() => moveBlock(idx, -1)}
                  disabled={idx === 0}
                  label={t('editor.moveUp')}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  onClick={() => moveBlock(idx, 1)}
                  disabled={idx === drafts.length - 1}
                  label={t('editor.moveDown')}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ArrowDown className="h-4 w-4" strokeWidth={1.75} />
                </IconButton>
                <IconButton
                  onClick={() => removeBlock(idx)}
                  label={t('editor.deleteBlock')}
                  style={{ color: 'var(--sem-danger-text)' }}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </IconButton>
              </div>
            </div>

            {(d.type === 'diagram' || d.type === 'chart') && (
              <input
                type="text"
                value={d.title}
                onChange={(e) => updateDraft(idx, { title: e.target.value })}
                placeholder={t('editor.blockTitlePlaceholder')}
                aria-label={t('editor.blockTitleAria', { n: idx + 1 })}
                className="mb-2 w-full rounded-md border px-2.5 py-1.5 text-xs"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              />
            )}

            {d.type === 'markdown' || d.type === 'table' || d.type === 'callout' ? (
              <div className="space-y-2">
                {d.type === 'callout' && (
                  <select
                    aria-label={t('editor.calloutVariantAria', { n: idx + 1 })}
                    value={d.calloutVariant}
                    onChange={(e) =>
                      updateDraft(idx, {
                        calloutVariant: e.target.value as DraftBlock['calloutVariant'],
                      })
                    }
                    className="rounded border px-2 py-1 text-xs"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      borderColor: 'var(--border-default)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <option value="info">Info</option>
                    <option value="decision">ADR Decision</option>
                    <option value="warning">Warning</option>
                    <option value="danger">Danger</option>
                  </select>
                )}
                <textarea
                  aria-label={t('editor.blockContentAria', { n: idx + 1 })}
                  value={d.markdownText}
                  onChange={(e) => updateDraft(idx, { markdownText: e.target.value })}
                  rows={Math.max(4, Math.min(14, d.markdownText.split('\n').length + 1))}
                  className="w-full rounded-md border p-2.5 font-mono text-xs leading-relaxed"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            ) : d.type === 'diagram' ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <textarea
                  aria-label={t('editor.blockContentAria', { n: idx + 1 })}
                  value={d.mermaidSource}
                  onChange={(e) => updateDraft(idx, { mermaidSource: e.target.value })}
                  rows={8}
                  className="w-full rounded-md border p-2.5 font-mono text-xs leading-relaxed"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                />
                <MermaidView source={d.mermaidSource} title={d.title || undefined} compact />
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                <textarea
                  aria-label={t('editor.blockContentAria', { n: idx + 1 })}
                  value={d.vegaJson}
                  onChange={(e) => updateDraft(idx, { vegaJson: e.target.value })}
                  rows={10}
                  className="w-full rounded-md border p-2.5 font-mono text-xs leading-relaxed"
                  style={{
                    backgroundColor: 'var(--bg-subtle)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                />
                <ChartLivePreview rawJson={d.vegaJson} title={d.title || undefined} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {t('editor.addBlockLabel')}
        </span>
        {(
          [
            ['markdown', t('editor.blockType.markdown')],
            ['table', t('editor.blockType.table')],
            ['diagram', t('editor.blockType.diagram')],
            ['chart', t('editor.blockType.chart')],
            ['callout', t('editor.blockType.callout')],
          ] as const
        ).map(([type, label]) => (
          <button
            key={type}
            type="button"
            onClick={() => addBlock(type)}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChartLivePreview({ rawJson, title }: { rawJson: string; title?: string }) {
  const { t } = useI18n();
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return <VegaChartView spec={parsed} title={title} compact />;
  } catch {
    return (
      <div
        className="flex items-center justify-center rounded-lg border p-4 text-xs"
        style={{
          borderColor: 'var(--sem-danger-border)',
          backgroundColor: 'var(--sem-danger-bg)',
          color: 'var(--sem-danger-text)',
        }}
      >
        {t('editor.invalidJsonPreview')}
      </div>
    );
  }
}
