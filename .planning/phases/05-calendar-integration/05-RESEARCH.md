# Phase 5: Calendar Integration - Research

**Researched:** 2026-02-28
**Domain:** Google Calendar API, OAuth2 authentication, contacts directory, time-block scheduling
**Confidence:** HIGH

## Summary

Phase 5 adds Google Calendar integration to Cortex, enabling the user to create calendar events from tasks, resolve attendee emails from a contacts directory, and receive time-block suggestions based on task deadlines and effort estimates. This phase depends on Phase 3 (Telegram Interface) being complete, which it is -- the OrchestratorService and inline keyboard patterns are already established and will be extended.

The integration involves three distinct capabilities: (1) Google Calendar event creation via the `@googleapis/calendar` standalone npm package with OAuth2 authentication using a one-time-setup refresh token, (2) a contacts directory backed by a new `Contact` Prisma model with LLM-powered name extraction from task context, and (3) time-block suggestion logic that queries Google Calendar's freeBusy API to find open slots. The existing LLM pipeline (Sonnet for structured extraction) will be reused for parsing calendar intent, extracting person names, and generating effort estimates.

The HLD (docs/hld.md) specifies the data models (`Contact`, `CalendarEvent`), the user flow (Flow 4: Calendar Blocking), and integration details (OAuth 2.0 with offline refresh token, `calendar.events` scope, one Google Calendar ID per workspace). The current Prisma schema needs two new models and one new field on `Workspace` (`googleCalendarId`).

**Primary recommendation:** Use `@googleapis/calendar` v14.x (standalone subpackage, not the monolithic `googleapis`) with `google-auth-library` for OAuth2. Store the refresh token as an environment variable (`GOOGLE_REFRESH_TOKEN`). Add `Contact` and `CalendarEvent` models to Prisma. Create a `CalendarModule` with `GoogleAuthService`, `CalendarService`, `ContactService`, and `TimeBlockService`. Extend the OrchestratorService to handle calendar-related flows triggered via inline keyboard buttons on tasks.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CAL-01 | System creates Google Calendar events from tasks with title, description, and attendees | `@googleapis/calendar` v14.x `events.insert()` creates events on `calendarId: 'primary'` (or workspace-specific calendar ID). Event resource maps: task.title -> summary, task.description -> description, resolved emails -> attendees[].email. OAuth2 with offline refresh token provides persistent auth. Triggered via new "Calendar" inline keyboard button on task messages. |
| CAL-02 | System maintains contacts directory (name -> email) and prompts for unknown stakeholders | New `Contact` Prisma model (name, email, workspaceId). LLM (Sonnet) extracts person names from task title/description via structured output. `ContactService.resolveByName()` does case-insensitive lookup. Unknown names trigger Telegram prompt asking for email; response stored in Contact table for future use. |
| CAL-03 | System suggests time blocks based on task deadline and estimated effort | LLM (Sonnet) estimates effort from task context (title, description, sub-task count). `TimeBlockService` queries Google Calendar freeBusy API to find open slots between now and deadline. Suggests 1-3 time blocks via Telegram message with accept/dismiss inline keyboard buttons. Accepted blocks create calendar events via CAL-01 flow. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @googleapis/calendar | ^14 | Google Calendar API v3 client for Node.js | Official Google standalone subpackage; lighter than monolithic `googleapis` (~150 packages); TypeScript types included; supports events.insert, events.list, freebusy.query |
| google-auth-library | ^10 | OAuth2 authentication for Google APIs | Official Google auth library; handles token refresh automatically; `OAuth2Client` accepts client_id, client_secret, refresh_token; used by @googleapis/calendar internally |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | All other dependencies already in project | `@anthropic-ai/sdk` (LLM calls), `ioredis` (session state), `@prisma/client` (database), `@nestjs/config` (env vars), `nestjs-telegraf` + `telegraf` (Telegram interface) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @googleapis/calendar | googleapis (monolithic) | Monolithic package includes all 200+ Google APIs; ~10MB install vs ~2MB for standalone calendar; same API surface for calendar operations |
| OAuth2 refresh token in env var | Service account | Service accounts cannot access personal Google Calendars directly -- they access their own calendar or require Google Workspace domain-wide delegation. OAuth2 with refresh token is correct for personal calendar access. |
| Prisma Contact model | Google Contacts/People API | Google Contacts API adds another OAuth scope and API surface; a simple local table is sufficient for name -> email mapping in a single-user app; avoids dependency on Google's contact data structure |

