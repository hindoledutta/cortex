import { z } from 'zod';

export const IngestPayloadSchema = z.object({
  title: z.string().min(1).max(500),
  started_at: z.string().datetime(),       // ISO 8601 UTC
  ended_at: z.string().datetime(),
  attendees: z.array(z.string().min(1)).max(50),  // names or emails — verbatim from Meetily
  transcript: z.string().min(1).max(5_000_000),    // 5MB hard cap (≈ 1.5M words; matches main.ts body limit)
  source: z.literal('meetily'),
  external_id: z.string().min(1).max(200).optional(),  // meetily-exporter meeting-id for idempotency
});
export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

export const IngestResponseSchema = z.object({
  meeting_id: z.string(),
  vault_path: z.string(),
  commit_sha: z.string(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
