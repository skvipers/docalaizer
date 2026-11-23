'use client';

import { memo, useEffect, useId, useState } from 'react';
import { AlertTriangle, Code2, Eye } from 'lucide-react';
import { useTheme } from '../theme-provider';

interface MermaidViewProps {
  source: string;
  title?: string;
  caption?: string;
  compact?: boolean;
}

export const MermaidView = memo(function MermaidView({
  source,
  title,
  caption,
  compact = false,
}: MermaidViewProps) {
  const { theme } = useTheme();
  const uniqueId = useId().replace(/:/g, '_');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const renderId = `mmd_${uniqueId}_${Date.now()}`;

    async function renderDiagram() {
      try {
        const mermaidMod = await import('mermaid');
        const mermaid = mermaidMod.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'neutral',
          fontFamily: 'inherit',
        });

        const { svg: renderedSvg } = await mermaid.render(renderId, source);
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        // Mermaid sometimes leaves an orphan error node in document.body on failure
        document.getElementById(`d${renderId}`)?.remove();
        document.getElementById(renderId)?.remove();
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram');
        }
      }
    }

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [source, theme, uniqueId]);

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        borderColor: 'var(--border-default)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2 text-xs"
        style={{
          borderColor: 'var(--border-default)',
          backgroundColor: 'var(--bg-subtle)',
          color: 'var(--text-secondary)',
        }}
      >
        <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>
          {title ? `${title} · Mermaid` : 'Mermaid Diagram'}
        </span>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
        >
          {showCode ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
          {showCode ? 'Диаграмма' : 'Код'}
        </button>
      </div>

      {showCode ? (
        <pre
          className="overflow-x-auto p-3 text-xs leading-relaxed font-mono"
          style={{ color: 'var(--text-primary)' }}
        >
          <code>{source}</code>
        </pre>
      ) : error ? (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 text-xs"
          style={{
            backgroundColor: 'var(--sem-danger-bg)',
            color: 'var(--sem-danger-text)',
          }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <div className="font-semibold">Ошибка рендера Mermaid</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
              {error}
            </pre>
          </div>
        </div>
      ) : svg ? (
        <div
          className={`flex justify-center overflow-x-auto ${compact ? 'p-3' : 'p-5'}`}
          // Mermaid runs with securityLevel: 'strict' (DOMPurify-sanitized SVG output)
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="p-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Рендеринг диаграммы…
        </div>
      )}

      {caption && (
        <div
          className="border-t px-3 py-1.5 text-xs"
          style={{
            borderColor: 'var(--border-default)',
            color: 'var(--text-secondary)',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
});
