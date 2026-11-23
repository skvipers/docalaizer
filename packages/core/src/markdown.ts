import type {
  BlockType,
  CalloutPayload,
  ChartPayload,
  DocumentBlock,
  ProposalBlockPayload,
  ProposalOpInput,
  TablePayload,
} from './blocks';
import { computeBlockContentHash } from './hash';

export interface ParsedMarkdownBlock {
  id?: string;
  type: BlockType;
  title?: string;
  content: DocumentBlock['content'];
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '&quot;');
}

function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/\\\\/g, '\\');
}

function serializeTableToMarkdown(table: TablePayload): string {
  const escapeCell = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const header = `| ${table.columns.map(escapeCell).join(' | ')} |`;
  const separator = `| ${table.columns.map(() => '---').join(' | ')} |`;
  const body = table.rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function parseTableFromMarkdown(raw: string): TablePayload {
  const lines = raw
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const splitRow = (line: string): string[] => {
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
    return trimmed
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, '|'));
  };

  if (lines.length === 0) {
    return { columns: [], rows: [] };
  }

  const columns = splitRow(lines[0] ?? '');
  const startRow = lines[1] && /^\|?[\s:-]+\|/.test(lines[1]) ? 2 : 1;
  const rows = lines.slice(startRow).map(splitRow);
  return { columns, rows };
}

function formatBlockBody(block: DocumentBlock): string {
  switch (block.type) {
    case 'markdown':
      return block.content.trimEnd();
    case 'diagram':
      return `\`\`\`mermaid\n${block.content.source.trimEnd()}\n\`\`\``;
    case 'chart': {
      const mergedSpec =
        block.content.data !== undefined && block.content.spec.data === undefined
          ? { ...block.content.spec, data: { values: block.content.data } }
          : block.content.spec;
      return `\`\`\`vega-lite\n${JSON.stringify(mergedSpec, null, 2)}\n\`\`\``;
    }
    case 'table':
      return serializeTableToMarkdown(block.content);
    case 'callout':
      return block.content.markdown.trimEnd();
  }
}

export function serializeBlocksToAnnotatedMarkdown(blocks: readonly DocumentBlock[]): string {
  return blocks
    .map((block) => {
      const attrs: string[] = [
        `id="${escapeAttr(block.id)}"`,
        `type="${block.type}"`,
      ];

      if (block.type === 'diagram') {
        attrs.push(`engine="${block.content.engine}"`);
        if (block.content.caption) {
          attrs.push(`caption="${escapeAttr(block.content.caption)}"`);
        }
      } else if (block.type === 'chart') {
        attrs.push(`engine="${block.content.engine}"`);
        if (block.content.caption) {
          attrs.push(`caption="${escapeAttr(block.content.caption)}"`);
        }
      } else if (block.type === 'callout') {
        attrs.push(`variant="${block.content.variant}"`);
      }

      if (block.title) {
        attrs.push(`title="${escapeAttr(block.title)}"`);
      }

      attrs.push(`owner="${block.meta.humanTouched ? 'human' : 'ai'}"`);
      attrs.push(`locked="${block.meta.lockedByHuman ? 'true' : 'false'}"`);

      const openTag = `<!-- docalaizer:block ${attrs.join(' ')} -->`;
      const body = formatBlockBody(block);
      const closeTag = `<!-- /docalaizer:block -->`;
      return `${openTag}\n${body}\n${closeTag}`;
    })
    .join('\n\n');
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)="((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      attrs[key] = unescapeAttr(value);
    }
  }
  return attrs;
}

function extractFencedCode(body: string, expectedLang: string): string {
  const trimmed = body.trim();
  const fenceRegex = new RegExp(
    `^\`\`\`${expectedLang}\\s*\\n([\\s\\S]*?)\\n\`\`\`$`,
    'i',
  );
  const match = fenceRegex.exec(trimmed);
  if (match && match[1] !== undefined) {
    return match[1];
  }
  return trimmed;
}

