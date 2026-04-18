# Phase 4: Proactive Management - Research

**Researched:** 2026-02-28
**Domain:** Background job scheduling, Telegram proactive messaging, deadline/check-in/deferred-task notification systems
**Confidence:** HIGH

## Summary

Phase 4 adds three proactive notification capabilities to Cortex: deadline reminders, stale-task check-ins, and deferred-task resurfacing. All three follow the same fundamental pattern: a background process identifies tasks needing attention based on time-based criteria, then sends a Telegram message to the bot owner with task context and action buttons.

The existing codebase already has the necessary schema fields (`deadline`, `deferredUntil`, `updatedAt` on tasks), the Telegram bot infrastructure (via nestjs-telegraf + Telegraf), and the message formatting service. What's missing is: (1) a scheduling/job system to trigger checks, (2) a notification service that queries for eligible tasks and sends messages, and (3) a user settings model for configurable lead times and check-in thresholds.

There are two viable approaches for the scheduling layer: **pg-boss** (PostgreSQL-backed job queue, already recommended in the roadmap decision) and **@nestjs/schedule** (cron-based in-process scheduling). For a single-user system with low job volume, the simpler approach is `@nestjs/schedule` with cron-based database polling. However, pg-boss provides persistence, exactly-once delivery, and per-task scheduled jobs (via `startAfter`), which are better suited for deadline reminders that need task-specific timing. The recommendation is a **hybrid approach**: use `@nestjs/schedule` for periodic polling (check-ins, deferred resurfacing) and pg-boss for task-specific deadline reminders that fire at precise times.

**Primary recommendation:** Use pg-boss (v12.x) for scheduled deadline reminder jobs with per-task timing via `startAfter`, supplemented by `@nestjs/schedule` cron jobs for periodic polling of stale tasks and deferred tasks. Inject the Telegraf bot via `@InjectBot()` in a NotificationService to send proactive messages by chatId. Add a Settings model to Prisma for configurable reminder lead time and check-in threshold.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROD-01 | System sends deadline reminders via Telegram with configurable lead time | pg-boss `send()` with `startAfter` option schedules a job at `deadline - leadTime`; NotificationService sends formatted Telegram message via `@InjectBot()` + `bot.telegram.sendMessage(chatId, ...)`; lead time stored in Settings model (per-task override via `reminderLeadMinutes` field on Task, global default in Settings) |
| PROD-02 | System prompts check-in for tasks in_progress for more than N days without updates | `@nestjs/schedule` `@Cron()` runs every morning (e.g., 9 AM); queries tasks with `status = in_progress AND updatedAt < NOW() - interval N days`; N is configurable in Settings model; sends check-in prompt via NotificationService |
| PROD-03 | System resurfaces deferred tasks on their resume date | `@nestjs/schedule` `@Cron()` runs daily; queries tasks with `status = deferred AND deferredUntil <= NOW() AND deferredUntil IS NOT NULL`; transitions task to `active` and sends resurface notification via NotificationService |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pg-boss | ^12.13 | PostgreSQL-backed job queue for scheduled deadline reminders | Already uses PostgreSQL (Neon); no additional infrastructure; exactly-once delivery; `startAfter` for precise timing; persistent across restarts; roadmap decision recommends pg-boss over BullMQ |
| @nestjs/schedule | ^5.x | Cron-based periodic task polling | Official NestJS package; lightweight; no additional dependencies; `@Cron()` decorator for declarative scheduling; `SchedulerRegistry` for dynamic control |
| nestjs-telegraf | 2.9.1 | Telegram bot framework (already installed) | Already in use; `@InjectBot()` decorator provides bot instance for proactive messaging outside handlers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cron | ^3.x | Peer dependency of @nestjs/schedule | Installed automatically; provides cron expression parsing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pg-boss | @nestjs/schedule only (cron polling for everything) | Simpler setup, but deadline reminders lose precision -- polling interval becomes the minimum granularity (e.g., check every 5 minutes = up to 5 min late). For a single user this may be acceptable, but pg-boss provides exact timing |
| pg-boss | graphile-worker | Also PostgreSQL-based; similar capabilities but heavier, more suited to complex workflows; pg-boss is simpler for this use case |
| pg-boss | BullMQ | Roadmap decision already ruled this out -- Upstash Redis free tier is incompatible with BullMQ's connection patterns and incurs high per-request costs from background polling |
| Hybrid (pg-boss + @nestjs/schedule) | pg-boss only | Could use pg-boss `schedule()` for cron-like recurring jobs too, but adds complexity for simple daily checks that don't need persistence guarantees |