**Installation:**
```bash
npm install @googleapis/calendar google-auth-library
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── calendar/                        # New CalendarModule
│   ├── calendar.module.ts           # Module: imports ConfigModule, PrismaModule, LlmModule
│   ├── services/
│   │   ├── google-auth.service.ts   # OAuth2Client setup, token management
│   │   ├── calendar.service.ts      # Event CRUD (insert, list, delete), freeBusy query
│   │   ├── contact.service.ts       # Contact directory CRUD, name resolution
│   │   └── time-block.service.ts    # Effort estimation, slot finding, suggestion formatting
│   └── calendar.types.ts            # DTOs, interfaces, Zod schemas
├── prisma/
│   └── schema.prisma                # Add Contact, CalendarEvent models + Workspace.googleCalendarId
└── telegram/
    └── services/
        └── orchestrator.service.ts  # Extended: calendar button handler, contact prompt flow
```

### Pattern 1: OAuth2 One-Time Setup with Refresh Token
**What:** For a single-user personal app, perform the OAuth2 consent flow once (browser-based), obtain a refresh token, and store it as an environment variable. The `google-auth-library` OAuth2Client automatically refreshes access tokens using the stored refresh token.
**When to use:** Single-user server-side applications that need persistent Google API access without repeated user consent.
**Example:**
```typescript
// Source: Google OAuth2 official docs + google-auth-library npm
import { OAuth2Client } from 'google-auth-library';

// One-time setup script (run locally, not in production):
// 1. Create OAuth credentials in Google Cloud Console (Desktop app type)
// 2. Run authorization URL in browser, get auth code
// 3. Exchange code for tokens, save refresh_token to env

// Production service:
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// Access tokens are auto-refreshed when expired
```

### Pattern 2: Calendar Event Creation from Task Context
**What:** Map task fields to Google Calendar event resource fields and create an event using `events.insert()`.
**When to use:** When user triggers calendar event creation from a task via Telegram inline keyboard.
**Example:**
```typescript
// Source: Google Calendar API v3 events.insert reference
import { calendar_v3 } from '@googleapis/calendar';

const calendar = new calendar_v3.Calendar({ auth: oauth2Client });

const event: calendar_v3.Schema$Event = {
  summary: task.title,
  description: task.description ?? undefined,
  start: {
    dateTime: startTime.toISOString(),  // RFC3339
    timeZone: 'America/New_York',       // User's timezone from config
  },
  end: {
    dateTime: endTime.toISOString(),
    timeZone: 'America/New_York',
  },
  attendees: resolvedEmails.map(email => ({ email })),
};

const result = await calendar.events.insert({
  calendarId: workspace.googleCalendarId ?? 'primary',
  requestBody: event,
  sendUpdates: 'all',  // Notify attendees
});

// Store google_event_id for future reference
const googleEventId = result.data.id;
```

### Pattern 3: FreeBusy Query for Available Slots
**What:** Query the Google Calendar freeBusy API to find time windows where the user has no existing events, then suggest those slots for time blocking.
**When to use:** When generating time-block suggestions for a task with a deadline.
**Example:**
```typescript
// Source: Google Calendar API v3 freebusy.query reference
const freeBusyResult = await calendar.freebusy.query({
  requestBody: {
    timeMin: now.toISOString(),
    timeMax: deadline.toISOString(),
    timeZone: userTimezone,
    items: [{ id: calendarId }],
  },
});

const busySlots = freeBusyResult.data.calendars?.[calendarId]?.busy ?? [];

// Invert busy slots to find free windows within working hours
// Then filter by task's effort estimate to find suitable blocks
```

