import { createHash, randomBytes } from 'node:crypto';
import type { BlockType, DocumentBlock } from './blocks';

function normalizeString(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function canonicalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      const prop = (value as Record<string, unknown>)[key];
      if (prop !== undefined) {
        sorted[key] = canonicalizeValue(prop);
      }
    }
    return sorted;
  }
  return value;
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

export function computeBlockContentHash(
  type: BlockType,
  content: DocumentBlock['content'],
): string {
  const canonical = canonicalizeJson({ type, content });
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${digest}`;
}

export function generateBlockId(): string {
  const ts = Date.now().toString(36).padStart(9, '0');
  const rand = randomBytes(6).toString('hex');
  return `blk_${ts}_${rand}`;
}

export function extractPlainTextForSearch(blocks: readonly DocumentBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.title) {
      parts.push(block.title);
    }

    switch (block.type) {
      case 'markdown':
        parts.push(block.content);
        break;
      case 'diagram':
        if (block.content.caption) parts.push(block.content.caption);
        parts.push(block.content.source);
        break;
      case 'chart':
        if (block.content.caption) parts.push(block.content.caption);
        if (typeof block.content.spec.title === 'string') {
          parts.push(block.content.spec.title);
        }
        break;
      case 'table':
        parts.push(block.content.columns.join(' '));
        for (const row of block.content.rows) {
          parts.push(row.join(' '));
        }
        break;
      case 'callout':
        parts.push(block.content.markdown);
        break;
    }
  }

  return parts.join('\n').trim();
}