**Installation:**
```bash
npm install pg-boss @nestjs/schedule
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── scheduler/                  # NEW: Scheduling and notification module
│   ├── scheduler.module.ts     # ScheduleModule + pg-boss setup
│   ├── scheduler.service.ts    # pg-boss lifecycle (start/stop/work)
│   ├── notification.service.ts # Sends Telegram messages via @InjectBot()
│   ├── reminder.service.ts     # Deadline reminder job creation/cancellation
│   ├── polling.service.ts      # Cron-based check-in + deferred polling
│   └── dto/
│       └── reminder-job.dto.ts # Job payload types
├── settings/                   # NEW: User settings module
│   ├── settings.module.ts
│   └── settings.service.ts     # CRUD for reminder/check-in preferences
├── task/                       # EXISTING: Add reminder scheduling hooks
│   └── task.service.ts         # Modified: trigger reminder job on deadline set/change
└── telegram/                   # EXISTING: No changes needed
    └── ...
```

### Pattern 1: pg-boss Deadline Reminder Jobs
**What:** When a task gets a deadline set (create or update), schedule a pg-boss job to fire at `deadline - leadTime`. If the deadline changes, cancel the old job and schedule a new one. If the task is completed or deleted, cancel the job.
**When to use:** PROD-01 -- every task with a non-null deadline
**Example:**
```typescript
// Source: pg-boss docs - send() with startAfter option
// https://github.com/timgit/pg-boss

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private boss: PgBoss;

  constructor(private readonly config: ConfigService) {
    this.boss = new PgBoss(this.config.getOrThrow<string>('DATABASE_URL'));
  }

  async onModuleInit() {
    await this.boss.start();
    await this.boss.createQueue('deadline-reminder');
    await this.boss.work('deadline-reminder', async (job) => {
      // Delegate to NotificationService
      await this.handleDeadlineReminder(job.data);
    });
  }

  async onModuleDestroy() {
    await this.boss.stop();
  }

  async scheduleDeadlineReminder(taskId: string, deadline: Date, leadMinutes: number) {
    const fireAt = new Date(deadline.getTime() - leadMinutes * 60 * 1000);

    // Cancel existing reminder for this task (singletonKey ensures uniqueness)
    await this.boss.send('deadline-reminder', { taskId }, {
      startAfter: fireAt.toISOString(),
      singletonKey: `deadline:${taskId}`,
      retryLimit: 2,
      expireInMinutes: 30,
    });
  }

  async cancelDeadlineReminder(taskId: string) {
    // pg-boss cancel by finding the job with singletonKey
    // Alternative: store jobId on task and cancel by ID
  }
}
```

