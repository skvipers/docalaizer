import { z } from 'zod';
import { computeBlockContentHash, generateBlockId } from './hash';

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

const basePayloadFields = {
  id: z.string().min(1).optional(),
  title: z.string().optional(),
};

export const proposalBlockPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    ...basePayloadFields,
    type: z.literal('markdown'),
    content: z.string(),
  }),
  z.object({
    ...basePayloadFields,
    type: z.literal('diagram'),
    content: diagramPayloadSchema,
  }),
  z.object({
    ...basePayloadFields,
    type: z.literal('chart'),
    content: chartPayloadSchema,
  }),
  z.object({
    ...basePayloadFields,
    type: z.literal('table'),
    content: tablePayloadSchema,
  }),
  z.object({
    ...basePayloadFields,
    type: z.literal('callout'),
    content: calloutPayloadSchema,
  }),
]);

export type ProposalBlockPayload = z.infer<typeof proposalBlockPayloadSchema>;

export const proposalOpInputSchema = z.discriminatedUnion('opType', [
  z.object({
    opType: z.literal('insert'),
    afterBlockId: z.string().min(1).nullable().default(null),
    newBlockPayload: proposalBlockPayloadSchema,
  }),
  z.object({
    opType: z.literal('update'),
    targetBlockId: z.string().min(1),
    expectedHash: z.string().min(1).optional(),
    newBlockPayload: proposalBlockPayloadSchema,
  }),
  z.object({
    opType: z.literal('delete'),
    targetBlockId: z.string().min(1),
    expectedHash: z.string().min(1).optional(),
  }),
  z.object({
    opType: z.literal('move'),
    targetBlockId: z.string().min(1),
    afterBlockId: z.string().min(1).nullable(),
    expectedHash: z.string().min(1).optional(),
  }),
]);

export type ProposalOpInput = z.infer<typeof proposalOpInputSchema>;

export function isBlockProtectedFromAi(block: DocumentBlock): boolean {
  return block.meta.humanTouched || block.meta.lockedByHuman;
}

export function createDocumentBlock(params: {
  payload: ProposalBlockPayload;
  authorType: BlockAuthorType;
  authorId: string;
  now?: string;
  humanTouched?: boolean;
  lockedByHuman?: boolean;
}): DocumentBlock {
  const id = params.payload.id ?? generateBlockId();
  const timestamp = params.now ?? new Date().toISOString();
  const contentHash = computeBlockContentHash(params.payload.type, params.payload.content);
  const meta: BlockMeta = {
    origin: params.authorType,
    lastEditedByType: params.authorType,
    lastEditorId: params.authorId,
    lastEditedAt: timestamp,
    humanTouched: params.humanTouched ?? params.authorType === 'human',
    lockedByHuman: params.lockedByHuman ?? false,
  };

  return {
    id,
    ...(params.payload.title !== undefined ? { title: params.payload.title } : {}),
    type: params.payload.type,
    content: params.payload.content,
    contentHash,
    meta,
  } as DocumentBlock;
}