### Pattern 4: LLM-Powered Name Extraction and Effort Estimation
**What:** Use Claude Sonnet (via existing LlmService) with structured output to extract person names from task context and estimate effort hours.
**When to use:** When processing a task for calendar event creation -- extract attendee names and estimate duration.
**Example:**
```typescript
// Reuses existing LlmService pattern with Zod schema + structured output
const CalendarExtractionSchema = z.object({
  person_names: z.array(z.string()),      // Names mentioned in task context
  estimated_hours: z.number().nullable(),  // Effort estimate in hours
  is_meeting: z.boolean(),                 // Whether this looks like a meeting
});

// New LlmOperation: 'calendar-extraction' -> routes to Sonnet
```

### Pattern 5: Contact Resolution with Unknown-Name Prompt Flow
**What:** When task context mentions a person name, look up their email in the Contact table. If not found, prompt the user via Telegram and store the response for future use.
**When to use:** Before creating a calendar event with attendees.
**Example:**
```typescript
// ContactService
async resolveNames(names: string[]): Promise<{
  resolved: Array<{ name: string; email: string }>;
  unresolved: string[];
}> {
  const resolved = [];
  const unresolved = [];

  for (const name of names) {
    // Case-insensitive partial match
    const contact = await this.prisma.contact.findFirst({
      where: {
        name: { contains: name, mode: 'insensitive' },
      },
    });

    if (contact) {
      resolved.push({ name: contact.name, email: contact.email });
    } else {
      unresolved.push(name);
    }
  }

  return { resolved, unresolved };
}
```

### Anti-Patterns to Avoid
- **Don't use service accounts for personal calendar access:** Service accounts have their own calendar and cannot access a user's personal Google Calendar without Google Workspace domain-wide delegation. Use OAuth2 with refresh token instead.
- **Don't store access tokens:** Access tokens expire in ~1 hour. Only store the refresh token; the `google-auth-library` handles access token refresh automatically.
- **Don't call Google Calendar API synchronously in the Telegram handler:** Event creation can take 1-2 seconds. Show a "Creating event..." typing indicator first, then create the event and respond.
- **Don't hard-code timezone:** Store the user's timezone in configuration (environment variable or settings table). Use it for all date/time operations.
- **Don't over-engineer effort estimation:** Simple LLM prompt with task context is sufficient. The REQUIREMENTS.md explicitly states "AI auto-scheduling" is out of scope -- suggest blocks, let user decide.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth2 token refresh | Manual token refresh logic | `google-auth-library` OAuth2Client | Handles token expiry detection, automatic refresh, retry on 401, token caching |
| Google Calendar event creation | Raw HTTP calls to Calendar REST API | `@googleapis/calendar` | Type-safe client, handles pagination, error codes, request/response serialization |
| Person name extraction from text | Regex-based name detection | LLM (Sonnet) structured extraction | Names are contextual, varied formats (first name, full name, nicknames); LLM handles ambiguity |
| Effort estimation | Rule-based estimation | LLM (Sonnet) with task context | Effort depends on task semantics, not string patterns; LLM understands "prepare quarterly report" vs "send an email" |
| Timezone handling | Manual UTC offset math | Native `Date` + IANA timezone strings | Google Calendar API accepts IANA timezone strings directly in event start/end objects |

**Key insight:** The Google Calendar API client library handles the complex parts (auth, HTTP, pagination, types). The LLM handles the intelligence parts (name extraction, effort estimation). Custom code focuses on orchestration and user interaction flow.

## Common Pitfalls