function parseAnnotatedBody(
  attrs: Record<string, string>,
  rawBody: string,
): ParsedMarkdownBlock {
  const type = (attrs.type as BlockType | undefined) ?? 'markdown';
  const id = attrs.id;
  const title = attrs.title;
  const body = rawBody.replace(/\r\n/g, '\n').trim();

  if (type === 'diagram') {
    const source = extractFencedCode(body, 'mermaid');
    return {
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      type: 'diagram',
      content: {
        engine: 'mermaid',
        source,
        ...(attrs.caption ? { caption: attrs.caption } : {}),
      },
    };
  }

  if (type === 'chart') {
    const jsonText = extractFencedCode(body, 'vega-lite');
    let parsedSpec: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(jsonText);
      parsedSpec =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      parsedSpec = {};
    }

    const content: ChartPayload = {
      engine: 'vega-lite',
      spec: parsedSpec,
      ...(attrs.caption ? { caption: attrs.caption } : {}),
    };

    return {
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      type: 'chart',
      content,
    };
  }

  if (type === 'table') {
    return {
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      type: 'table',
      content: parseTableFromMarkdown(body),
    };
  }

  if (type === 'callout') {
    const variantRaw = attrs.variant;
    const variant: CalloutPayload['variant'] =
      variantRaw === 'warning' ||
      variantRaw === 'danger' ||
      variantRaw === 'decision' ||
      variantRaw === 'info'
        ? variantRaw
        : 'info';
    return {
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      type: 'callout',
      content: { variant, markdown: body },
    };
  }

  return {
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    type: 'markdown',
    content: body,
  };
}

function parsePlainMarkdownSegment(segment: string): ParsedMarkdownBlock[] {
  const normalized = segment.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks: ParsedMarkdownBlock[] = [];
  const lines = normalized.split('\n');
  let buffer: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceLines: string[] = [];

  const flushMarkdownBuffer = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      blocks.push({ type: 'markdown', content: text });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (!inFence) {
      const fenceOpen = /^```(mermaid|vega-lite)\s*$/i.exec(line.trim());
      if (fenceOpen) {
        flushMarkdownBuffer();
        inFence = true;
        fenceLang = (fenceOpen[1] ?? '').toLowerCase();
        fenceLines = [];
        continue;
      }

      if (/^#{1,3}\s+/.test(line) && buffer.some((l) => l.trim().length > 0)) {
        flushMarkdownBuffer();
      }
      buffer.push(line);
    } else {
      if (line.trim() === '```') {
        const code = fenceLines.join('\n');
        if (fenceLang === 'mermaid') {
          blocks.push({
            type: 'diagram',
            content: { engine: 'mermaid', source: code },
          });
        } else if (fenceLang === 'vega-lite') {
          let spec: Record<string, unknown> = {};
          try {
            const parsed: unknown = JSON.parse(code);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
              spec = parsed as Record<string, unknown>;
            }
          } catch {
            spec = {};
          }
          blocks.push({
            type: 'chart',
            content: { engine: 'vega-lite', spec },
          });
        }
        inFence = false;
        fenceLang = '';
        fenceLines = [];
      } else {
        fenceLines.push(line);
      }
    }
  }

  if (inFence) {
    buffer.push(`\`\`\`${fenceLang}`, ...fenceLines);
  }
  flushMarkdownBuffer();

  return blocks;
}

export function parseAnnotatedMarkdown(markdown: string): ParsedMarkdownBlock[] {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const blockRegex =
    /<!--\s*docalaizer:block\s+([^>]*?)-->\s*\n?([\s\S]*?)\n?<!--\s*\/docalaizer:block\s*-->/g;

  const result: ParsedMarkdownBlock[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(normalized)) !== null) {
    const leadingText = normalized.slice(lastIndex, match.index);
    if (leadingText.trim()) {
      result.push(...parsePlainMarkdownSegment(leadingText));
    }

    const attrs = parseAttributes(match[1] ?? '');
    const body = match[2] ?? '';
    result.push(parseAnnotatedBody(attrs, body));
    lastIndex = match.index + match[0].length;
  }

  const trailingText = normalized.slice(lastIndex);
  if (trailingText.trim()) {
    result.push(...parsePlainMarkdownSegment(trailingText));
  }

  return result;
}

function extractLeadingHeading(block: {
  type: BlockType;
  title?: string;
  content: DocumentBlock['content'];
}): string | null {
  if (block.title) return block.title.trim().toLowerCase();
  if (block.type === 'markdown' && typeof block.content === 'string') {
    const firstLine = block.content.trim().split('\n')[0]?.trim() ?? '';
    const m = /^#{1,6}\s+(.+)$/.exec(firstLine);
    if (m && m[1]) {
      return m[1].trim().toLowerCase();
    }
  }
  return null;
}

function toProposalPayload(block: ParsedMarkdownBlock): ProposalBlockPayload {
  return {
    ...(block.id ? { id: block.id } : {}),
    ...(block.title ? { title: block.title } : {}),
    type: block.type,
    content: block.content,
  } as ProposalBlockPayload;
}

/**
 * Aligns parsed annotated/plain Markdown against baseBlocks and produces minimal
 * structured block operations (delete, update, move, insert).
 */
