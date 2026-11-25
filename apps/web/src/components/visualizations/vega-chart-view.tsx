'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, Code2, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '../i18n-provider';
import { useTheme } from '../theme-provider';

const DOCALAIZER_CHART_PALETTE = [
  '#0F766E',
  '#2563EB',
  '#D97706',
  '#DC2626',
  '#7C3AED',
  '#0891B2',
];

interface VegaChartViewProps {
  spec: Record<string, unknown>;
  data?: Record<string, unknown>[];
  title?: string;
  caption?: string;
  compact?: boolean;
}

export const VegaChartView = memo(function VegaChartView({
  spec,
  data,
  title,
  caption,
  compact = false,
}: VegaChartViewProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);
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

  // Stabilize spec identity so typing in unrelated sibling blocks never triggers chart re-renders
  const serializedSpec = useMemo(() => {
    const merged =
      data !== undefined && spec.data === undefined
        ? { ...spec, data: { values: data } }
        : spec;
    return JSON.stringify(merged, null, 2);
  }, [spec, data]);

  useEffect(() => {
    if (showSpec) return;
    let cancelled = false;
    let finalize: (() => void) | undefined;

    async function renderChart() {
      const el = containerRef.current;
      if (!el) return;

      setError(null);
      el.replaceChildren();
      try {
        const parsed = JSON.parse(serializedSpec) as Record<string, unknown>;
        const vegaEmbedMod = await import('vega-embed');
        const embed = vegaEmbedMod.default;
        const isDark = theme === 'dark';

        const themedSpec = {
          $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
          width: 'container',
          height: compact ? 200 : 280,
          background: 'transparent',
          ...parsed,
          config: {
            ...(typeof parsed.config === 'object' && parsed.config !== null
              ? (parsed.config as Record<string, unknown>)
              : {}),
            range: { category: DOCALAIZER_CHART_PALETTE },
            axis: {
              labelColor: isDark ? '#A8A69E' : '#54504A',
              titleColor: isDark ? '#F2F1EE' : '#1C1B19',
              gridColor: isDark ? '#2A2D34' : '#E5E1D8',
              domainColor: isDark ? '#3A3F4A' : '#CFC9BC',
              tickColor: isDark ? '#3A3F4A' : '#CFC9BC',
            },
            legend: {
              labelColor: isDark ? '#A8A69E' : '#54504A',
              titleColor: isDark ? '#F2F1EE' : '#1C1B19',
            },
            title: { color: isDark ? '#F2F1EE' : '#1C1B19' },
            view: { stroke: 'transparent' },
          },
        };

        const result = await embed(el, themedSpec as never, {
          actions: false,
          renderer: 'svg',
        });
        if (cancelled) {
          result.finalize();
          return;
        }
        finalize = () => result.finalize();
        setError(null);
      } catch (err) {
        if (!cancelled) {
          el.replaceChildren();
          setError(err instanceof Error ? err.message : 'Failed to render Vega-Lite chart');
        }
      }
    }

    void renderChart();
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [serializedSpec, theme, showSpec, compact]);

  useEffect(() => {
    if (!fullscreen) return;
    let cancelled = false;
    let finalize: (() => void) | undefined;

    async function renderFullscreenChart() {
      const el = modalContainerRef.current;
      if (!el) return;
      el.replaceChildren();
      try {
        const parsed = JSON.parse(serializedSpec) as Record<string, unknown>;
        const vegaEmbedMod = await import('vega-embed');
        const embed = vegaEmbedMod.default;
        const isDark = theme === 'dark';
        const themedSpec = {
          $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
          width: 'container',
          height: 480,
          background: 'transparent',
          ...parsed,
          config: {
            ...(typeof parsed.config === 'object' && parsed.config !== null
              ? (parsed.config as Record<string, unknown>)
              : {}),
            range: { category: DOCALAIZER_CHART_PALETTE },
            axis: {
              labelColor: isDark ? '#A8A69E' : '#54504A',
              titleColor: isDark ? '#F2F1EE' : '#1C1B19',
              gridColor: isDark ? '#2A2D34' : '#E5E1D8',
              domainColor: isDark ? '#3A3F4A' : '#CFC9BC',
              tickColor: isDark ? '#3A3F4A' : '#CFC9BC',
            },
            legend: {
              labelColor: isDark ? '#A8A69E' : '#54504A',
              titleColor: isDark ? '#F2F1EE' : '#1C1B19',
            },
            title: { color: isDark ? '#F2F1EE' : '#1C1B19' },
            view: { stroke: 'transparent' },
          },
        };
        const result = await embed(el, themedSpec as never, {
          actions: false,
          renderer: 'svg',
        });
        if (cancelled) {
          result.finalize();
          return;
        }
        finalize = () => result.finalize();
      } catch {
        // Error already displayed in main view
      }
    }

    void renderFullscreenChart();
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [fullscreen, serializedSpec, theme]);

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
          {title ? `${title} · Vega-Lite` : t('viz.vegaDefault')}
        </span>
        <div className="flex items-center gap-1.5">
          {!showSpec && !error && (
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setFullscreen(true);
              }}
              aria-label={t('viz.expandChart')}
              className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {t('viz.fullscreen')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSpec((v) => !v)}
            className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
          >
            {showSpec ? <BarChart3 className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
            {showSpec ? t('viz.chart') : t('viz.code')}
          </button>
        </div>
      </div>

      {showSpec ? (
        <pre
          className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed"
          style={{ color: 'var(--text-primary)' }}
        >
          <code>{serializedSpec}</code>
        </pre>
      ) : (
        <>
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 border-b p-3 text-xs"
              style={{
                backgroundColor: 'var(--sem-danger-bg)',
                borderColor: 'var(--sem-danger-border)',
                color: 'var(--sem-danger-text)',
              }}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">{t('viz.vegaError')}</div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
                  {error}
                </pre>
              </div>
            </div>
          )}
          <div className={`w-full overflow-x-auto ${compact ? 'p-3' : 'p-4'}`}>
            <div ref={containerRef} className="w-full" />
          </div>
        </>
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

      {fullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title ? `${title} — ${t('viz.viewChartAria')}` : t('viz.viewChartAria')}
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
                {title ? `${title} · Vega-Lite` : t('viz.vegaDefault')}
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
                className="w-full origin-top-left transition-transform"
                style={{ transform: `scale(${zoom})` }}
              >
                <div ref={modalContainerRef} className="w-full" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
