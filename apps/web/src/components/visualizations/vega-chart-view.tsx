'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, Code2 } from 'lucide-react';
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
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);

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
          {title ? `${title} · Vega-Lite` : 'Vega-Lite Chart'}
        </span>
        <button
          type="button"
          onClick={() => setShowSpec((v) => !v)}
          className="btn-secondary inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
        >
          {showSpec ? <BarChart3 className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
          {showSpec ? 'График' : 'Спека'}
        </button>
      </div>

      {showSpec ? (
        <pre
          className="max-h-80 overflow-auto p-3 text-xs leading-relaxed font-mono"
          style={{ color: 'var(--text-primary)' }}
        >
          <code>{serializedSpec}</code>
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
            <div className="font-semibold">Ошибка рендера Vega-Lite</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
              {error}
            </pre>
          </div>
        </div>
      ) : (
        <div className={`w-full overflow-x-auto ${compact ? 'p-3' : 'p-4'}`}>
          <div ref={containerRef} className="w-full" />
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