### Pattern 2: Cron-Based Polling for Check-ins and Deferred Tasks
**What:** Use `@nestjs/schedule` `@Cron()` decorator to run periodic checks. Query the database for tasks matching criteria, then send notifications.
**When to use:** PROD-02 (stale check-ins) and PROD-03 (deferred resurfacing)
**Example:**
```typescript
// Source: @nestjs/schedule docs
// https://docs.nestjs.com/techniques/task-scheduling

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { SettingsService } from '../settings/settings.service';
import { TaskStatus } from '../../prisma/generated/prisma/client/enums';

@Injectable()
export class PollingService {
  private readonly logger = new Logger(PollingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
  ) {}

  // Run every day at 9:00 AM UTC
  @Cron('0 9 * * *')
  async checkStaleTasks() {
    const { checkInAfterDays } = await this.settings.get();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - checkInAfterDays);

    const staleTasks = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.in_progress,
        updatedAt: { lt: cutoff },
        deletedAt: null,
        parentId: null,  // Only check parent tasks
      },
    });

    for (const task of staleTasks) {
      await this.notifications.sendCheckInPrompt(task);
    }
  }

  // Run every day at 8:00 AM UTC
  @Cron('0 8 * * *')
  async resurfaceDeferredTasks() {
    const now = new Date();

    const deferredTasks = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.deferred,
        deferredUntil: { lte: now },
        deletedAt: null,
      },
    });

    for (const task of deferredTasks) {
      // Transition back to active
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.active, deferredUntil: null },
      });
      await this.notifications.sendDeferredResurface(task);
    }
  }
}
```

### Pattern 3: Proactive Telegram Messaging via @InjectBot()
**What:** Inject the Telegraf bot instance into a service to send messages without a request context. Use `bot.telegram.sendMessage(chatId, text, options)` with the owner's chat ID from config.
**When to use:** All three requirements -- any time the system needs to proactively message the user
**Example:**
```typescript
// Source: nestjs-telegraf @InjectBot pattern
// https://github.com/robot-mafia/nestjs-telegraf

import { Injectable } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf, Context, Markup } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { MessageFormatterService } from '../telegram/services/message-formatter.service';

@Injectable()
export class NotificationService {
  private readonly ownerChatId: number;

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly config: ConfigService,
    private readonly formatter: MessageFormatterService,
  ) {
    this.ownerChatId = this.config.getOrThrow<number>('OWNER_CHAT_ID');
  }

  async sendDeadlineReminder(task: { id: string; title: string; deadline: Date }) {
    const text = [
      `<b>Deadline Reminder</b>`,
      ``,
      `Task: <b>${this.escapeHtml(task.title)}</b>`,
      `Deadline: ${task.deadline.toLocaleDateString()}`,
    ].join('\n');

    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('Done', `task:done:${task.id}`),
      Markup.button.callback('Start', `task:start:${task.id}`),
      Markup.button.callback('Defer', `task:defer:${task.id}`),
    ]);

    await this.bot.telegram.sendMessage(this.ownerChatId, text, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  }
}
```

### Pattern 4: Settings Model for Configuration
**What:** Add a Settings model to the Prisma schema to store user preferences for reminder lead time and check-in thresholds. Since this is a single-user app, a simple key-value store or single-row table works.
**When to use:** All three requirements reference configurable parameters
**Example:**
```prisma
model Settings {
  id                    String   @id @default("default")
  reminderLeadMinutes   Int      @default(1440) // 24 hours = 1440 minutes
  checkInAfterDays      Int      @default(3)
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@map("settings")
}
```

### Anti-Patterns to Avoid
- **In-memory timers for reminders:** `setTimeout` or `setInterval` are lost on process restart. Never use for persistent scheduling -- use pg-boss or database-backed cron.
- **One pg-boss job per check-in poll:** Don't schedule individual pg-boss jobs for check-in polling. A daily cron is sufficient and avoids job table bloat.
- **Sending reminders for completed/deleted tasks:** Always re-validate task state when a job fires. The task may have been completed or deleted since the job was scheduled.
- **Blocking the cron handler:** Don't await all notifications sequentially in a large loop. For a single user this is fine, but the pattern should handle errors per-task (catch inside loop, not outside).
- **Hardcoding notification parameters:** Store lead times, check-in thresholds, and cron schedules in the Settings model or environment variables, not in code.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job scheduling with persistence | Custom setTimeout + database polling | pg-boss | Handles retries, exactly-once delivery, job state management, cleanup; decades of PostgreSQL reliability |
| Cron expression parsing | Custom date/time comparison logic | @nestjs/schedule (cron package) | Standard cron syntax, well-tested, handles edge cases (DST, leap years) |
| Telegram proactive messaging | Raw HTTP calls to Telegram API | Telegraf `bot.telegram.sendMessage()` via `@InjectBot()` | Already using Telegraf; handles rate limiting, error codes, retries |
| Job deduplication | Custom "last sent" timestamp columns | pg-boss `singletonKey` option | Prevents duplicate jobs for the same task; atomic at database level |

