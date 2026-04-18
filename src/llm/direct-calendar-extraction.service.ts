import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from './llm.service';
import {
  DirectCalendarExtractionSchema,
  DirectCalendarExtractionResult,
} from '../calendar/calendar.types';

const SYSTEM_PROMPT = `You are analyzing a message to extract calendar scheduling details.

The user wants to create a calendar event directly. Extract:
- summary: A concise event title (e.g., "Call with Jeet Sethia", "Team Sync", "Dentist appointment")
- date: The date in ISO format (YYYY-MM-DD). Use today's date context provided. If "tomorrow" is mentioned, compute it. If no date is mentioned, use today.
- time: The time in 24-hour format (HH:MM). If "5 PM" → "17:00". If no time is mentioned, return null.
- duration_minutes: Duration in minutes if explicitly mentioned (e.g., "30 minute call" → 30, "1 hour meeting" → 60). Return null if not specified.
- person_names: Array of full person names mentioned as attendees/participants. Do NOT include the user themselves.
- workspace: "work" if this is a professional meeting/call/sync, "personal" if it is a personal appointment/errand. null if truly ambiguous.
- is_all_day: true only if the user says "all day" or "block the day". false otherwise.

Work signals: calls with colleagues, client meetings, standups, syncs, reviews, 1:1s, planning sessions.
Personal signals: doctor, dentist, gym, family events, personal errands.

Return a JSON object matching the provided schema exactly.`;

@Injectable()
export class DirectCalendarExtractionService {
  private readonly logger = new Logger(DirectCalendarExtractionService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Extract scheduling details (summary, date, time, duration, attendees, workspace)
   * from a raw user message for direct calendar booking.
   */
  async extract(
    message: string,
    currentDate: string,
  ): Promise<DirectCalendarExtractionResult> {
    const jsonSchema = z.toJSONSchema(DirectCalendarExtractionSchema);

    const userContent = `Today's date: ${currentDate}\n\nUser message: ${message}`;

    const response = await this.llm.createMessage(
      'direct-calendar-extraction',
      SYSTEM_PROMPT,
      [{ role: 'user', content: userContent }],
      jsonSchema as Record<string, unknown>,
      512,
    );

    try {
      const parsed = JSON.parse(response.content);
      return DirectCalendarExtractionSchema.parse(parsed);
    } catch (error) {
      this.logger.error(
        `Direct calendar extraction validation failed: ${error}`,
      );
      this.logger.error(`Raw response: ${response.content}`);
      throw error;
    }
  }
}
