import { ERROR_CODES } from '@docalaizer/shared';
import type { ChartPayload, DiagramPayload, ProposalBlockPayload } from './blocks';

export interface ValidationIssue {
  path: string;
  message: string;
  line?: number;
}

export type ValidationResult =
  | { valid: true }
  | {
      valid: false;
      code: typeof ERROR_CODES.CHART_VALIDATION_ERROR;
      details: ValidationIssue[];
    };

export interface VisualizationLimits {
  maxMermaidBytes: number;
  maxChartBytes: number;
  maxInlineDataRows: number;
  allowExternalDataUrl: boolean;
}

export const DEFAULT_VISUALIZATION_LIMITS: VisualizationLimits = {
  maxMermaidBytes: 100 * 1024, // 100 KB
  maxChartBytes: 2 * 1024 * 1024, // 2 MB
  maxInlineDataRows: 10_000,
  allowExternalDataUrl: false,
};

const MERMAID_HEADER_PATTERNS = [
  /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/,
  /^sequenceDiagram\b/,
  /^classDiagram(-v2)?\b/,
  /^stateDiagram(-v2)?\b/,
  /^erDiagram\b/,
  /^gantt\b/,
  /^pie\b/,
  /^mindmap\b/,
  /^timeline\b/,
  /^gitGraph\b/,
  /^journey\b/,
  /^quadrantChart\b/,
  /^requirementDiagram\b/,
  /^C4(Context|Container|Component|Dynamic|Deployment)\b/,
  /^sankey-beta\b/,
  /^xychart-beta\b/,
  /^block-beta\b/,
  /^architecture-beta\b/,
  /^kanban\b/,
  /^packet-beta\b/,
];

const DANGEROUS_MERMAID_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /['"]?securityLevel['"]?\s*[:=]\s*['"]?(loose|antiscript|sandbox)['"]?/i,
    message: 'Overriding Mermaid securityLevel is forbidden for security reasons.',
  },
  {
    pattern: /\bjavascript\s*:/i,
    message: 'javascript: URLs are forbidden in Mermaid diagrams.',
  },
  {
    pattern: /<\s*script\b/i,
    message: '<script> tags are forbidden in Mermaid diagrams.',
  },
  {
    pattern: /<\s*iframe\b/i,
    message: '<iframe> tags are forbidden in Mermaid diagrams.',
  },
  {
    pattern: /\bon(click|error|load|mouseover|focus)\s*=/i,
    message: 'Inline HTML event handlers are forbidden in Mermaid diagrams.',
  },
];

const VEGA_LITE_MARKS = new Set([
  'arc',
  'area',
  'bar',
  'boxplot',
  'circle',
  'errorband',
  'errorbar',
  'geoshape',
  'image',
  'line',
  'point',
  'rect',
  'rule',
  'square',
  'text',
  'tick',
  'trail',
]);

const VEGA_LITE_FIELD_TYPES = new Set([
  'quantitative',
  'temporal',
  'ordinal',
  'nominal',
  'geojson',
]);

const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DANGEROUS_STRING_PATTERN = /^\s*(javascript:|vbscript:|data:text\/html)/i;

function utf8ByteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}

function stripLeadingMermaidComments(lines: string[]): {
  firstContentLine: string | null;
  firstContentLineNumber: number;
} {
  let inInitBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? '';
    if (!trimmed) continue;

    if (inInitBlock) {
      if (trimmed.includes('}%%')) {
        inInitBlock = false;
      }
      continue;
    }

    if (trimmed.startsWith('%%{')) {
      if (!trimmed.includes('}%%')) {
        inInitBlock = true;
      }
      continue;
    }

    if (trimmed.startsWith('%%')) {
      continue;
    }

    return { firstContentLine: trimmed, firstContentLineNumber: i + 1 };
  }

  return { firstContentLine: null, firstContentLineNumber: 1 };
}

