'use client';

import { useMemo } from 'react';

interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText ? beforeText.replace(/\r\n/g, '\n').split('\n') : [];
  const b = afterText ? afterText.replace(/\r\n/g, '\n').split('\n') : [];

  // Fallback for very large specs to avoid quadratic blowup
  if (a.length * b.length > 60_000) {
    return [
      ...a.map((text): DiffLine => ({ kind: 'removed', text })),
      ...b.map((text): DiffLine => ({ kind: 'added', text })),
    ];
  }

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = (dp[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ kind: 'removed', text: a[i]! });
      i++;
    } else {
      out.push({ kind: 'added', text: b[j]! });
      j++;
    }
  }
  while (i < m) {
    out.push({ kind: 'removed', text: a[i]! });
    i++;
  }
  while (j < n) {
    out.push({ kind: 'added', text: b[j]! });
    j++;
  }

  return out;
}

export function TextDiffView({
  beforeText,
  afterText,
}: {
  beforeText: string;
  afterText: string;
}) {
  const lines = useMemo(
    () => computeLineDiff(beforeText, afterText),
    [beforeText, afterText],
  );

  return (
    <div
      className="max-h-96 overflow-auto rounded-lg border font-mono text-xs leading-relaxed"
      style={{
        borderColor: 'var(--border-default)',
        backgroundColor: 'var(--bg-subtle)',
      }}
    >
      {lines.length === 0 ? (
        <div className="p-3" style={{ color: 'var(--text-muted)' }}>
          Нет текстовых изменений.
        </div>
      ) : (
        lines.map((line, idx) => {
          const style =
            line.kind === 'added'
              ? {
                  backgroundColor: 'var(--sem-clean-bg)',
                  color: 'var(--sem-clean-text)',
                }
              : line.kind === 'removed'
                ? {
                    backgroundColor: 'var(--sem-danger-bg)',
                    color: 'var(--sem-danger-text)',
                  }
                : { color: 'var(--text-primary)' };

          const prefix = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
          return (
            <div
              key={idx}
              className="flex whitespace-pre-wrap break-words px-3 py-0.5"
              style={style}
            >
              <span className="mr-2 w-3 shrink-0 select-none opacity-75">{prefix}</span>
              <span className="min-w-0 flex-1">{line.text || ' '}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
