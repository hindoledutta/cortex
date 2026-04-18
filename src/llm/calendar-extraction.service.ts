import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from './llm.service';
import {
  CalendarExtractionSchema,
  CalendarExtractionResult,
} from '../calendar/calendar.types';

const SYSTEM_PROMPT =
  'You are analyzing a task to prepare for calendar scheduling. ' +
  'Extract any person names mentioned (these could be attendees for a meeting). ' +
  'Estimate how many hours this task will take to complete. ' +
  'Determine if this is a meeting (involving other people) or solo work. ' +
  'Return person_names as an array of full names, estimated_hours as a number (or null if uncertain), ' +
  'and is_meeting as a boolean.';

@Injectable()
export class CalendarExtractionService {
  private readonly logger = new Logger(CalendarExtractionService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Extract person names, effort estimate, and meeting flag from task context.
   * Uses Claude Sonnet for structured extraction.
   */
  async extract(
    taskTitle: string,
    taskDescription: string | null,
    subTaskTitles: string[],
  ): Promise<CalendarExtractionResult> {
    const contextParts = [`Task: ${taskTitle}`];
    if (taskDescription) {
      contextParts.push(`Description: ${taskDescription}`);
    }
    if (subTaskTitles.length > 0) {
      contextParts.push(`Sub-tasks: ${subTaskTitles.join(', ')}`);
    }

    const jsonSchema = z.toJSONSchema(CalendarExtractionSchema);

    const response = await this.llm.createMessage(
      'calendar-extraction',
      SYSTEM_PROMPT,
      [{ role: 'user', content: contextParts.join('\n') }],
      jsonSchema as Record<string, unknown>,
      256,
    );

    try {
      const parsed = JSON.parse(response.content);
      return CalendarExtractionSchema.parse(parsed);
    } catch (error) {
      this.logger.error(
        `Calendar extraction response validation failed: ${error}`,
      );
      this.logger.error(`Raw response: ${response.content}`);
      // Return safe defaults on parse failure
      return {
        person_names: [],
        estimated_hours: null,
        is_meeting: false,
      };
    }
  }
}