**Key insight:** The scheduling domain is deceptively complex -- timezone handling, missed job recovery, deduplication, and retry logic have well-known edge cases. pg-boss and @nestjs/schedule handle these; custom solutions will miss them.

## Common Pitfalls

### Pitfall 1: Stale Job Execution
**What goes wrong:** A deadline reminder job fires, but the task was already completed hours ago. The user gets a confusing "deadline approaching" notification for a done task.
**Why it happens:** Jobs are scheduled in advance; task state changes between scheduling and execution.
**How to avoid:** Always re-fetch the task from the database when the job executes. Check that `status` is still active/in_progress and `deletedAt` is null before sending the notification.
**Warning signs:** Users reporting phantom reminders for completed tasks.

### Pitfall 2: Missing Job Cancellation on Task Updates
**What goes wrong:** User changes a task's deadline from March 1 to March 15, but the old reminder still fires on Feb 28. Or user completes a task but still gets the reminder.
**Why it happens:** Reminder jobs weren't cancelled/rescheduled when the task was updated.
**How to avoid:** Hook into TaskService.update() -- whenever `deadline`, `status`, or `deletedAt` changes, cancel existing reminder jobs and reschedule if still applicable. pg-boss `singletonKey` helps: sending a new job with the same key replaces the old one.
**Warning signs:** Duplicate or outdated reminders.

### Pitfall 3: pg-boss Connection Competing with Prisma
**What goes wrong:** pg-boss opens its own PostgreSQL connection pool, potentially exhausting Neon's free-tier connection limits (which are low on serverless Postgres).
**Why it happens:** pg-boss creates its own connection pool separate from Prisma's.
**How to avoid:** Configure pg-boss with minimal pool size (`max: 2`). Neon free tier allows limited connections; keep total across Prisma + pg-boss under the limit. Use Neon's pooled connection string with PgBouncer for both.
**Warning signs:** "too many connections" errors in production.

### Pitfall 4: Timezone Confusion in Cron Schedules
**What goes wrong:** The daily check-in cron fires at 9 AM UTC, but the user is in a different timezone and gets notifications at an inconvenient time (e.g., 4 AM local).
**Why it happens:** `@nestjs/schedule` cron runs in the server's timezone (UTC on most cloud deployments).
**How to avoid:** Store the user's preferred notification timezone or time window in Settings. For v1 (single user), a `notificationHourUtc` setting in the Settings model is sufficient.
**Warning signs:** User complains about notification timing.

### Pitfall 5: Deferred Task Resurrection Without Notification
**What goes wrong:** A deferred task is moved to `active` by the cron job, but the Telegram notification fails (network error). The user never knows the task was resurfaced.
**Why it happens:** Status update and notification are not atomic -- one can succeed while the other fails.
**How to avoid:** Send the notification first, then update the status. If notification fails, leave the task deferred and retry on the next cron cycle. Alternatively, log the failure and the cron will pick it up again tomorrow.
**Warning signs:** Tasks silently moving from deferred to active without the user seeing them.

