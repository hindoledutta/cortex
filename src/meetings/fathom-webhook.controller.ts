import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { FathomWebhookGuard } from '../auth/fathom-webhook.guard';
import { MeetingsService } from './meetings.service';

const FathomTranscriptLineSchema = z.object({
  speaker: z
    .object({
      display_name: z.string().optional(),
      email: z.string().optional(),
      matched_calendar_invitee_email: z.string().nullable().optional(),
    })
    .optional(),
  text: z.string(),
  timestamp: z.string().optional(),
});

// Intentionally permissive: Fathom docs describe GET /meetings response shape
// but don't publish the exact webhook payload field names. The transform()
// method handles all documented candidate keys in priority order.
const FathomWebhookPayloadSchema = z.object({
  recording_id: z.union([z.string(), z.number()]),
  title: z.string().optional(),
  meeting_title: z.string().optional(),
  // Actual timestamp field names observed from Fathom API
  recording_start_time: z.string().optional(),
  recording_end_time: z.string().optional(),
  scheduled_start_time: z.string().optional(),
  scheduled_end_time: z.string().optional(),
  // Legacy / webhook-only candidates kept for safety
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  calendar_invitees: z
    .array(z.object({ email: z.string() }))
    .optional(),
  // Fathom API returns summary as default_summary; webhook may use summary
  default_summary: z
    .object({ markdown_formatted: z.string().optional() })
    .optional(),
  summary: z
    .object({ markdown_formatted: z.string().optional() })
    .optional(),
  transcript: z.array(FathomTranscriptLineSchema).optional(),
  // Action items use description field (confirmed from API response)
  action_items: z
    .array(
      z.union([
        z.string(),
        z.object({ description: z.string().optional(), text: z.string().optional() }),
      ]),
    )
    .optional(),
});

type FathomWebhookPayload = z.infer<typeof FathomWebhookPayloadSchema>;

@Controller('api/meetings')
@UseGuards(FathomWebhookGuard)
export class FathomWebhookController {
  private readonly logger = new Logger(FathomWebhookController.name);

  constructor(private readonly meetings: MeetingsService) {}

  @Post('fathom-webhook')
  @HttpCode(200)
  async handleWebhook(@Body() body: unknown) {
    const parsed = FathomWebhookPayloadSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(
        `Invalid Fathom webhook payload: ${JSON.stringify(parsed.error.flatten())}`,
      );
      throw new BadRequestException({ errors: parsed.error.flatten() });
    }
    return this.meetings.ingest(this.transform(parsed.data));
  }

  private transform(p: FathomWebhookPayload) {
    const title = p.title ?? p.meeting_title ?? `Fathom Meeting ${p.recording_id}`;
    const startedRaw =
      p.recording_start_time ?? p.scheduled_start_time ?? p.started_at ?? p.created_at ?? new Date().toISOString();
    const endedRaw =
      p.recording_end_time ?? p.scheduled_end_time ?? p.ended_at ?? p.updated_at ?? startedRaw;

    const toIso = (value: string, ctx: string): string => {
      const d = new Date(value);
      if (isNaN(d.getTime())) {
        this.logger.warn(`Fathom: unparseable ${ctx}="${value}"; using now`);
        return new Date().toISOString();
      }
      return d.toISOString();
    };

    const transcriptLines = (p.transcript ?? []).map((line) => {
      const ts = line.timestamp ? `[${line.timestamp}] ` : '';
      const speaker = line.speaker?.display_name ?? line.speaker?.email ?? '';
      return `${ts}${speaker ? `${speaker}: ` : ''}${line.text}`;
    });

    const action_items = (p.action_items ?? []).map((i) =>
      typeof i === 'string' ? i : (i.description ?? i.text ?? ''),
    ).filter(Boolean);

    // default_summary is the actual field name from Fathom API; summary may appear in webhooks
    const summary =
      p.default_summary?.markdown_formatted ?? p.summary?.markdown_formatted;

    return {
      source: 'fathom' as const,
      title,
      started_at: toIso(startedRaw, 'started_at'),
      ended_at: toIso(endedRaw, 'ended_at'),
      attendees: (p.calendar_invitees ?? []).map((i) => i.email).filter(Boolean),
      transcript: transcriptLines.join('\n') || '(no transcript)',
      external_id: String(p.recording_id),
      ...(summary ? { summary } : {}),
      ...(action_items.length > 0 ? { action_items } : {}),
    };
  }
}
