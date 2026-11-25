'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Lock, Unlock, ShieldAlert, Bot, UserCheck, Info, AlertTriangle } from 'lucide-react';
import type { DocumentBlock, ProposalBlockPayload } from '@docalaizer/core';
import { useI18n } from '../i18n-provider';
import { MermaidView } from '../visualizations/mermaid-view';
import { VegaChartView } from '../visualizations/vega-chart-view';

const markdownComponents: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

interface BlockContentViewProps {
  block: DocumentBlock | ProposalBlockPayload;
  compact?: boolean;
}

export function BlockContentView({ block, compact = false }: BlockContentViewProps) {
  switch (block.type) {
    case 'markdown':
      return (
        <div className="doc-prose max-w-[76ch]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSanitize]}
            components={markdownComponents}
          >
            {block.content}
          </ReactMarkdown>
        </div>
      );

    case 'diagram':
      return (
        <MermaidView
          source={block.content.source}
          title={block.title}
          caption={block.content.caption}
          compact={compact}
        />
      );

    case 'chart':
      return (
        <VegaChartView
          spec={block.content.spec}
          data={block.content.data}
          title={block.title}
          caption={block.content.caption}
          compact={compact}
        />
      );

    case 'table':
      return (
        <div
          className="overflow-x-auto rounded-lg border"
          style={{ borderColor: 'var(--border-default)' }}
        >
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)' }}>
                {block.content.columns.map((col, idx) => (
                  <th
                    key={idx}
                    className="border-b px-3 py-2 font-semibold"
                    style={{
                      borderColor: 'var(--border-default)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.content.rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-default)' }}
                >
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3 py-2"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'callout': {
      const variantStyles = {
        info: {
          bg: 'var(--sem-ai-bg)',
          border: 'var(--sem-ai-border)',
          text: 'var(--sem-ai-text)',
          Icon: Info,
        },
        warning: {
          bg: 'var(--sem-human-bg)',
          border: 'var(--sem-human-border)',
          text: 'var(--sem-human-text)',
          Icon: AlertTriangle,
        },
        danger: {
          bg: 'var(--sem-danger-bg)',
          border: 'var(--sem-danger-border)',
          text: 'var(--sem-danger-text)',
          Icon: ShieldAlert,
        },
        decision: {
          bg: 'var(--sem-clean-bg)',
          border: 'var(--sem-clean-border)',
          text: 'var(--sem-clean-text)',
          Icon: UserCheck,
        },
      }[block.content.variant];

      const Icon = variantStyles.Icon;
      return (
        <div
          className="flex gap-3 rounded-lg border p-3.5 text-sm"
          style={{
            backgroundColor: variantStyles.bg,
            borderColor: variantStyles.border,
          }}
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: variantStyles.text }} />
          <div className="doc-prose min-w-0 flex-1">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
              components={markdownComponents}
            >
              {block.content.markdown}
            </ReactMarkdown>
          </div>
        </div>
      );
    }
  }
}

interface DocumentBlockCardProps {
  block: DocumentBlock;
  canEdit: boolean;
  onToggleLock?: (block: DocumentBlock) => void;
  onReleaseToAi?: (block: DocumentBlock) => void;
}

export function DocumentBlockCard({
  block,
  canEdit,
  onToggleLock,
  onReleaseToAi,
}: DocumentBlockCardProps) {
  const { t } = useI18n();
  const isLocked = block.meta.lockedByHuman;
  const isHuman = block.meta.humanTouched;

  const leftBarColor = isLocked
    ? 'var(--sem-danger-border)'
    : isHuman
      ? 'var(--sem-human-border)'
      : 'transparent';

  return (
    <article
      className="group relative rounded-md py-2 pl-4 pr-2 transition-colors"
      style={{
        borderLeft: `2px solid ${leftBarColor}`,
      }}
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px]">
          {isLocked ? (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
              style={{
                backgroundColor: 'var(--sem-danger-bg)',
                color: 'var(--sem-danger-text)',
                border: '1px solid var(--sem-danger-border)',
              }}
            >
              <Lock className="h-3 w-3" />
              {t('block.locked')}
            </span>
          ) : isHuman ? (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium"
              style={{
                backgroundColor: 'var(--sem-human-bg)',
                color: 'var(--sem-human-text)',
                border: '1px solid var(--sem-human-border)',
              }}
            >
              <UserCheck className="h-3 w-3" />
              {t('block.humanTouched')}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium opacity-75"
              style={{
                backgroundColor: 'var(--sem-ai-bg)',
                color: 'var(--sem-ai-text)',
                border: '1px solid var(--sem-ai-border)',
              }}
            >
              <Bot className="h-3 w-3" />
              {t('block.aiBlock')}
            </span>
          )}
          <span
            className="hidden font-mono text-[11px] sm:inline sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            style={{ color: 'var(--text-muted)' }}
          >
            {block.id}
          </span>
        </div>

        {canEdit && (
          <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {onToggleLock && (
              <button
                type="button"
                onClick={() => onToggleLock(block)}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                }}
                title={isLocked ? t('block.unlockTitle') : t('block.lockTitle')}
              >
                {isLocked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {isLocked ? t('block.unlock') : t('block.lock')}
              </button>
            )}
            {isHuman && !isLocked && onReleaseToAi && (
              <button
                type="button"
                onClick={() => onReleaseToAi(block)}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                }}
                title={t('block.releaseToAiTitle')}
              >
                <Bot className="h-3 w-3" />
                {t('block.releaseToAi')}
              </button>
            )}
          </div>
        )}
      </div>

      <BlockContentView block={block} />
    </article>
  );
}