### Pitfall 6: Check-In Spam for Parent Tasks with Active Children
**What goes wrong:** A parent task with 5 sub-tasks triggers a check-in even though the user is actively working on sub-tasks (updating them regularly). The parent's `updatedAt` wasn't refreshed by child updates.
**Why it happens:** `updatedAt` on the parent is only set when the parent itself is updated, not when children change.
**How to avoid:** When checking for stale tasks, also check if any children have been recently updated. Query: `status = in_progress AND updatedAt < cutoff AND NOT EXISTS (children with updatedAt >= cutoff)`.
**Warning signs:** Frequent check-in prompts for tasks the user is actively working on.

## Code Examples

Verified patterns from official sources:

### pg-boss Setup with NestJS Lifecycle
```typescript
// Source: pg-boss README + NestJS lifecycle hooks
// https://github.com/timgit/pg-boss

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  readonly boss: PgBoss;

  constructor(private readonly config: ConfigService) {
    this.boss = new PgBoss({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      max: 2,                    // Minimal pool size for Neon free tier
      retentionDays: 7,          // Clean up completed jobs after 7 days
      archiveCompletedAfterSeconds: 3600, // Archive completed jobs after 1 hour
    });
  }

  async onModuleInit() {
    this.boss.on('error', (error) => this.logger.error('pg-boss error', error));
    await this.boss.start();
    this.logger.log('pg-boss started');
  }

  async onModuleDestroy() {
    await this.boss.stop({ graceful: true });
    this.logger.log('pg-boss stopped');
  }
}
```

### Scheduling a Deadline Reminder with singletonKey
```typescript
// Source: pg-boss send() API
// https://github.com/timgit/pg-boss

async scheduleDeadlineReminder(
  taskId: string,
  deadline: Date,
  leadMinutes: number,
): Promise<string | null> {
  const fireAt = new Date(deadline.getTime() - leadMinutes * 60 * 1000);

  // If fireAt is in the past, send immediately
  const startAfter = fireAt > new Date() ? fireAt.toISOString() : undefined;

  const jobId = await this.boss.send(
    'deadline-reminder',
    { taskId },
    {
      startAfter,
      singletonKey: `deadline:${taskId}`,  // One reminder per task
      retryLimit: 2,
      expireInMinutes: 60,
    },
  );

  return jobId;
}
```

### @nestjs/schedule Cron Setup
```typescript
// Source: NestJS Task Scheduling docs
// https://docs.nestjs.com/techniques/task-scheduling

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // ... other imports
  ],
})
export class SchedulerModule {}
```

