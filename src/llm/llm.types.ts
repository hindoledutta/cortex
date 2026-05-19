import { z } from 'zod';

/**
 * LLM operation types determine model routing.
 * Decomposition uses Opus; all others use Sonnet.
 */
export type LlmOperation =
  | 'decomposition'
  | 'classification'
  | 'follow-up'
  | 'enrichment'
  | 'comment-extraction'
  | 'calendar-extraction'
  | 'direct-calendar-extraction'
  | 'slug-generation';

/**
 * Model routing map: Opus 4.6 for decomposition, Sonnet 4.6 for everything else.
 * Per user locked decision.
 */
export const MODEL_MAP: Record<LlmOperation, string> = {
  decomposition: 'claude-opus-4-6',
  classification: 'claude-sonnet-4-6',
  'follow-up': 'claude-sonnet-4-6',
  enrichment: 'claude-sonnet-4-6',
  'comment-extraction': 'claude-sonnet-4-6',
  'calendar-extraction': 'claude-sonnet-4-6',
  'direct-calendar-extraction': 'claude-sonnet-4-6',
  'slug-generation': 'claude-sonnet-4-6',
};

/**
 * Standardized LLM response returned by LlmService.
 */
export interface LlmResponse {
  content: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// --- Zod schemas for structured LLM output ---

export const DecompositionResultSchema = z.object({
  needs_decomposition: z.boolean(),
  workspace: z.enum(['work', 'personal']).nullable(),
  parent_task: z
    .object({
      title: z.string(),
      description: z.string().nullable(),
      priority: z.enum(['high', 'medium', 'low']),
      deadline: z.string().nullable(),
    })
    .nullable(),
  sub_tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      priority: z.enum(['high', 'medium', 'low']),
      position: z.number(),
    }),
  ),
  follow_up_needed: z.boolean(),
  detected_gaps: z.array(z.string()),
});

export type DecompositionResult = z.infer<typeof DecompositionResultSchema>;

export const FollowUpResultSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      target_task_ids: z.array(z.string()),
      gap_type: z.enum(['deadline', 'priority', 'context', 'scope']),
    }),
  ),
});

export type FollowUpResult = z.infer<typeof FollowUpResultSchema>;

export const EnrichmentResultSchema = z.object({
  task_updates: z.array(
    z.object({
      task_id: z.string(),
      field: z.enum([
        'title',
        'description',
        'priority',
        'deadline',
        'status',
      ]),
      value: z.string(),
    }),
  ),
  new_sub_tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      priority: z.enum(['high', 'medium', 'low']),
    }),
  ),
  summary: z.string(),
});

export type EnrichmentResult = z.infer<typeof EnrichmentResultSchema>;

export const ClassificationResultSchema = z.object({
  intent: z.enum([
    'new_brain_dump',
    'follow_up_answer',
    'task_action',
    'command',
    'calendar_event',
    'unclear',
  ]),
  is_continuation: z.boolean(),
  confidence: z.number(),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

export const CommentExtractionResultSchema = z.object({
  has_action_items: z.boolean(),
  action_items: z.array(
    z.object({
      title: z.string(),
      description: z.string().nullable(),
      priority: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

export type CommentExtractionResult = z.infer<
  typeof CommentExtractionResultSchema
>;

export const SlugResultSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+){2,5}$/), // 3-6 hyphenated tokens
});
export type SlugResult = z.infer<typeof SlugResultSchema>;