export function validateMermaidDiagram(
  payload: DiagramPayload | string,
  limits: Partial<VisualizationLimits> = {},
): ValidationResult {
  const effectiveLimits = { ...DEFAULT_VISUALIZATION_LIMITS, ...limits };
  const source = typeof payload === 'string' ? payload : payload.source;
  const issues: ValidationIssue[] = [];

  if (typeof source !== 'string' || source.trim().length === 0) {
    return {
      valid: false,
      code: ERROR_CODES.CHART_VALIDATION_ERROR,
      details: [{ path: 'source', message: 'Mermaid diagram source must not be empty.' }],
    };
  }

  const byteSize = utf8ByteLength(source);
  if (byteSize > effectiveLimits.maxMermaidBytes) {
    issues.push({
      path: 'source',
      message: `Mermaid source exceeds maximum size of ${effectiveLimits.maxMermaidBytes} bytes (got ${byteSize}).`,
    });
  }

  const lines = source.replace(/\r\n/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const rule of DANGEROUS_MERMAID_PATTERNS) {
      if (rule.pattern.test(line)) {
        issues.push({ path: 'source', line: i + 1, message: rule.message });
      }
    }
  }

  const { firstContentLine, firstContentLineNumber } = stripLeadingMermaidComments(lines);
  if (!firstContentLine) {
    issues.push({
      path: 'source',
      message: 'Mermaid diagram contains only comments or whitespace.',
    });
  } else {
    const matched = MERMAID_HEADER_PATTERNS.some((pattern) => pattern.test(firstContentLine));
    if (!matched) {
      issues.push({
        path: 'source',
        line: firstContentLineNumber,
        message: `Unsupported or invalid Mermaid diagram header: "${firstContentLine}". Expected e.g. "flowchart LR", "sequenceDiagram", "erDiagram", "stateDiagram-v2", "classDiagram", "C4Context".`,
      });
    } else if (/^(flowchart|graph)\b/.test(firstContentLine)) {
      let subgraphDepth = 0;
      for (let i = firstContentLineNumber; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trim();
        if (!trimmed || trimmed.startsWith('%%')) continue;
        if (/^subgraph\b/.test(trimmed)) {
          subgraphDepth++;
        } else if (trimmed === 'end') {
          subgraphDepth--;
          if (subgraphDepth < 0) {
            issues.push({
              path: 'source',
              line: i + 1,
              message: 'Unexpected "end" without matching "subgraph".',
            });
            subgraphDepth = 0;
          }
        }
      }
      if (subgraphDepth > 0) {
        issues.push({
          path: 'source',
          message: `Unclosed "subgraph" block(s): missing ${subgraphDepth} "end" statement(s).`,
        });
      }
    } else if (/^sequenceDiagram\b/.test(firstContentLine)) {
      let blockDepth = 0;
      for (let i = firstContentLineNumber; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trim();
        if (!trimmed || trimmed.startsWith('%%')) continue;
        if (/^(alt|opt|loop|par|critical|break|rect|box)\b/.test(trimmed)) {
          blockDepth++;
        } else if (trimmed === 'end') {
          blockDepth--;
          if (blockDepth < 0) {
            issues.push({
              path: 'source',
              line: i + 1,
              message: 'Unexpected "end" without matching sequence block.',
            });
            blockDepth = 0;
          }
        }
      }
      if (blockDepth > 0) {
        issues.push({
          path: 'source',
          message: `Unclosed sequence diagram block(s): missing ${blockDepth} "end" statement(s).`,
        });
      }
    } else if (/^(erDiagram|classDiagram|stateDiagram)/.test(firstContentLine)) {
      const isEr = /^erDiagram\b/.test(firstContentLine);
      let braceDepth = 0;
      for (let i = firstContentLineNumber; i < lines.length; i++) {
        const trimmed = (lines[i] ?? '').trim();
        if (!trimmed || trimmed.startsWith('%%')) continue;

        if (isEr) {
          // In erDiagram, `{` and `}` appear in cardinality tokens like `||--o{` or `}o--||`.
          // Entity attribute blocks open with `ENTITY {` at end of line and close with `}`.
          if (/^[A-Za-z0-9_-]+\s*\{$/.test(trimmed)) {
            braceDepth++;
          } else if (trimmed === '}') {
            braceDepth--;
            if (braceDepth < 0) {
              issues.push({
                path: 'source',
                line: i + 1,
                message: 'Unexpected closing "}" without matching "{".',
              });
              braceDepth = 0;
            }
          }
          continue;
        }

        for (const ch of trimmed) {
          if (ch === '{') braceDepth++;
          if (ch === '}') {
            braceDepth--;
            if (braceDepth < 0) {
              issues.push({
                path: 'source',
                line: i + 1,
                message: 'Unexpected closing "}" without matching "{".',
              });
              braceDepth = 0;
            }
          }
        }
      }
      if (braceDepth > 0) {
        issues.push({
          path: 'source',
          message: `Unclosed "{" brace(s): missing ${braceDepth} closing "}".`,
        });
      }
    }
  }

  if (issues.length > 0) {
    return {
      valid: false,
      code: ERROR_CODES.CHART_VALIDATION_ERROR,
      details: issues,
    };
  }

  return { valid: true };
}

function scanForUnsafeValues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  depth = 0,
): void {
  if (depth > 32) {
    issues.push({ path, message: 'Vega-Lite spec nesting exceeds maximum depth (32).' });
    return;
  }

  if (typeof value === 'function') {
    issues.push({ path, message: 'Executable JavaScript functions are forbidden in Vega-Lite specs.' });
    return;
  }

  if (typeof value === 'string') {
    if (DANGEROUS_STRING_PATTERN.test(value)) {
      issues.push({ path, message: 'Dangerous URI scheme is forbidden in Vega-Lite specs.' });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      scanForUnsafeValues(value[i], `${path}[${i}]`, issues, depth + 1);
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_JSON_KEYS.has(key)) {
        issues.push({ path: `${path}.${key}`, message: `Forbidden property key "${key}".` });
        continue;
      }
      scanForUnsafeValues(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        issues,
        depth + 1,
      );
    }
  }
}

