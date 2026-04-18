---
phase: 06-web-dashboard
plan: 01
subsystem: api
tags: [nestjs, rest, cors, guards, controllers]

# Dependency graph
requires:
  - phase: 01-project-foundation
    provides: TaskService, WorkspaceService, PrismaService, DTOs
provides:
  - REST API endpoints for tasks (GET all, GET one, PATCH update)
  - REST API endpoint for workspaces (GET all)
  - ApiKeyGuard for dashboard authentication
  - CORS configuration for dashboard origin
  - TaskService.findAllAcrossWorkspaces() for cross-workspace queries
affects: [06-web-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns: [Controller + UseGuards pattern for API endpoints, ApiKeyGuard with env-var toggle for dev mode]

key-files:
  created:
    - src/task/task.controller.ts
    - src/workspace/workspace.controller.ts
    - src/guards/api-key.guard.ts
  modified:
    - src/task/task.service.ts
    - src/task/task.module.ts
    - src/workspace/workspace.module.ts
    - src/main.ts

key-decisions:
  - "ApiKeyGuard passes through when DASHBOARD_API_KEY env var is not set (dev mode open access)"
  - "CORS origin defaults to http://localhost:5173 via DASHBOARD_URL env var"
  - "Controllers use api/ prefix in route path (no global prefix needed)"
  - "workspace: true included in findAll and findAllAcrossWorkspaces for dashboard workspace display"

patterns-established:
  - "ApiKeyGuard pattern: class-level @UseGuards(ApiKeyGuard) on all dashboard-facing controllers"
  - "Dashboard API convention: /api/ prefix for REST endpoints consumed by React frontend"

requirements-completed: [DASH-01]

# Metrics
duration: 2min
completed: 2026-02-28
---

# Phase 6 Plan 1: Dashboard REST API Summary

**REST API layer with TaskController (GET/PATCH), WorkspaceController (GET), ApiKeyGuard, and CORS for React dashboard consumption**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-27T21:33:04Z
- **Completed:** 2026-02-27T21:35:27Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Added findAllAcrossWorkspaces() to TaskService for cross-workspace task listing with workspace relation
- Created TaskController with GET (all/filtered/single) and PATCH endpoints at /api/tasks
- Created WorkspaceController with GET endpoint at /api/workspaces
- Created ApiKeyGuard validating X-API-Key header against DASHBOARD_API_KEY env var (open in dev mode)
- Configured CORS for dashboard origin with credentials support

## Task Commits

Each task was committed atomically:

1. **Task 1: Add findAllAcrossWorkspaces to TaskService and create ApiKeyGuard** - `9071181` (feat)
2. **Task 2: Create TaskController, WorkspaceController, configure CORS, and wire modules** - `95ce519` (feat)

## Files Created/Modified
- `src/guards/api-key.guard.ts` - API key validation guard, passes through in dev mode when env var unset
- `src/task/task.controller.ts` - REST endpoints for tasks: GET all, GET one, PATCH update
- `src/workspace/workspace.controller.ts` - REST endpoint for workspaces: GET all
- `src/task/task.service.ts` - Added findAllAcrossWorkspaces() method and workspace relation to findAll()
- `src/task/task.module.ts` - Registered TaskController
- `src/workspace/workspace.module.ts` - Registered WorkspaceController
- `src/main.ts` - Added CORS configuration for dashboard origin

## Decisions Made
- ApiKeyGuard returns true (open access) when DASHBOARD_API_KEY env var is not set, enabling frictionless local development
- CORS origin defaults to http://localhost:5173 (Vite dev server) via DASHBOARD_URL env var
- Controllers use `api/` prefix directly in route path rather than a global prefix to avoid affecting Telegram webhook routes
- Added `workspace: true` to both findAll and findAllAcrossWorkspaces includes so dashboard can display workspace name per task

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- NestJS build (`npx nest build`) has 25 pre-existing TypeScript errors from Prisma generated files and dashboard vite config -- these are not caused by this plan's changes and were verified to exist before any modifications were made. All 97 existing tests pass.

## User Setup Required

None - no external service configuration required. The ApiKeyGuard operates in open-access mode when DASHBOARD_API_KEY is not set, so no env var setup is needed for local development.

## Next Phase Readiness
- REST API layer is complete and ready for the React dashboard to consume
- Dashboard can fetch tasks via GET /api/tasks and update via PATCH /api/tasks/:id
- Dashboard can fetch workspaces via GET /api/workspaces
- CORS is configured for the default Vite dev server port (5173)

## Self-Check: PASSED

All 7 created/modified files verified present. Both task commits (9071181, 95ce519) verified in git log. All 97 existing tests pass.

---
*Phase: 06-web-dashboard*
*Completed: 2026-02-28*
