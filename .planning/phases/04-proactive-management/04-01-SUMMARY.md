---
phase: 04-proactive-management
plan: 01
subsystem: scheduler
tags: [pg-boss, nestjs-schedule, telegram, notifications, settings]

requires:
  - phase: 03-telegram-interface
    provides: TelegrafModule, MessageFormatterService, Telegraf bot instance, inline keyboard constants
provides:
  - SettingsService with get/update and upsert defaults
  - SchedulerService with pg-boss lifecycle management
  - NotificationService for proactive Telegram messaging (deadline, check-in, deferred)
  - SchedulerModule wiring ScheduleModule.forRoot() and all scheduler services
  - TelegramModule now exports TelegrafModule for cross-module @InjectBot() access
affects: [04-proactive-management, 05-calendar-integration]

tech-stack:
  added: [pg-boss@12.13, @nestjs/schedule@6.1]
  patterns: [pg-boss lifecycle via OnModuleInit/OnModuleDestroy, @InjectBot() for proactive messaging, single-row settings with upsert defaults]

key-files:
  created:
    - src/settings/settings.service.ts
    - src/settings/settings.module.ts
    - src/scheduler/scheduler.service.ts
    - src/scheduler/notification.service.ts
    - src/scheduler/scheduler.module.ts
  modified:
    - src/telegram/telegram.module.ts
    - prisma/schema.prisma
    - package.json

key-decisions:
  - "pg-boss constructor uses minimal pool (max: 2) for Neon free tier compatibility"
  - "NotificationService uses private escapeHtml instead of importing from MessageFormatterService (method is private)"
  - "TelegramModule exports TelegrafModule to allow @InjectBot() resolution in SchedulerModule"
  - "Settings model uses single-row pattern with id='default' for single-user app"

patterns-established:
  - "pg-boss lifecycle: OnModuleInit starts boss + creates queues, OnModuleDestroy stops gracefully"
  - "@InjectBot() proactive messaging: inject bot in any module that imports TelegramModule"
  - "Settings upsert: get() creates defaults if missing, update() upserts with partial data"

requirements-completed: [PROD-01, PROD-02, PROD-03]

duration: 7min
completed: 2026-02-28
---

# Phase 4 Plan 01: Scheduling Infrastructure Summary

**pg-boss scheduler, SettingsService with upsert defaults, and NotificationService for proactive Telegram messaging with inline keyboards**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-28T02:31:20Z
- **Completed:** 2026-02-28T02:39:18Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Settings model with configurable reminderLeadMinutes (1440), checkInAfterDays (3), notificationHourUtc (9)
- pg-boss lifecycle managed by SchedulerService with deadline-reminder queue
- NotificationService sends three types of proactive messages (deadline, check-in, deferred) with inline keyboards
- TelegramModule exports TelegrafModule for cross-module bot access

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema changes, dependencies, migration** - already committed in 298f1aa (Phase 6 catch-up)
2. **Task 2: SettingsService, SchedulerService, NotificationService, SchedulerModule** - `4daca4e` (feat)

## Files Created/Modified
- `src/settings/settings.service.ts` - Settings CRUD with upsert defaults
- `src/settings/settings.module.ts` - Settings module exporting SettingsService
- `src/scheduler/scheduler.service.ts` - pg-boss lifecycle management
- `src/scheduler/notification.service.ts` - Proactive Telegram messaging with inline keyboards
- `src/scheduler/scheduler.module.ts` - Module wiring ScheduleModule.forRoot(), pg-boss, notifications
- `src/telegram/telegram.module.ts` - Added TelegrafModule to exports
- `prisma/schema.prisma` - Settings model + Task.reminderLeadMinutes
- `prisma/migrations/20260228100000_add_settings_reminder/migration.sql` - Migration SQL

## Decisions Made
- pg-boss constructor uses `max: 2` pool to avoid exhausting Neon free tier connections
- NotificationService implements private `escapeHtml` since MessageFormatterService's is private
- TelegramModule exports TelegrafModule (not just services) to allow @InjectBot() in SchedulerModule
- Settings uses single-row pattern (id="default") appropriate for single-user app

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pg-boss v12 ConstructorOptions changed**
- **Found during:** Task 2 (SchedulerService creation)
- **Issue:** `retentionDays` and `archiveCompletedAfterSeconds` are not valid constructor options in pg-boss v12 -- they're queue-level options now
- **Fix:** Removed invalid constructor options; retention is handled at queue creation time
- **Files modified:** src/scheduler/scheduler.service.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** 4daca4e

**2. [Rule 3 - Blocking] PgBoss import style**
- **Found during:** Task 2 (SchedulerService creation)
- **Issue:** `import PgBoss from 'pg-boss'` failed -- pg-boss is ESM with named export
- **Fix:** Changed to `import { PgBoss } from 'pg-boss'`
- **Files modified:** src/scheduler/scheduler.service.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** 4daca4e

**3. [Rule 1 - Bug] Schema changes already committed**
- **Found during:** Task 1 (schema and dependency installation)
- **Issue:** Settings model, Task.reminderLeadMinutes, pg-boss, and @nestjs/schedule were already committed in 298f1aa as part of Phase 6 catch-up
- **Fix:** Verified changes exist in HEAD, skipped redundant commit for Task 1
- **Files modified:** None (already committed)
- **Verification:** git show HEAD confirms all schema changes present

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None -- schema dependencies were pre-committed, service implementation proceeded smoothly.

## Next Phase Readiness
- All scheduling infrastructure ready for Plan 02
- SchedulerService.boss exposed for ReminderService to schedule jobs
- NotificationService ready for ReminderService and PollingService to call
- SettingsService ready for configurable thresholds

---
*Phase: 04-proactive-management*
*Completed: 2026-02-28*
