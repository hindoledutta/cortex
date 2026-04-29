import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../scheduler/notification.service';
import type { HeartbeatPayload } from './heartbeat.types';

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Upsert a heartbeat keyed by host. Always sets lastSeenAt = now().
   * Optional fields (version, lastIngestAt, queueDepth, lastError) overwrite if present.
   *
   * MEET-06 server-side escalation: on every upsert, compare incoming last_error
   * against the previously persisted lastError. On a transition (null → string,
   * or string → different string), fire NotificationService.sendUploadFailed exactly
   * once — fire-and-forget; failure does NOT fail the upsert. De-duped by exact string
   * equality, so repeated heartbeats with the same persistent error do not spam the user.
   */
  async upsert(p: HeartbeatPayload): Promise<{ host: string; lastSeenAt: Date }> {
    // Step 1: Read existing row to capture the previous lastError BEFORE overwriting.
    const existing = await this.prisma.heartbeat.findUnique({ where: { host: p.host } });
    const previousError: string | null = existing?.lastError ?? null;

    const now = new Date();
    const data = {
      host: p.host,
      version: p.version ?? null,
      lastSeenAt: now,
      lastIngestAt: p.last_ingest_at ? new Date(p.last_ingest_at) : null,
      queueDepth: p.queue_depth ?? null,
      lastError: p.last_error ?? null,
    };

    // Step 2: Persist.
    const row = await this.prisma.heartbeat.upsert({
      where: { host: p.host },
      create: data,
      update: data,
    });
    this.logger.log(`Heartbeat upserted host=${p.host} lastSeenAt=${now.toISOString()}`);

    // Step 3: MEET-06 escalation. Fire ONLY when incoming is non-null AND different from previous.
    const incomingError: string | null = p.last_error ?? null;
    if (incomingError !== null && incomingError !== previousError) {
      this.logger.warn(
        `MEET-06 escalation: host=${p.host} lastError transitioned (previous=${previousError === null ? 'null' : '<set>'}, incoming="${incomingError.slice(0, 80)}")`,
      );
      // Fire-and-forget. Telegram failure must NOT fail the heartbeat upsert.
      this.notifications
        .sendUploadFailed({ host: row.host, error: incomingError })
        .catch((err) =>
          this.logger.error(
            `sendUploadFailed failed for host=${p.host}: ${String(err)} (heartbeat row still persisted)`,
          ),
        );
    }

    return { host: row.host, lastSeenAt: row.lastSeenAt };
  }

  /** Find heartbeats whose lastSeenAt is older than `cutoff`. */
  async findStale(cutoff: Date) {
    return this.prisma.heartbeat.findMany({ where: { lastSeenAt: { lt: cutoff } } });
  }
}
