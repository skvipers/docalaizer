import { describe, expect, it } from 'vitest';
import { createDocumentBlock } from './blocks';
import { canonicalizeJson, computeBlockContentHash, extractPlainTextForSearch } from './hash';
import {
  diffMarkdownToProposalOps,
  parseAnnotatedMarkdown,
  serializeBlocksToAnnotatedMarkdown,
} from './markdown';

const NOW = '2026-11-23T00:00:00.000Z';

describe('hash helpers', () => {
  it('produces identical hashes regardless of JSON key order or CRLF line endings', () => {
    const h1 = computeBlockContentHash('chart', {
      engine: 'vega-lite',
      spec: { b: 2, a: 1 },
    });
    const h2 = computeBlockContentHash('chart', {
      spec: { a: 1, b: 2 },
      engine: 'vega-lite',
    });
    expect(h1).toBe(h2);
    expect(canonicalizeJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');

    const md1 = computeBlockContentHash('markdown', 'Line 1\r\nLine 2');
    const md2 = computeBlockContentHash('markdown', 'Line 1\nLine 2');
    expect(md1).toBe(md2);
  });

  it('extracts plain text across all block types for PostgreSQL tsvector', () => {
    const blocks = [
      createDocumentBlock({
        payload: { id: 'b1', type: 'markdown', content: '## Auth\nShort-lived sessions' },
        authorType: 'human',
        authorId: 'u1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: {
          id: 'b2',
          type: 'diagram',
          title: 'Flow',
          content: { engine: 'mermaid', source: 'flowchart LR\nA --> B', caption: 'Architecture' },
        },
        authorType: 'ai',
        authorId: 'a1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: {
          id: 'b3',
          type: 'table',
          content: { columns: ['Service', 'SLA'], rows: [['API', '99.9%']] },
        },
        authorType: 'ai',
        authorId: 'a1',
        now: NOW,
      }),
    ];

    const text = extractPlainTextForSearch(blocks);
    expect(text).toContain('Short-lived sessions');
    expect(text).toContain('Architecture');
    expect(text).toContain('99.9%');
  });
});

describe('annotated_markdown parser and serializer', () => {
  it('round-trips all 5 block types with markers and attributes intact', () => {
    const blocks = [
      createDocumentBlock({
        payload: { id: 'blk_1', type: 'markdown', content: '## Intro\nHello world' },
        authorType: 'human',
        authorId: 'u1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: {
          id: 'blk_2',
          type: 'diagram',
          title: 'System Diagram',
          content: {
            engine: 'mermaid',
            source: 'flowchart LR\n  API --> DB',
            caption: 'Core flow',
          },
        },
        authorType: 'ai',
        authorId: 'a1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: {
          id: 'blk_3',
          type: 'chart',
          title: 'RPS',
          content: {
            engine: 'vega-lite',
            spec: {
              mark: 'bar',
              data: { values: [{ t: '10:00', rps: 120 }] },
              encoding: { x: { field: 't' }, y: { field: 'rps' } },
            },
          },
        },
        authorType: 'ai',
        authorId: 'a1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: {
          id: 'blk_4',
          type: 'table',
          content: { columns: ['Role', 'Access'], rows: [['owner', 'full']] },
        },
        authorType: 'human',
        authorId: 'u1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: {
          id: 'blk_5',
          type: 'callout',
          content: { variant: 'decision', markdown: 'Use PostgreSQL as source of truth.' },
        },
        authorType: 'human',
        authorId: 'u1',
        now: NOW,
      }),
    ];

    const serialized = serializeBlocksToAnnotatedMarkdown(blocks);
    expect(serialized).toContain('owner="human"');
    expect(serialized).toContain('owner="ai"');

    const parsed = parseAnnotatedMarkdown(serialized);
    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toMatchObject({ id: 'blk_1', type: 'markdown', content: '## Intro\nHello world' });
    expect(parsed[1]).toMatchObject({
      id: 'blk_2',
      type: 'diagram',
      title: 'System Diagram',
      content: { engine: 'mermaid', source: 'flowchart LR\n  API --> DB', caption: 'Core flow' },
    });
    expect(parsed[2]).toMatchObject({ id: 'blk_3', type: 'chart', title: 'RPS' });
    expect(parsed[3]).toMatchObject({
      id: 'blk_4',
      type: 'table',
      content: { columns: ['Role', 'Access'], rows: [['owner', 'full']] },
    });
    expect(parsed[4]).toMatchObject({
      id: 'blk_5',
      type: 'callout',
      content: { variant: 'decision', markdown: 'Use PostgreSQL as source of truth.' },
    });
  });

  it('parses plain Markdown without annotations into sections, mermaid diagrams, and vega-lite charts', () => {
    const raw = [
      '## Overview',
      'Some text.',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '## Metrics',
      '```vega-lite',
      '{"mark":"bar","data":{"values":[{"a":1}]}}',
      '```',
    ].join('\n');

    const parsed = parseAnnotatedMarkdown(raw);
    expect(parsed.map((b) => b.type)).toEqual(['markdown', 'diagram', 'markdown', 'chart']);
  });
});

