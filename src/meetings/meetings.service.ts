import { Injectable, Logger } from '@nestjs/common';
import slugify from 'slug';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { NotificationService } from '../scheduler/notification.service';
import type { IngestPayload, IngestResponse } from './meetings.types';

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly workspace: WorkspaceService,
    private readonly notifications: NotificationService,
  ) {}

  async ingest(p: IngestPayload): Promise<IngestResponse> {
    // Idempotency check — skip if external_id already ingested.
    if (p.external_id) {
      const existing = await this.prisma.meeting.findFirst({
        where: { source: p.source, externalId: p.external_id },
      });
      if (existing) {
        this.logger.log(
          `Duplicate ingest external_id=${p.external_id}; returning existing meeting=${existing.id}`,
        );
        return {
          meeting_id: existing.id,
          vault_path: existing.vaultPath,
          commit_sha: existing.vaultCommitSha,
        };
      }
    }

    // Workspace — locked to Work per MEET-08.
    const workspace = await this.workspace.findByName('work');
    if (!workspace) {
      throw new Error('Work workspace not found in DB — seed missing or migrated incorrectly');
    }

    // Slug from title — pure transform, no LLM. Cap at 80 chars.
    const baseSlug = slugify(p.title, { lower: true }).slice(0, 80);
    const slug = baseSlug.length > 0 ? baseSlug : 'untitled-meeting';

    // Date prefix — started_at, UTC date.
    const startedAt = new Date(p.started_at);
    const endedAt = new Date(p.ended_at);
    const dateStr = startedAt.toISOString().slice(0, 10);
    const vaultPath = `raw/meetings/${dateStr}-${slug}.md`;

    const startedFmt = startedAt.toISOString().slice(11, 16);
    const endedFmt = endedAt.toISOString().slice(11, 16);
    const attendeesLine = p.attendees.length > 0 ? p.attendees.join(', ') : '(unknown)';
    const body = this.buildBody(p, dateStr, startedFmt, endedFmt, attendeesLine);

    const meetingId = randomUUID();

    // Vault write — Phase 7a's VaultService records the VaultWrite audit row.
    const writeResult = await this.vault.writeFile({
      vaultPath,
      body,
      commitMessage: `meeting: ${slug}`,
      kind: 'meeting',
      sourceId: meetingId,
    });

    const meeting = await this.prisma.meeting.create({
      data: {
        id: meetingId,
        workspaceId: workspace.id,
        title: p.title,
        startedAt,
        endedAt,
        attendeeEmails: p.attendees,
        transcript: p.transcript,
        source: p.source,
        externalId: p.external_id ?? null,
        vaultPath: writeResult.vaultPath,
        vaultCommitSha: writeResult.commitSha,
      },
    });

    // Telegram notification — fire-and-forget. Failure must NOT fail the ingest.
    this.notifications
      .sendMeetingCaptured({
        title: p.title,
        startedAt,
        endedAt,
        attendeeCount: p.attendees.length,
        vaultPath: writeResult.vaultPath,
      })
      .catch((err) =>
        this.logger.warn(`Meeting notification failed (meetingId=${meetingId}): ${String(err)}`),
      );

    return {
      meeting_id: meeting.id,
      vault_path: writeResult.vaultPath,
      commit_sha: writeResult.commitSha,
    };
  }

  private buildBody(
    p: IngestPayload,
    dateStr: string,
    startedFmt: string,
    endedFmt: string,
    attendeesLine: string,
  ): string {
    const header = [
      `Source: Fathom`,
      `Date: ${dateStr}`,
      `Started: ${startedFmt}`,
      `Ended: ${endedFmt}`,
      `Attendees: ${attendeesLine}`,
      ``,
      `---`,
      ``,
    ].join('\n');

    if (p.summary || p.action_items?.length) {
      const parts: string[] = [];
      if (p.summary) parts.push('## Summary', '', p.summary, '');
      if (p.action_items?.length) {
        parts.push('## Action Items', '', ...p.action_items.map((i) => `- ${i}`), '');
      }
      parts.push('## Transcript', '', p.transcript);
      return header + parts.join('\n');
    }
    return header + p.transcript;
  }
}