### Proactive Telegram Message with Inline Keyboard
```typescript
// Source: Telegraf API + nestjs-telegraf @InjectBot
// https://telegraf.js.org/

async sendCheckInPrompt(task: { id: string; title: string; updatedAt: Date }) {
  const daysSinceUpdate = Math.floor(
    (Date.now() - task.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
  );

  const text = [
    `<b>Check-in</b>`,
    ``,
    `How's <b>${this.escapeHtml(task.title)}</b> going?`,
    `It's been ${daysSinceUpdate} days since the last update.`,
  ].join('\n');

  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('Done', `task:done:${task.id}`),
    Markup.button.callback('Still working', `task:start:${task.id}`),
    Markup.button.callback('Blocked', `task:defer:${task.id}`),
  ]);

  await this.bot.telegram.sendMessage(this.ownerChatId, text, {
    parse_mode: 'HTML',
    ...keyboard,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| BullMQ for job queue (project HLD) | pg-boss for job queue | Roadmap decision (2026-02-27) | Eliminates Upstash Redis cost/compatibility issues; uses existing Neon PostgreSQL |
| Custom setTimeout scheduling | pg-boss `startAfter` + @nestjs/schedule `@Cron()` | Current best practice | Persistent scheduling survives restarts; standardized cron expressions |
| pg-boss v9-10 `sendAfter` option | pg-boss v12 `startAfter` option | pg-boss v10+ | API renamed; `sendAfter` is deprecated in favor of `startAfter` |

**Deprecated/outdated:**
- `sendAfter` in pg-boss: Use `startAfter` instead (renamed in v10+)
- BullMQ with Upstash: Officially incompatible; high per-request cost on free tier even if connection works

## Open Questions

1. **pg-boss connection pool vs Neon free tier limits**
   - What we know: Neon free tier has limited concurrent connections. Prisma already uses one pool. pg-boss needs its own.
   - What's unclear: Exact connection limits on Neon free tier for the project's plan. PgBouncer pooling should help.
   - Recommendation: Configure pg-boss with `max: 2` pool. Use Neon's pooled connection string (with `-pooler` suffix) for pg-boss. Test connection exhaustion in staging.

2. **Per-task vs global reminder lead time**
   - What we know: PROD-01 says "configurable per task or globally." The current Task schema has no `reminderLeadMinutes` field.
   - What's unclear: Whether per-task override is needed for v1 or if global default suffices.
   - Recommendation: Add optional `reminderLeadMinutes` field to Task schema for per-task override. Fall back to Settings.reminderLeadMinutes for tasks without override. Start with global-only in the UI and add per-task control later.

3. **Notification timing preferences**
   - What we know: Cron jobs run in UTC. User may not want 9 AM UTC notifications.
   - What's unclear: User's timezone and preferred notification window.
   - Recommendation: Add `notificationTimeUtc` (hour, 0-23) to Settings model. Use this for cron scheduling of daily polls. For v1, hardcode a sensible default (e.g., 9 AM UTC) and make it configurable via /settings command.

4. **pg-boss schema migration isolation**
   - What we know: pg-boss creates its own schema tables (`pgboss.job`, `pgboss.queue`, etc.) automatically on `start()`.
   - What's unclear: Whether this conflicts with Prisma's migration management or Neon's schema expectations.
   - Recommendation: pg-boss uses its own `pgboss` schema by default, which is isolated from the `public` schema Prisma uses. No conflict expected, but verify in development.

## Sources

### Primary (HIGH confidence)
- [pg-boss GitHub](https://github.com/timgit/pg-boss) - API reference, send() options, startAfter, singletonKey, connection config, version 12.13.0
- [NestJS Task Scheduling docs](https://docs.nestjs.com/techniques/task-scheduling) - @nestjs/schedule setup, @Cron decorator, ScheduleModule, SchedulerRegistry
- [nestjs-telegraf GitHub](https://github.com/robot-mafia/nestjs-telegraf) - @InjectBot decorator, v2.9.1, bot injection pattern
- [Telegram Bot API](https://core.telegram.org/bots/api) - sendMessage with chatId for proactive messaging

### Secondary (MEDIUM confidence)
- [pg-boss Deep Dive (LogSnag)](https://logsnag.com/blog/deep-dive-into-background-jobs-with-pg-boss-and-typescript) - TypeScript patterns, send() options, job manager pattern, startAfter usage
- [BullMQ + Upstash incompatibility issue](https://github.com/taskforcesh/bullmq/issues/1087) - Confirmed BullMQ/Upstash incompatibility
- [Neon Connection Pooling docs](https://neon.com/docs/connect/connection-pooling) - PgBouncer setup, pooled connection strings
- [NestJS Schedule npm](https://www.npmjs.com/package/@nestjs/schedule) - Latest version, peer dependencies

### Tertiary (LOW confidence)
- [nestjs-telegraf InjectBot issue #118](https://github.com/nksmnf/nestjs-telegraf/issues/118) - Module import requirement for @InjectBot to work across modules -- needs verification in codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - pg-boss and @nestjs/schedule are mature, well-documented; existing project already uses Telegraf/nestjs-telegraf
- Architecture: HIGH - patterns are straightforward (background job + database query + Telegram send); existing codebase has all necessary primitives
- Pitfalls: HIGH - common issues (stale jobs, timezone, connection limits) are well-documented in PostgreSQL job queue literature

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable domain; pg-boss and @nestjs/schedule are mature)
