import { describe, expect, it } from 'vitest';
import { documentBlockSchema, isBlockProtectedFromAi } from './blocks';

describe('documentBlockSchema', () => {
  it('validates a markdown block and respects humanTouched protection invariant', () => {
    const parsed = documentBlockSchema.parse({
      id: 'blk_01JDX9A2K8',
      type: 'markdown',
      content: '## Архитектура\nТекст раздела.',
      contentHash: 'sha256:abc123',
      meta: {
        origin: 'ai',
        lastEditedByType: 'human',
        lastEditorId: 'usr_1',
        lastEditedAt: '2026-11-23T00:00:00.000Z',
        humanTouched: true,
        lockedByHuman: false,
      },
    });

    expect(parsed.type).toBe('markdown');
    expect(isBlockProtectedFromAi(parsed)).toBe(true);
  });

  it('validates diagram (mermaid) and chart (vega-lite) blocks', () => {
    const diagram = documentBlockSchema.parse({
      id: 'blk_diag_1',
      type: 'diagram',
      title: 'System Flow',
      content: { engine: 'mermaid', source: 'flowchart LR\nA --> B' },
      contentHash: 'sha256:diag',
      meta: {
        origin: 'ai',
        lastEditedByType: 'ai',
        lastEditorId: 'agt_1',
        lastEditedAt: '2026-11-23T00:00:00.000Z',
        humanTouched: false,
        lockedByHuman: false,
      },
    });

    const chart = documentBlockSchema.parse({
      id: 'blk_chart_1',
      type: 'chart',
      title: 'Latency p95',
      content: {
        engine: 'vega-lite',
        spec: { mark: 'line', encoding: {} },
        data: [{ day: 'Mon', ms: 120 }],
      },
      contentHash: 'sha256:chart',
      meta: {
        origin: 'ai',
        lastEditedByType: 'ai',
        lastEditorId: 'agt_1',
        lastEditedAt: '2026-11-23T00:00:00.000Z',
        humanTouched: false,
        lockedByHuman: true,
      },
    });

    expect(isBlockProtectedFromAi(diagram)).toBe(false);
    expect(isBlockProtectedFromAi(chart)).toBe(true);
  });
});
