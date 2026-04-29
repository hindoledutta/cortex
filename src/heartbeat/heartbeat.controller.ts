import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { SharedSecretGuard } from '../auth/shared-secret.guard';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatPayloadSchema } from './heartbeat.types';

@Controller('api/heartbeat')
@UseGuards(SharedSecretGuard)
export class HeartbeatController {
  private readonly logger = new Logger(HeartbeatController.name);
  constructor(private readonly heartbeat: HeartbeatService) {}

  @Post()
  async ingest(@Body() body: unknown) {
    const parsed = HeartbeatPayloadSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`Invalid heartbeat payload: ${JSON.stringify(parsed.error.flatten())}`);
      throw new BadRequestException({ errors: parsed.error.flatten() });
    }
    const result = await this.heartbeat.upsert(parsed.data);
    return { ok: true as const, last_seen_at: result.lastSeenAt.toISOString() };
  }
}