### Pitfall 1: OAuth2 Refresh Token Not Returned on Re-Authorization
**What goes wrong:** Google only returns the refresh_token on the FIRST authorization. If you re-authorize, you only get an access_token.
**Why it happens:** Google's OAuth2 flow returns the refresh_token only when `prompt: 'consent'` AND `access_type: 'offline'` are set, and only the first time. Subsequent authorizations skip it.
**How to avoid:** During the one-time setup script, always set `access_type: 'offline'` and `prompt: 'consent'`. Save the refresh_token immediately. If lost, revoke app access at https://myaccount.google.com/permissions and re-authorize.
**Warning signs:** `invalid_grant` errors in production; access token stops refreshing.

### Pitfall 2: Google OAuth App in "Testing" Mode Token Expiry
**What goes wrong:** When the Google Cloud project's OAuth consent screen is in "Testing" status (not published), refresh tokens expire after 7 days.
**Why it happens:** Google enforces a 7-day expiry for testing-mode OAuth apps to prevent long-lived tokens in development.
**How to avoid:** Either publish the OAuth app (requires verification for sensitive scopes, but `calendar.events` is not sensitive) or move to "In production" status. For a personal app, publishing with "External" user type and adding your own email to the test users list works without full verification.
**Warning signs:** App works for a week then stops authenticating.

### Pitfall 3: Calendar ID Mismatch
**What goes wrong:** Using `'primary'` as calendar ID always targets the default calendar, ignoring workspace-specific calendars.
**Why it happens:** The HLD specifies "one Google Calendar ID per workspace" (work/personal), but the default value `'primary'` only hits the main calendar.
**How to avoid:** Store `googleCalendarId` on the Workspace model. Default to `'primary'` if not configured. Provide a Telegram command or settings flow to configure workspace-specific calendar IDs.
**Warning signs:** All events go to the same calendar regardless of workspace.

### Pitfall 4: Timezone Mismatches in Time-Block Suggestions
**What goes wrong:** Suggested time blocks show wrong times because the server timezone differs from the user's timezone.
**Why it happens:** Node.js `Date` objects use the server's timezone. Google Calendar API requires explicit timezone in event start/end.
**How to avoid:** Store the user's IANA timezone as a config value (e.g., `USER_TIMEZONE=America/New_York`). Pass it to all Google Calendar API calls and use it when formatting times for Telegram messages.
**Warning signs:** Events appear at wrong times on the calendar; freeBusy results don't match visible calendar availability.

### Pitfall 5: Concurrent Contact Resolution Prompts
**What goes wrong:** If a task mentions multiple unknown people, the bot sends multiple "What is X's email?" prompts simultaneously, confusing the user.
**Why it happens:** Attempting to resolve all unknown names in parallel results in multiple interleaved prompts.
**How to avoid:** Queue unknown contact prompts sequentially. Ask for one email at a time, then proceed to the next. Use session state to track pending contact resolutions.
**Warning signs:** User gets bombarded with multiple email prompts; replies get associated with the wrong contact.

## Code Examples

Verified patterns from official sources:

### Google Auth Service (NestJS Provider)
```typescript
// Source: google-auth-library npm + NestJS ConfigService pattern
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class GoogleAuthService implements OnModuleInit {
  private oauth2Client: OAuth2Client;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.oauth2Client = new OAuth2Client(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
    );

    this.oauth2Client.setCredentials({
      refresh_token: this.config.get<string>('GOOGLE_REFRESH_TOKEN'),
    });
  }

  getClient(): OAuth2Client {
    return this.oauth2Client;
  }
}
```

