import { z } from 'zod';

export const IngestPayloadSchema = z.object({
  source: z.literal('fathom'),
  title: z.string().min(1).max(500),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
  attendees: z.array(z.string().min(1)).max(50),
  transcript: z.string().min(1).max(5_000_000),
  external_id: z.string().min(1).max(200).optional(),
  summary: z.string().max(100_000).optional(),
  action_items: z.array(z.string().max(2000)).max(100).optional(),
});
export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

export const IngestResponseSchema = z.object({
  meeting_id: z.string(),
  vault_path: z.string(),
  commit_sha: z.string(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
