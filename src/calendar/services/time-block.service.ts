import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CalendarService } from './calendar.service';
import { BusySlot, TimeSlot, TimeBlockSuggestion } from '../calendar.types';

/**
 * Suggests available time blocks for tasks based on calendar availability.
 * Queries Google Calendar freeBusy API to avoid conflicts, respects working hours,
 * and skips weekends.
 */
@Injectable()
export class TimeBlockService {
  private readonly logger = new Logger(TimeBlockService.name);

  constructor(
    private readonly calendarService: CalendarService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Suggests up to 3 available time blocks within working hours before a deadline.
   * Returns empty array if no slots are available.
   */
  async suggestTimeBlocks(params: {
    calendarId: string;
    deadline: Date;
    effortMinutes: number;
    timezone: string;
  }): Promise<TimeBlockSuggestion[]> {
    const workStart = this.config.get<number>('WORKING_HOURS_START', 9.5);
    const workEnd = this.config.get<number>('WORKING_HOURS_END', 20);

    const now = new Date();
    if (now >= params.deadline) {
      this.logger.warn('Deadline is in the past, cannot suggest time blocks');
      return [];
    }

    // Build list of all calendar IDs to check for availability
    const calendarIdsStr = this.config.get<string>('GOOGLE_CALENDAR_IDS', '');
    const allCalendarIds = calendarIdsStr
      ? calendarIdsStr.split(',').map((id) => id.trim())
      : [params.calendarId];

    // Query busy slots across all calendars
    const busySlots = await this.calendarService.queryFreeBusy({
      calendarIds: allCalendarIds,
      startDate: now,
      endDate: params.deadline,
      timezone: params.timezone,
    });

    // Generate candidate slots day by day
    const suggestions: TimeBlockSuggestion[] = [];
    const effortMs = params.effortMinutes * 60 * 1000;

    const currentDay = new Date(now);
    currentDay.setHours(0, 0, 0, 0);

    while (currentDay < params.deadline && suggestions.length < 3) {
      const dayOfWeek = currentDay.getDay();

      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDay.setDate(currentDay.getDate() + 1);
        continue;
      }

      // Build working hours window for this day (supports fractional hours, e.g. 9.5 = 9:30)
      const dayStart = new Date(currentDay);
      dayStart.setHours(Math.floor(workStart), (workStart % 1) * 60, 0, 0);

      const dayEnd = new Date(currentDay);
      dayEnd.setHours(Math.floor(workEnd), (workEnd % 1) * 60, 0, 0);

      // Adjust for today: don't suggest past times
      const effectiveStart = dayStart < now ? now : dayStart;

      // Round up to next 30-min boundary
      const roundedStart = new Date(effectiveStart);
      const minutes = roundedStart.getMinutes();
      if (minutes > 0 && minutes <= 30) {
        roundedStart.setMinutes(30, 0, 0);
      } else if (minutes > 30) {
        roundedStart.setHours(roundedStart.getHours() + 1, 0, 0, 0);
      }

      // Try each 30-minute increment as a slot start
      const slotStart = new Date(roundedStart);
      while (slotStart.getTime() + effortMs <= dayEnd.getTime()) {
        if (slotStart.getTime() + effortMs > params.deadline.getTime()) {
          break;
        }

        const candidateSlot: TimeSlot = {
          start: new Date(slotStart),
          end: new Date(slotStart.getTime() + effortMs),
        };

        if (!this.overlaps(candidateSlot, busySlots)) {
          suggestions.push({
            slot: candidateSlot,
            label: this.formatLabel(candidateSlot, params.timezone),
          });

          if (suggestions.length >= 3) {
            break;
          }

          // Skip past this slot to find non-adjacent suggestions
          slotStart.setTime(slotStart.getTime() + effortMs);
        }

        slotStart.setMinutes(slotStart.getMinutes() + 30);
      }

      currentDay.setDate(currentDay.getDate() + 1);
    }

    this.logger.log(
      `Generated ${suggestions.length} time block suggestions for ${params.effortMinutes}min effort`,
    );

    return suggestions;
  }

  /**
   * Check if a candidate slot overlaps with any busy slot.
   */
  private overlaps(slot: TimeSlot, busySlots: BusySlot[]): boolean {
    return busySlots.some(
      (busy) => slot.start < busy.end && slot.end > busy.start,
    );
  }

  /**
   * Format a time slot into a human-readable label.
   * Example: "Mon Mar 2, 9:00 AM - 11:00 AM"
   */
  private formatLabel(slot: TimeSlot, timezone: string): string {
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    });

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });

    const dateStr = dateFormatter.format(slot.start);
    const startTime = timeFormatter.format(slot.start);
    const endTime = timeFormatter.format(slot.end);

    return `${dateStr}, ${startTime} - ${endTime}`;
  }
}
