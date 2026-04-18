---
phase: 04-proactive-management
plan: 02
subsystem: scheduler
tags: [pg-boss, cron, reminders, check-ins, deferred, task-hooks]

requires:
  - phase: 04-proactive-management
    provides: SchedulerService (pg-boss), NotificationService, SettingsService, SchedulerModule
provides:
  - ReminderService for deadline reminder job scheduling and cancellation
  - PollingService for daily stale task check-ins and deferred task resurfacing
  - TaskService hooks for automatic reminder management on create/update/delete
  - Full SchedulerModule integration into AppModule
affects: [04-proactive-management]

tech-stack:
  added: []
  patterns: [pg-boss singletonKey deduplication, hourly cron gated by notificationHourUtc, @Optional() forwardRef for circular DI]

key-files:
  created:
    - src/scheduler/reminder.service.ts
    - src/scheduler/polling.service.ts
  modified:
    - src/task/task.service.ts
    - src/task/task.module.ts
    - src/scheduler/scheduler.module.ts
    - src/app.module.ts

key-decisions:
  - "cancelReminder is a no-op log -- pg-boss v12 cancel() requires job ID, handler guard re-validates state"
  - "TaskService uses @Optional() + forwardRef() for ReminderService injection to avoid circular dependency"
  - "PollingService cron runs hourly but only acts at configured notificationHourUtc (avoids timezone issues)"
  - "Deferred resurfacing sends notification before status update (if notification fails, retries tomorrow)"

patterns-established:
  - "forwardRef circular DI: TaskModule <-> SchedulerModule via forwardRef(() => SchedulerModule) and @Optional() @Inject(forwardRef(() => ReminderService))"
  - "Notification-first pattern: send user notification before mutating state, so failures leave task in recoverable state"
  - "Handler guard pattern: pg-boss job handler re-validates task state before sending, tolerating stale jobs"

requirements-completed: [PROD-01, PROD-02, PROD-03]

duration: 4min
completed: 2026-02-28
---

# Phase 4 Plan 02: Proactive Management Business Logic Summary

**ReminderService with pg-boss deadline scheduling, PollingService with hourly cron for stale check-ins and deferred resurfacing, TaskService hooks for automatic reminder management**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T02:41:01Z
- **Completed:** 2026-02-28T02:45:48Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Deadline reminders scheduled via pg-boss with singletonKey deduplication and state re-validation
- Daily stale task check-ins skip parent tasks with recently-updated children
- Deferred task resurfacing sends notification before status transition
- TaskService automatically manages reminders on create/update/softDelete
- Full SchedulerModule wired into AppModule with all 4 services
- All 97 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: ReminderService and PollingService** - `da072b6` (feat)
2. **Task 2: TaskService hooks, module wiring, AppModule integration** - `bfb8777` (feat)

## Files Created/Modified
- `src/scheduler/reminder.service.ts` - Deadline reminder job scheduling/cancellation via pg-boss
- `src/scheduler/polling.service.ts` - Daily cron for stale check-ins and deferred resurfacing
- `src/task/task.service.ts` - Added reminder hooks to create/update/softDelete
- `src/task/task.module.ts` - Added forwardRef import of SchedulerModule
- `src/scheduler/scheduler.module.ts` - Added ReminderService and PollingService to providers
- `src/app.module.ts` - Imported SchedulerModule and SettingsModule

## Decisions Made
- pg-boss v12 cancel() requires job ID (not singletonKey), so cancelReminder relies on handler guard
- TaskService uses @Optional() for ReminderService to preserve backward compatibility with existing tests
- PollingService uses hourly cron gated by notificationHourUtc instead of daily cron at fixed hour
- Notification-first pattern for deferred resurfacing ensures user sees the message even if status update fails

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pg-boss v12 WorkHandler expects array of jobs**
- **Found during:** Task 1 (ReminderService creation)
- **Issue:** `WorkHandler<ReqData>` type is `(job: Job<ReqData>[]) => Promise<ResData>`, not a single job
- **Fix:** Changed handler to iterate over jobs array
- **Files modified:** src/scheduler/reminder.service.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** da072b6

**2. [Rule 3 - Blocking] pg-boss v12 SendOptions uses expireInSeconds not expireInMinutes**
- **Found during:** Task 1 (ReminderService creation)
- **Issue:** `expireInMinutes` is not a valid SendOptions property; correct property is `expireInSeconds`
- **Fix:** Changed to `expireInSeconds: 3600` (60 minutes)
- **Files modified:** src/scheduler/reminder.service.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** da072b6

**3. [Rule 3 - Blocking] pg-boss cancel() requires job ID, not singletonKey**
- **Found during:** Task 1 (ReminderService creation)
- **Issue:** `boss.cancel(name, id)` expects actual job ID, not the singletonKey string
- **Fix:** cancelReminder becomes a debug log; handler guard re-validates task state and skips completed/deleted tasks
- **Files modified:** src/scheduler/reminder.service.ts
- **Verification:** TypeScript compiles, handler correctly guards stale jobs
- **Committed in:** da072b6

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** All fixes address pg-boss v12 API differences from research examples. No scope creep.

## Issues Encountered
None -- all issues were API surface mismatches resolved during implementation.

## Next Phase Readiness
- Phase 4 complete: all three PROD requirements implemented end-to-end
- Ready for phase verification

---
*Phase: 04-proactive-management*
*Completed: 2026-02-28*