function validateVegaLiteEncoding(
  encoding: unknown,
  basePath: string,
  issues: ValidationIssue[],
): void {
  if (encoding === undefined) return;
  if (encoding === null || typeof encoding !== 'object' || Array.isArray(encoding)) {
    issues.push({ path: basePath, message: '"encoding" must be a JSON object.' });
    return;
  }

  for (const [channel, def] of Object.entries(encoding as Record<string, unknown>)) {
    const channelPath = `${basePath}.${channel}`;
    if (Array.isArray(def)) {
      // Tooltip/detail/order may be arrays of field definitions
      def.forEach((item, idx) => validateEncodingChannel(item, `${channelPath}[${idx}]`, issues));
      continue;
    }
    validateEncodingChannel(def, channelPath, issues);
  }
}

function validateEncodingChannel(
  def: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    issues.push({ path, message: 'Encoding channel definition must be an object.' });
    return;
  }

  const record = def as Record<string, unknown>;
  if (record.type !== undefined) {
    if (typeof record.type !== 'string' || !VEGA_LITE_FIELD_TYPES.has(record.type)) {
      issues.push({
        path: `${path}.type`,
        message: `Invalid encoding type "${String(record.type)}". Expected one of: ${[...VEGA_LITE_FIELD_TYPES].join(', ')}.`,
      });
    }
  }

  const hasBinding =
    record.field !== undefined ||
    record.datum !== undefined ||
    record.value !== undefined ||
    record.aggregate !== undefined ||
    record.condition !== undefined;

  if (!hasBinding) {
    issues.push({
      path,
      message: 'Encoding channel must specify at least one of: field, datum, value, aggregate, or condition.',
    });
  }
}

function validateVegaLiteSpecNode(
  spec: unknown,
  path: string,
  issues: ValidationIssue[],
  limits: VisualizationLimits,
  hasInheritedData: boolean,
): boolean {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    issues.push({ path, message: 'Vega-Lite specification must be a JSON object.' });
    return false;
  }

  const node = spec as Record<string, unknown>;

  if (node.$schema !== undefined) {
    if (typeof node.$schema !== 'string' || !node.$schema.includes('vega-lite')) {
      issues.push({
        path: `${path}.$schema`,
        message: 'Invalid "$schema": expected a Vega-Lite schema URL.',
      });
    }
  }

  let hasDataHere = hasInheritedData;
  if (node.data !== undefined) {
    if (node.data === null || typeof node.data !== 'object' || Array.isArray(node.data)) {
      issues.push({ path: `${path}.data`, message: '"data" must be an object.' });
    } else {
      const dataObj = node.data as Record<string, unknown>;
      if (dataObj.url !== undefined && !limits.allowExternalDataUrl) {
        issues.push({
          path: `${path}.data.url`,
          message:
            'External data.url is disabled; provide inline data via chart.data or spec.data.values.',
        });
      }
      if (dataObj.values !== undefined) {
        if (!Array.isArray(dataObj.values)) {
          issues.push({
            path: `${path}.data.values`,
            message: '"data.values" must be an array of records.',
          });
        } else {
          if (dataObj.values.length > limits.maxInlineDataRows) {
            issues.push({
              path: `${path}.data.values`,
              message: `Inline dataset exceeds maximum row count (${limits.maxInlineDataRows}).`,
            });
          }
          hasDataHere = true;
        }
      }
      if (dataObj.name !== undefined || dataObj.sequence !== undefined) {
        hasDataHere = true;
      }
    }
  }

  validateVegaLiteEncoding(node.encoding, `${path}.encoding`, issues);

  const isLayer = Array.isArray(node.layer);
  const isHConcat = Array.isArray(node.hconcat);
  const isVConcat = Array.isArray(node.vconcat);
  const isConcat = Array.isArray(node.concat);
  const isFacetOrRepeat =
    node.spec !== undefined && (node.facet !== undefined || node.repeat !== undefined);

  const hasComposition = isLayer || isHConcat || isVConcat || isConcat || isFacetOrRepeat;

  if (node.mark !== undefined) {
    if (typeof node.mark === 'string') {
      if (!VEGA_LITE_MARKS.has(node.mark)) {
        issues.push({
          path: `${path}.mark`,
          message: `Unsupported Vega-Lite mark "${node.mark}".`,
        });
      }
    } else if (node.mark !== null && typeof node.mark === 'object' && !Array.isArray(node.mark)) {
      const markType = (node.mark as Record<string, unknown>).type;
      if (typeof markType !== 'string' || !VEGA_LITE_MARKS.has(markType)) {
        issues.push({
          path: `${path}.mark.type`,
          message: `Unsupported Vega-Lite mark.type "${String(markType)}".`,
        });
      }
    } else {
      issues.push({
        path: `${path}.mark`,
        message: '"mark" must be a mark name string or a mark definition object.',
      });
    }
  } else if (!hasComposition) {
    issues.push({
      path: `${path}.mark`,
      message:
        'Vega-Lite spec must define either "mark" or a composition ("layer", "hconcat", "vconcat", "concat", "facet"/"repeat" + "spec").',
    });
  }

  let childrenHaveData = false;
  if (isLayer) {
    const layers = node.layer as unknown[];
    if (layers.length === 0) {
      issues.push({ path: `${path}.layer`, message: '"layer" must contain at least one view.' });
    }
    childrenHaveData = layers.every((child, idx) =>
      validateVegaLiteSpecNode(child, `${path}.layer[${idx}]`, issues, limits, hasDataHere),
    );
  }
  if (isHConcat) {
    const views = node.hconcat as unknown[];
    if (views.length === 0) {
      issues.push({ path: `${path}.hconcat`, message: '"hconcat" must not be empty.' });
    }
    childrenHaveData = views.every((child, idx) =>
      validateVegaLiteSpecNode(child, `${path}.hconcat[${idx}]`, issues, limits, hasDataHere),
    );
  }
  if (isVConcat) {
    const views = node.vconcat as unknown[];
    if (views.length === 0) {
      issues.push({ path: `${path}.vconcat`, message: '"vconcat" must not be empty.' });
    }
    childrenHaveData = views.every((child, idx) =>
      validateVegaLiteSpecNode(child, `${path}.vconcat[${idx}]`, issues, limits, hasDataHere),
    );
  }
  if (isConcat) {
    const views = node.concat as unknown[];
    if (views.length === 0) {
      issues.push({ path: `${path}.concat`, message: '"concat" must not be empty.' });
    }
    childrenHaveData = views.every((child, idx) =>
      validateVegaLiteSpecNode(child, `${path}.concat[${idx}]`, issues, limits, hasDataHere),
    );
  }
  if (isFacetOrRepeat) {
    childrenHaveData = validateVegaLiteSpecNode(
      node.spec,
      `${path}.spec`,
      issues,
      limits,
      hasDataHere,
    );
  }

  return hasDataHere || childrenHaveData;
}

