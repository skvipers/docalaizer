'use client';

import { memo, useEffect, useId, useState } from 'react';
import { AlertTriangle, Code2, Eye, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '../i18n-provider';
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
  const { t } = useI18n();
  const { theme } = useTheme();
  const uniqueId = useId().replace(/:/g, '_');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

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
          {title ? `${title} · Mermaid` : t('viz.mermaidDefault')}
        </span>
        <div className="flex items-center gap-1.5">
          {svg && !showCode && (
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setFullscreen(true);
              }}
              aria-label={t('viz.expandDiagram')}
              className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {t('viz.fullscreen')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
          >
            {showCode ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
            {showCode ? t('viz.diagram') : t('viz.code')}
          </button>
        </div>
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
            <div className="font-semibold">{t('viz.mermaidError')}</div>
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
          {t('viz.renderingDiagram')}
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

      {fullscreen && svg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title ? `${title} — ${t('viz.viewDiagramAria')}` : t('viz.viewDiagramAria')}
          className="fixed inset-0 z-50 flex flex-col p-4 sm:p-6"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.72)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setFullscreen(false);
          }}
        >
          <div
            className="flex h-full flex-col overflow-hidden rounded-xl border"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-xs"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                borderColor: 'var(--border-default)',
              }}
            >
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {title ? `${title} · Mermaid` : t('viz.mermaidDefault')}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  aria-label={t('viz.zoomOut')}
                  className="btn-secondary inline-flex items-center rounded p-1.5"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[44px] text-center font-mono text-[11px]">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  aria-label={t('viz.zoomIn')}
                  className="btn-secondary inline-flex items-center rounded p-1.5"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  aria-label={t('viz.resetZoom')}
                  className="btn-secondary inline-flex items-center rounded p-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreen(false)}
                  aria-label={t('viz.closeFullscreen')}
                  className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('common.close')}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <div
                className="mx-auto flex w-fit origin-top justify-center transition-transform"
                style={{ transform: `scale(${zoom})` }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
