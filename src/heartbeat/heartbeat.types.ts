import { z } from 'zod';

export const HeartbeatPayloadSchema = z.object({
  host: z.string().min(1).max(100),                     // e.g. "mac-mini-home"
  version: z.string().min(1).max(50).optional(),
  last_ingest_at: z.string().datetime().nullable().optional(),
  queue_depth: z.number().int().min(0).max(10_000).optional(),
  last_error: z.string().max(2000).nullable().optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

export const HeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  last_seen_at: z.string().datetime(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
