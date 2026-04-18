import { z } from 'zod';

// --- Interfaces for service method params ---

export interface CreateEventParams {
  calendarId: string;
  summary: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  attendeeEmails?: string[];
  taskId?: string;
}

export interface FreeBusyParams {
  calendarIds: string[];
  startDate: Date;
  endDate: Date;
  timezone: string;
}

export interface BusySlot {
  start: Date;
  end: Date;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface ContactResolutionResult {
  resolved: Array<{ name: string; email: string }>;
  unresolved: string[];
}

export interface TimeBlockSuggestion {
  slot: TimeSlot;
  label: string; // Human-readable label e.g. "Mon Feb 28, 9:00 AM - 11:00 AM"
}

// --- Zod schemas for LLM structured output ---

export const CalendarExtractionSchema = z.object({
  person_names: z.array(z.string()),
  estimated_hours: z.number().nullable(),
  is_meeting: z.boolean(),
});

export type CalendarExtractionResult = z.infer<
  typeof CalendarExtractionSchema
>;

// --- Direct calendar booking extraction (bypasses task creation) ---

export const DirectCalendarExtractionSchema = z.object({
  summary: z.string(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  duration_minutes: z.number().nullable(),
  person_names: z.array(z.string()),
  workspace: z.enum(['work', 'personal']).nullable(),
  is_all_day: z.boolean(),
});

export type DirectCalendarExtractionResult = z.infer<
  typeof DirectCalendarExtractionSchema
>;