### Calendar Event Insert
```typescript
// Source: Google Calendar API v3 events.insert reference
import { Injectable, Logger } from '@nestjs/common';
import { calendar_v3, auth } from '@googleapis/calendar';
import { GoogleAuthService } from './google-auth.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CalendarService {
  private calendar: calendar_v3.Calendar;
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly googleAuth: GoogleAuthService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.calendar = new calendar_v3.Calendar({
      auth: this.googleAuth.getClient() as unknown as auth.OAuth2Client,
    });
  }

  async createEvent(params: {
    calendarId: string;
    summary: string;
    description?: string;
    startTime: Date;
    endTime: Date;
    timezone: string;
    attendeeEmails?: string[];
    taskId: string;
  }) {
    const event: calendar_v3.Schema$Event = {
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
      attendees: params.attendeeEmails?.map(email => ({ email })),
    };

    const result = await this.calendar.events.insert({
      calendarId: params.calendarId,
      requestBody: event,
      sendUpdates: params.attendeeEmails?.length ? 'all' : 'none',
    });

    // Persist to local CalendarEvent table
    await this.prisma.calendarEvent.create({
      data: {
        taskId: params.taskId,
        googleEventId: result.data.id!,
        calendarId: params.calendarId,
        title: params.summary,
        startsAt: params.startTime,
        endsAt: params.endTime,
        attendeeEmails: params.attendeeEmails ?? [],
      },
    });

    this.logger.log(`Created calendar event: ${result.data.id}`);
    return result.data;
  }
}
```

### FreeBusy Query for Available Slots
```typescript
// Source: Google Calendar API v3 freebusy.query reference
async findAvailableSlots(params: {
  calendarId: string;
  startDate: Date;
  endDate: Date;
  timezone: string;
  durationMinutes: number;
  workingHoursStart: number;  // e.g., 9 for 9am
  workingHoursEnd: number;    // e.g., 17 for 5pm
}): Promise<Array<{ start: Date; end: Date }>> {
  const result = await this.calendar.freebusy.query({
    requestBody: {
      timeMin: params.startDate.toISOString(),
      timeMax: params.endDate.toISOString(),
      timeZone: params.timezone,
      items: [{ id: params.calendarId }],
    },
  });

  const busySlots = result.data.calendars?.[params.calendarId]?.busy ?? [];

  // Generate candidate slots during working hours, excluding busy periods
  // This is simplified -- actual implementation would iterate day by day
  const candidates: Array<{ start: Date; end: Date }> = [];

  // ... slot generation logic (iterate business days,
  //     split into duration-sized windows,
  //     exclude overlaps with busySlots)

  return candidates.slice(0, 3); // Return top 3 suggestions
}
```