export function diffMarkdownToProposalOps(
  baseBlocks: readonly DocumentBlock[],
  annotatedMarkdown: string,
): ProposalOpInput[] {
  const parsed = parseAnnotatedMarkdown(annotatedMarkdown);
  const baseById = new Map(baseBlocks.map((b) => [b.id, b]));
  const matchedBaseIds = new Set<string>();

  type AlignedEntry = {
    parsed: ParsedMarkdownBlock;
    matchedBaseId: string | null;
    parsedHash: string;
  };

  const aligned: AlignedEntry[] = parsed.map((p) => ({
    parsed: p,
    matchedBaseId: null,
    parsedHash: computeBlockContentHash(p.type, p.content),
  }));

  // Pass 1: exact block_id match from <!-- docalaizer:block id="..." -->
  for (const entry of aligned) {
    if (entry.parsed.id && baseById.has(entry.parsed.id) && !matchedBaseIds.has(entry.parsed.id)) {
      entry.matchedBaseId = entry.parsed.id;
      matchedBaseIds.add(entry.parsed.id);
    }
  }

  // Pass 2: exact contentHash match for blocks where the AI omitted HTML markers
  for (const entry of aligned) {
    if (entry.matchedBaseId) continue;
    const candidate = baseBlocks.find(
      (b) => !matchedBaseIds.has(b.id) && b.type === entry.parsed.type && b.contentHash === entry.parsedHash,
    );
    if (candidate) {
      entry.matchedBaseId = candidate.id;
      matchedBaseIds.add(candidate.id);
    }
  }

  // Pass 3: heading / title match for unmarked edited sections
  for (const entry of aligned) {
    if (entry.matchedBaseId) continue;
    const heading = extractLeadingHeading(entry.parsed);
    if (!heading) continue;
    const candidate = baseBlocks.find(
      (b) =>
        !matchedBaseIds.has(b.id) &&
        b.type === entry.parsed.type &&
        extractLeadingHeading(b) === heading,
    );
    if (candidate) {
      entry.matchedBaseId = candidate.id;
      matchedBaseIds.add(candidate.id);
    }
  }

  const ops: ProposalOpInput[] = [];

  // 1. Deletions (blocks present in baseBlocks but missing in parsed Markdown)
  for (const baseBlock of baseBlocks) {
    if (!matchedBaseIds.has(baseBlock.id)) {
      ops.push({
        opType: 'delete',
        targetBlockId: baseBlock.id,
        expectedHash: baseBlock.contentHash,
      });
    }
  }

  // 2. Updates (matched blocks whose content or title changed)
  for (const entry of aligned) {
    if (!entry.matchedBaseId) continue;
    const baseBlock = baseById.get(entry.matchedBaseId)!;
    const titleChanged = (baseBlock.title ?? undefined) !== (entry.parsed.title ?? undefined);
    const contentChanged = baseBlock.contentHash !== entry.parsedHash || baseBlock.type !== entry.parsed.type;

    if (contentChanged || titleChanged) {
      ops.push({
        opType: 'update',
        targetBlockId: baseBlock.id,
        expectedHash: baseBlock.contentHash,
        newBlockPayload: toProposalPayload({
          ...entry.parsed,
          id: baseBlock.id,
        }),
      });
    }
  }

  // 3. Reordering (moves) among surviving base blocks
  const survivingBaseOrder = baseBlocks
    .filter((b) => matchedBaseIds.has(b.id))
    .map((b) => b.id);
  const targetMatchedOrder = aligned
    .map((e) => e.matchedBaseId)
    .filter((id): id is string => id !== null);

  if (
    survivingBaseOrder.length === targetMatchedOrder.length &&
    survivingBaseOrder.some((id, idx) => id !== targetMatchedOrder[idx])
  ) {
    const workingOrder = [...survivingBaseOrder];
    for (let i = 0; i < targetMatchedOrder.length; i++) {
      const desiredId = targetMatchedOrder[i]!;
      if (workingOrder[i] !== desiredId) {
        const currentIdx = workingOrder.indexOf(desiredId);
        workingOrder.splice(currentIdx, 1);
        workingOrder.splice(i, 0, desiredId);
        const afterBlockId = i === 0 ? null : targetMatchedOrder[i - 1]!;
        const baseBlock = baseById.get(desiredId)!;
        ops.push({
          opType: 'move',
          targetBlockId: desiredId,
          afterBlockId,
          expectedHash: baseBlock.contentHash,
        });
      }
    }
  }

  // 4. Insertions (new blocks placed relative to the preceding block)
  let previousBlockId: string | null = null;
  for (const entry of aligned) {
    if (entry.matchedBaseId) {
      previousBlockId = entry.matchedBaseId;
    } else {
      const assignedId = entry.parsed.id;
      ops.push({
        opType: 'insert',
        afterBlockId: previousBlockId,
        newBlockPayload: toProposalPayload(entry.parsed),
      });
      if (assignedId) {
        previousBlockId = assignedId;
      }
    }
  }

  return ops;
}
