import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Manages user settings with upsert defaults.
 *
 * Uses a single-row table with id="default" (single-user app).
 * get() auto-creates the row with defaults if it doesn't exist.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get settings, creating with defaults if none exist.
   */
  async get() {
    return this.prisma.settings.upsert({
      where: { id: 'default' },
      create: {},
      update: {},
    });
  }

  /**
   * Update settings with partial data. Creates row if missing.
   */
  async update(data: {
    reminderLeadMinutes?: number;
    checkInAfterDays?: number;
    notificationHourUtc?: number;
  }) {
    return this.prisma.settings.upsert({
      where: { id: 'default' },
      create: { ...data },
      update: data,
    });
  }
}