export function validateVegaLiteChart(
  payload: ChartPayload,
  limits: Partial<VisualizationLimits> = {},
): ValidationResult {
  const effectiveLimits = { ...DEFAULT_VISUALIZATION_LIMITS, ...limits };
  const issues: ValidationIssue[] = [];

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return {
      valid: false,
      code: ERROR_CODES.CHART_VALIDATION_ERROR,
      details: [{ path: 'spec', message: 'Chart payload is not serializable JSON.' }],
    };
  }

  const byteSize = utf8ByteLength(serialized);
  if (byteSize > effectiveLimits.maxChartBytes) {
    issues.push({
      path: 'data',
      message: `Chart payload exceeds maximum size of ${effectiveLimits.maxChartBytes} bytes (got ${byteSize}).`,
    });
  }

  if (payload.data !== undefined && payload.data.length > effectiveLimits.maxInlineDataRows) {
    issues.push({
      path: 'data',
      message: `Inline dataset exceeds maximum row count (${effectiveLimits.maxInlineDataRows}, got ${payload.data.length}).`,
    });
  }

  scanForUnsafeValues(payload.spec, 'spec', issues);
  if (payload.data !== undefined) {
    scanForUnsafeValues(payload.data, 'data', issues);
  }

  const hasTopLevelData = Array.isArray(payload.data);
  const resolvedHasData = validateVegaLiteSpecNode(
    payload.spec,
    'spec',
    issues,
    effectiveLimits,
    hasTopLevelData,
  );

  if (!resolvedHasData) {
    issues.push({
      path: 'data',
      message: 'Chart must provide inline data via chart.data or spec.data.values.',
    });
  }

  if (issues.length > 0) {
    return {
      valid: false,
      code: ERROR_CODES.CHART_VALIDATION_ERROR,
      details: issues,
    };
  }

  return { valid: true };
}

export function validateBlockPayload(
  payload: ProposalBlockPayload,
  limits: Partial<VisualizationLimits> = {},
): ValidationResult {
  if (payload.type === 'diagram') {
    return validateMermaidDiagram(payload.content, limits);
  }
  if (payload.type === 'chart') {
    return validateVegaLiteChart(payload.content, limits);
  }
  return { valid: true };
}
