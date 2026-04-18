import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { calendar_v3 } from '@googleapis/calendar';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleAuthService } from './google-auth.service';
import {
  CreateEventParams,
  FreeBusyParams,
  BusySlot,
} from '../calendar.types';

/**
 * Manages Google Calendar event creation and freeBusy queries.
 * Persists calendar event records locally in the CalendarEvent table.
 */
@Injectable()
export class CalendarService implements OnModuleInit {
  private readonly logger = new Logger(CalendarService.name);
  private calendarApi!: calendar_v3.Calendar;

  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.calendarApi = new calendar_v3.Calendar({
      auth: this.googleAuth.getClient() as unknown as OAuth2Client,
    });
    this.logger.log('Google Calendar API client initialized');
  }

  /**
   * Creates a Google Calendar event and persists it in the local database.
   */
  async createEvent(
    params: CreateEventParams,
  ): Promise<calendar_v3.Schema$Event> {
    const hasAttendees =
      params.attendeeEmails && params.attendeeEmails.length > 0;

    const eventResource: calendar_v3.Schema$Event = {
      summary: params.summary,
      description: params.description,
      start: {
        dateTime: params.startTime.toISOString(),
        timeZone: params.timezone,
      },
      end: {
        dateTime: params.endTime.toISOString(),
        timeZone: params.timezone,
      },
      attendees: hasAttendees
        ? params.attendeeEmails!.map((email) => ({ email }))
        : undefined,
    };

    const result = await this.calendarApi.events.insert({
      calendarId: params.calendarId,
      requestBody: eventResource,
      sendUpdates: hasAttendees ? 'all' : 'none',
    });

    const googleEventId = result.data.id;

    if (googleEventId) {
      await this.prisma.calendarEvent.create({
        data: {
          taskId: params.taskId ?? null,
          googleEventId,
          calendarId: params.calendarId,
          title: params.summary,
          startsAt: params.startTime,
          endsAt: params.endTime,
          attendeeEmails: params.attendeeEmails ?? [],
        },
      });

      this.logger.log(
        `Calendar event created: ${googleEventId}${params.taskId ? ` for task ${params.taskId}` : ' (direct booking)'}`,
      );
    }

    return result.data;
  }

  /**
   * Queries the Google Calendar freeBusy API to find busy slots in a time range.
   * Merges busy slots across all provided calendar IDs.
   */
  async queryFreeBusy(params: FreeBusyParams): Promise<BusySlot[]> {
    const result = await this.calendarApi.freebusy.query({
      requestBody: {
        timeMin: params.startDate.toISOString(),
        timeMax: params.endDate.toISOString(),
        timeZone: params.timezone,
        items: params.calendarIds.map((id) => ({ id })),
      },
    });

    const allBusy: BusySlot[] = [];
    for (const calId of params.calendarIds) {
      const slots = result.data.calendars?.[calId]?.busy ?? [];
      for (const slot of slots) {
        allBusy.push({ start: new Date(slot.start!), end: new Date(slot.end!) });
      }
    }

    // Sort by start time for correct overlap detection
    allBusy.sort((a, b) => a.start.getTime() - b.start.getTime());
    return allBusy;
  }
}
