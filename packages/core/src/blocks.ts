import { z } from 'zod';

export const blockAuthorTypeSchema = z.enum(['human', 'ai']);
export type BlockAuthorType = z.infer<typeof blockAuthorTypeSchema>;

export const blockMetaSchema = z.object({
  origin: blockAuthorTypeSchema,
  lastEditedByType: blockAuthorTypeSchema,
  lastEditorId: z.string().min(1),
  lastEditedAt: z.string().datetime(),
  humanTouched: z.boolean(),
  lockedByHuman: z.boolean(),
});
export type BlockMeta = z.infer<typeof blockMetaSchema>;

export const diagramPayloadSchema = z.object({
  engine: z.literal('mermaid'),
  source: z.string().min(1),
  caption: z.string().optional(),
});
export type DiagramPayload = z.infer<typeof diagramPayloadSchema>;

export const chartPayloadSchema = z.object({
  engine: z.literal('vega-lite'),
  spec: z.record(z.unknown()),
  data: z.array(z.record(z.unknown())).optional(),
  caption: z.string().optional(),
});
export type ChartPayload = z.infer<typeof chartPayloadSchema>;

export const tablePayloadSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
export type TablePayload = z.infer<typeof tablePayloadSchema>;

export const calloutPayloadSchema = z.object({
  variant: z.enum(['info', 'warning', 'danger', 'decision']),
  markdown: z.string(),
});
export type CalloutPayload = z.infer<typeof calloutPayloadSchema>;

const baseBlockFields = {
  id: z.string().min(1),
  title: z.string().optional(),
  contentHash: z.string().min(1),
  meta: blockMetaSchema,
};

export const documentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    ...baseBlockFields,
    type: z.literal('markdown'),
    content: z.string(),
  }),
  z.object({
    ...baseBlockFields,
    type: z.literal('diagram'),
    content: diagramPayloadSchema,
  }),
  z.object({
    ...baseBlockFields,
    type: z.literal('chart'),
    content: chartPayloadSchema,
  }),
  z.object({
    ...baseBlockFields,
    type: z.literal('table'),
    content: tablePayloadSchema,
  }),
  z.object({
    ...baseBlockFields,
    type: z.literal('callout'),
    content: calloutPayloadSchema,
  }),
]);

export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type BlockType = DocumentBlock['type'];

export function isBlockProtectedFromAi(block: DocumentBlock): boolean {
  return block.meta.humanTouched || block.meta.lockedByHuman;
}