describe('diffMarkdownToProposalOps', () => {
  it('avoids false deletions when AI omits markers on unchanged blocks and detects real deletions', () => {
    const baseBlocks = [
      createDocumentBlock({
        payload: { id: 'blk_a', type: 'markdown', content: '## Section A\nHuman notes.' },
        authorType: 'human',
        authorId: 'u1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: { id: 'blk_b', type: 'markdown', content: '## Section B\nTo be updated.' },
        authorType: 'ai',
        authorId: 'a1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: { id: 'blk_c', type: 'markdown', content: '## Section C\nImportant human block.' },
        authorType: 'human',
        authorId: 'u1',
        now: NOW,
      }),
    ];

    // AI omits markers on Section A (unchanged), edits Section B (matched by heading),
    // drops Section C (truncation!), and appends a new Mermaid diagram.
    const aiMarkdown = [
      '## Section A',
      'Human notes.',
      '',
      '## Section B',
      'Updated by AI with fresher details.',
      '',
      '```mermaid',
      'flowchart LR',
      '  X --> Y',
      '```',
    ].join('\n');

    const ops = diffMarkdownToProposalOps(baseBlocks, aiMarkdown);

    // Section A must NOT appear in deletes or updates
    expect(ops.some((op) => 'targetBlockId' in op && op.targetBlockId === 'blk_a')).toBe(false);

    // Section C was dropped -> explicit delete op so 3-way merge flags risky_delete
    expect(ops).toContainEqual({
      opType: 'delete',
      targetBlockId: 'blk_c',
      expectedHash: baseBlocks[2]!.contentHash,
    });

    // Section B matched by heading -> update op
    const updateB = ops.find((op) => op.opType === 'update' && op.targetBlockId === 'blk_b');
    expect(updateB).toBeDefined();

    // New diagram inserted after blk_b
    const insertDiagram = ops.find((op) => op.opType === 'insert');
    expect(insertDiagram).toBeDefined();
    if (insertDiagram && insertDiagram.opType === 'insert') {
      expect(insertDiagram.afterBlockId).toBe('blk_b');
      expect(insertDiagram.newBlockPayload.type).toBe('diagram');
    }
  });

  it('detects block reordering and generates move operations', () => {
    const baseBlocks = [
      createDocumentBlock({
        payload: { id: 'blk_1', type: 'markdown', content: 'First' },
        authorType: 'ai',
        authorId: 'a1',
        now: NOW,
      }),
      createDocumentBlock({
        payload: { id: 'blk_2', type: 'markdown', content: 'Second' },
        authorType: 'ai',
        authorId: 'a1',
        now: NOW,
      }),
    ];

    const reordered = serializeBlocksToAnnotatedMarkdown([baseBlocks[1]!, baseBlocks[0]!]);
    const ops = diffMarkdownToProposalOps(baseBlocks, reordered);

    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      opType: 'move',
      targetBlockId: 'blk_2',
      afterBlockId: null,
    });
  });
});


describe('chart data round-trip', () => {
  it('preserves chart.data separately from the Vega-Lite spec', () => {
    const block = createDocumentBlock({
      payload: {
        id: 'blk_chart_data',
        type: 'chart',
        content: {
          engine: 'vega-lite',
          spec: { mark: 'line', encoding: { x: { field: 'day' }, y: { field: 'ms' } } },
          data: [{ day: 'Mon', ms: 120 }],
          caption: 'Latency',
        },
      },
      authorType: 'ai',
      authorId: 'agent_1',
      now: NOW,
    });

    const serialized = serializeBlocksToAnnotatedMarkdown([block]);
    expect(serialized).toContain('data="separate"');
    const [parsed] = parseAnnotatedMarkdown(serialized);
    expect(parsed).toMatchObject({ id: block.id, type: 'chart', content: block.content });
    if (parsed?.type === 'chart') {
      expect(computeBlockContentHash(parsed.type, parsed.content)).toBe(block.contentHash);
    }
  });
});
