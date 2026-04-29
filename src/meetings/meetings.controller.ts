import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { SharedSecretGuard } from '../auth/shared-secret.guard';
import { MeetingsService } from './meetings.service';
import { IngestPayloadSchema } from './meetings.types';

@Controller('api/meetings')
@UseGuards(SharedSecretGuard)
export class MeetingsController {
  private readonly logger = new Logger(MeetingsController.name);
  constructor(private readonly meetings: MeetingsService) {}

  @Post('ingest')
  async ingest(@Body() body: unknown) {
    const parsed = IngestPayloadSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`Invalid ingest payload: ${JSON.stringify(parsed.error.flatten())}`);
      throw new BadRequestException({ errors: parsed.error.flatten() });
    }
    return this.meetings.ingest(parsed.data);
  }
}
