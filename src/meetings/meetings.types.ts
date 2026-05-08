import { z } from 'zod';

const MeetingBaseSchema = z.object({
  title: z.string().min(1).max(500),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime(),
  attendees: z.array(z.string().min(1)).max(50),
  transcript: z.string().min(1).max(5_000_000),
  external_id: z.string().min(1).max(200).optional(),
});

export const IngestPayloadSchema = z.discriminatedUnion('source', [
  MeetingBaseSchema.extend({ source: z.literal('meetily') }),
  MeetingBaseSchema.extend({
    source: z.literal('fathom'),
    summary: z.string().max(100_000).optional(),
    action_items: z.array(z.string().max(2000)).max(100).optional(),
  }),
]);
export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

export const IngestResponseSchema = z.object({
  meeting_id: z.string(),
  vault_path: z.string(),
  commit_sha: z.string(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