### Prisma Schema Additions
```prisma
// New models for Phase 5

model Contact {
  id          String         @id @default(uuid())
  name        String
  email       String
  workspaceId String?        @map("workspace_id")
  workspace   Workspace?     @relation(fields: [workspaceId], references: [id])
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  @@unique([name, workspaceId])
  @@index([name])
  @@map("contacts")
}

model CalendarEvent {
  id              String   @id @default(uuid())
  taskId          String   @map("task_id")
  task            Task     @relation(fields: [taskId], references: [id])
  googleEventId   String   @map("google_event_id")
  calendarId      String   @map("calendar_id")
  title           String
  startsAt        DateTime @map("starts_at")
  endsAt          DateTime @map("ends_at")
  attendeeEmails  String[] @map("attendee_emails")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([taskId])
  @@index([googleEventId])
  @@map("calendar_events")
}

// Add to existing Workspace model:
// googleCalendarId  String?  @map("google_calendar_id")

// Add to existing Task model:
// calendarEvents    CalendarEvent[]
// estimatedEffort   Int?     @map("estimated_effort")  // in minutes
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `googleapis` monolithic package (100+ MB) | `@googleapis/calendar` standalone subpackage (~2MB) | 2023+ | Smaller installs, faster builds, tree-shakeable |
| Manual token refresh polling | `google-auth-library` auto-refresh on OAuth2Client | Stable since v5+ | Set credentials once, library handles refresh transparently |
| Custom NER for name extraction | LLM zero-shot structured extraction | 2024+ | No training data needed, handles varied name formats, multilingual |

**Deprecated/outdated:**
- `googleapis` v80-90 era patterns with callback-based auth are fully superseded by promise-based OAuth2Client in v100+
- `@google-cloud/local-auth` is for local CLI tools (interactive browser flow); not needed in a server app with pre-stored refresh token

## Open Questions

1. **Google Cloud Project OAuth Verification**
   - What we know: The `calendar.events` scope is not listed as "sensitive" by Google, meaning no full verification review is needed. Publishing the app as "External" should work for personal use.
   - What's unclear: Whether Fly.io's IP addresses could trigger Google's abuse detection for OAuth token refresh.
   - Recommendation: Set up OAuth credentials with "Desktop app" type (simpler flow), generate refresh token locally, store in env. Monitor for `invalid_grant` errors.

2. **Workspace-Specific Calendar IDs**
   - What we know: The HLD specifies one Google Calendar per workspace. The user may have separate "Work" and "Personal" Google Calendars.
   - What's unclear: How the user will configure which Google Calendar maps to which workspace.
   - Recommendation: Default to `'primary'` for both. Add a simple `/settings calendar <workspace> <calendarId>` command or store in env vars (`GOOGLE_CALENDAR_WORK`, `GOOGLE_CALENDAR_PERSONAL`). Start with env vars for v1 simplicity.

3. **Effort Estimation Accuracy**
   - What we know: LLM can provide rough effort estimates from task context. The REQUIREMENTS.md explicitly excludes "AI auto-scheduling" -- we only suggest, user decides.
   - What's unclear: How accurate Sonnet's effort estimates will be without historical data.
   - Recommendation: Have the LLM provide a range (e.g., "1-2 hours") with a default. User can override via follow-up. Track actual vs estimated over time as a future improvement.

4. **One-Time OAuth Setup Script**
   - What we know: A one-time browser-based OAuth2 consent flow is needed to obtain the refresh token.
   - What's unclear: Whether to include a setup script in the repo or document manual steps.
   - Recommendation: Include a `scripts/google-oauth-setup.ts` script that generates the auth URL, starts a local server to capture the callback, exchanges the code for tokens, and prints the refresh token for the user to add to `.env`.

## Sources

### Primary (HIGH confidence)
- [Google Calendar API v3 Events.insert Reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) - Event creation fields, required/optional params, attendees structure, scopes
- [Google Calendar API Scopes](https://developers.google.com/workspace/calendar/api/auth) - All available scopes, `calendar.events` vs `calendar` vs `calendar.readonly`
- [Google Calendar API v3 FreeBusy.query Reference](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) - Request/response structure, busy slot format
- [Google Calendar API Node.js Quickstart](https://developers.google.com/workspace/calendar/api/quickstart/nodejs) - OAuth2 setup, googleapis package usage
- [Google OAuth2 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) - Refresh token flow, `access_type: 'offline'`
- [@googleapis/calendar npm package](https://www.npmjs.com/package/@googleapis/calendar) - v14.x standalone subpackage, 23 dependents
- [google-auth-library npm package](https://www.npmjs.com/package/google-auth-library) - v10.x, OAuth2Client auto-refresh

### Secondary (MEDIUM confidence)
- [Google OAuth2 Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) - Token storage, security recommendations
- [Integrating Google Calendar with OAuth2 in Node.js](https://dev.to/divofred/integrating-google-calendar-with-oauth2-in-nodejs-530i) - Community implementation patterns, confirmed compatible with OAuth2Client approach
- [Google OAuth2 Refresh Token Explained](https://medium.com/starthinker/google-oauth-2-0-access-token-and-refresh-token-explained-cccf2fc0a6d9) - Token lifecycle, 7-day testing mode limitation

### Tertiary (LOW confidence)
- Time-blocking algorithm specifics were synthesized from productivity methodology articles; the actual slot-finding algorithm is straightforward interval complement logic.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - `@googleapis/calendar` and `google-auth-library` are official Google packages, well-documented, actively maintained (updated within last 3 weeks)
- Architecture: HIGH - Follows established NestJS module patterns already proven in Phases 1-3; HLD provides detailed data models and user flows
- Pitfalls: HIGH - OAuth2 token handling pitfalls are extensively documented in Google's official docs and community sources; confirmed by multiple independent sources

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable domain, Google Calendar API v3 has been stable for years)
