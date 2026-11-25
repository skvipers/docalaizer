import { ERROR_CODES } from '@docalaizer/shared';
import { describe, expect, it } from 'vitest';
import {
  validateBlockPayload,
  validateMermaidDiagram,
  validateVegaLiteChart,
} from './validators';

describe('validateMermaidDiagram', () => {
  it('accepts valid flowchart, sequenceDiagram, erDiagram, and C4Context diagrams', () => {
    expect(
      validateMermaidDiagram(
        'flowchart LR\n  subgraph Core\n    A[API] --> B[(DB)]\n  end',
      ),
    ).toEqual({ valid: true });

    expect(
      validateMermaidDiagram(
        'sequenceDiagram\n  AI->>API: propose\n  alt valid\n    API-->>AI: 201\n  end',
      ),
    ).toEqual({ valid: true });

    expect(
      validateMermaidDiagram(
        'erDiagram\n  USERS ||--o{ PROJECTS : owns\n  USERS {\n    uuid id PK\n  }',
      ),
    ).toEqual({ valid: true });

    expect(validateMermaidDiagram('C4Context\n  Person(u, "User")')).toEqual({
      valid: true,
    });
  });

  it('rejects empty source, invalid headers, and unbalanced blocks/braces', () => {
    const empty = validateMermaidDiagram('   ');
    expect(empty.valid).toBe(false);
    if (!empty.valid) expect(empty.code).toBe(ERROR_CODES.CHART_VALIDATION_ERROR);

    const badHeader = validateMermaidDiagram('notADiagram\n  A --> B');
    expect(badHeader.valid).toBe(false);

    const unclosedSubgraph = validateMermaidDiagram('flowchart TD\n  subgraph S1\n    A --> B');
    expect(unclosedSubgraph.valid).toBe(false);
    if (!unclosedSubgraph.valid) {
      expect(unclosedSubgraph.details[0]?.message).toContain('subgraph');
    }

    const extraEnd = validateMermaidDiagram('sequenceDiagram\n  A->>B: hi\n  end');
    expect(extraEnd.valid).toBe(false);

    const unclosedBrace = validateMermaidDiagram('erDiagram\n  USERS {\n    uuid id PK');
    expect(unclosedBrace.valid).toBe(false);
  });

  it('blocks XSS and securityLevel downgrade attempts in Mermaid', () => {
    const loose = validateMermaidDiagram(
      '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n  A --> B',
    );
    expect(loose.valid).toBe(false);

    const jsClick = validateMermaidDiagram(
      'flowchart LR\n  A[Click]\n  click A "javascript:alert(1)"',
    );
    expect(jsClick.valid).toBe(false);

    const scriptTag = validateMermaidDiagram(
      'flowchart LR\n  A["<script>alert(1)</script>"] --> B',
    );
    expect(scriptTag.valid).toBe(false);

    const clickCall = validateMermaidDiagram('flowchart LR\n  A --> B\n  click A call evilFn()');
    expect(clickCall.valid).toBe(false);

    const headerOnly = validateMermaidDiagram('flowchart LR\n  %% only comment');
    expect(headerOnly.valid).toBe(false);

    const unclosedQuote = validateMermaidDiagram('flowchart LR\n  A["Unclosed label] --> B');
    expect(unclosedQuote.valid).toBe(false);
  });
});

describe('validateVegaLiteChart', () => {
  it('accepts valid Vega-Lite specs with chart.data, spec.data.values, and layer composition', () => {
    expect(
      validateVegaLiteChart({
        engine: 'vega-lite',
        spec: {
          $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
          mark: { type: 'line', point: true },
          encoding: {
            x: { field: 'day', type: 'ordinal' },
            y: { field: 'ms', type: 'quantitative' },
          },
        },
        data: [
          { day: 'Mon', ms: 120 },
          { day: 'Tue', ms: 95 },
        ],
      }),
    ).toEqual({ valid: true });

    expect(
      validateVegaLiteChart({
        engine: 'vega-lite',
        spec: {
          data: { values: [{ x: 1, y: 2 }] },
          layer: [
            { mark: 'line', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
            { mark: 'point', encoding: { x: { field: 'x' }, y: { field: 'y' } } },
          ],
        },
      }),
    ).toEqual({ valid: true });
  });

  it('rejects missing mark/composition, unknown mark, invalid encoding type, and missing data', () => {
    const noMark = validateVegaLiteChart({
      engine: 'vega-lite',
      spec: { encoding: { x: { field: 'a', type: 'invalid_type' } } },
    });
    expect(noMark.valid).toBe(false);
    if (!noMark.valid) {
      expect(noMark.code).toBe(ERROR_CODES.CHART_VALIDATION_ERROR);
      expect(noMark.details.length).toBeGreaterThanOrEqual(3);
    }

    const badMark = validateVegaLiteChart({
      engine: 'vega-lite',
      spec: { mark: 'rainbow_3d', data: { values: [{ a: 1 }] } },
    });
    expect(badMark.valid).toBe(false);
  });

  it('enforces security rules and dataset quotas on Vega-Lite charts', () => {
    const externalUrl = validateVegaLiteChart({
      engine: 'vega-lite',
      spec: {
        data: { url: 'https://evil.example/data.json' },
        mark: 'bar',
      },
    });
    expect(externalUrl.valid).toBe(false);

    const xssHref = validateVegaLiteChart({
      engine: 'vega-lite',
      spec: {
        mark: 'point',
        encoding: { href: { value: 'javascript:alert(1)' } },
      },
      data: [{ x: 1 }],
    });
    expect(xssHref.valid).toBe(false);

    const tooManyRows = validateVegaLiteChart(
      {
        engine: 'vega-lite',
        spec: { mark: 'bar' },
        data: [{ a: 1 }, { a: 2 }, { a: 3 }],
      },
      { maxInlineDataRows: 2 },
    );
    expect(tooManyRows.valid).toBe(false);

    const payloadViaWrapper = validateBlockPayload({
      type: 'chart',
      content: { engine: 'vega-lite', spec: {} },
    });
    expect(payloadViaWrapper.valid).toBe(false);

    const invalidCompilerSpec = validateVegaLiteChart({
      engine: 'vega-lite',
      spec: {
        mark: 'bar',
        transform: [{ calculate: '1 + (', as: 'broken' }],
        encoding: { x: { field: 'a', type: 'ordinal' }, y: { field: 'b', type: 'quantitative' } },
      },
      data: [{ a: 'x', b: 1 }],
    });
    expect(invalidCompilerSpec.valid).toBe(false);
  });
});
