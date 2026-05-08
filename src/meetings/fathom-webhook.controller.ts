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
    })
    .optional(),
  text: z.string(),
  timestamp: z.string().optional(),
});

// Intentionally permissive: Fathom docs describe GET /meetings response shape
// but don't publish the exact webhook payload field names. The transform()
// method handles all documented candidate keys in priority order.
const FathomWebhookPayloadSchema = z.object({
  id: z.number().int(),
  recording_id: z.union([z.string(), z.number()]),
  title: z.string().optional(),
  meeting_name: z.string().optional(),
  started_at: z.string().optional(),
  created_at: z.string().optional(),
  ended_at: z.string().optional(),
  updated_at: z.string().optional(),
  calendar_invitees: z
    .array(z.object({ email: z.string() }))
    .optional(),
  summary: z
    .object({ markdown_formatted: z.string().optional() })
    .optional(),
  transcript: z.array(FathomTranscriptLineSchema).optional(),
  action_items: z
    .array(z.union([z.string(), z.object({ text: z.string() })]))
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
    const title = p.title ?? p.meeting_name ?? `Fathom Meeting ${p.id}`;
    const startedRaw = p.started_at ?? p.created_at ?? new Date().toISOString();
    const endedRaw = p.ended_at ?? p.updated_at ?? startedRaw;

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
      typeof i === 'string' ? i : i.text,
    );

    return {
      source: 'fathom' as const,
      title,
      started_at: toIso(startedRaw, 'started_at'),
      ended_at: toIso(endedRaw, 'ended_at'),
      attendees: (p.calendar_invitees ?? []).map((i) => i.email).filter(Boolean),
      transcript: transcriptLines.join('\n') || '(no transcript)',
      external_id: String(p.recording_id),
      ...(p.summary?.markdown_formatted
        ? { summary: p.summary.markdown_formatted }
        : {}),
      ...(action_items.length > 0 ? { action_items } : {}),
    };
  }
}
