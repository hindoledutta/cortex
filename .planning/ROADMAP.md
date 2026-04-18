# Roadmap: Cortex

## Overview

Cortex delivers zero-friction task capture through a Telegram bot backed by LLM intelligence. The roadmap builds bottom-up: domain layer first (tasks, workspaces), then intelligence (LLM decomposition, sessions, voice), then the Telegram interface that wires it all together. Once the core capture loop is validated, proactive management (reminders, check-ins) and calendar integration add the timeline dimension. The web dashboard comes last, providing visual management once task volume warrants it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Project Foundation** - NestJS scaffold, Prisma schema, task domain, and workspace isolation
- [ ] **Phase 2: Intelligence Layer** - LLM decomposition, voice transcription, session context, and conversational follow-up
- [ ] **Phase 3: Telegram Interface** - Bot webhook, message capture, inline keyboards, commands, and comments
- [ ] **Phase 4: Proactive Management** - Deadline reminders, stale task check-ins, and deferred task resurfacing
- [ ] **Phase 5: Calendar Integration** - Google Calendar events, contacts directory, and time blocking suggestions
- [ ] **Phase 6: Web Dashboard** - PWA with kanban view, list view, and filters

## Phase Details

### Phase 1: Project Foundation
**Goal**: A working domain layer where tasks can be created, updated, queried, and organized by workspace -- testable without any external interface
**Depends on**: Nothing (first phase)
**Requirements**: TASK-01, TASK-02, TASK-03, WKSP-01, WKSP-02, WKSP-03
**Success Criteria** (what must be TRUE):
  1. A task can be created, read, updated, and deleted through the domain service layer
  2. Tasks follow the full status lifecycle (captured -> active -> in_progress -> done, plus blocked and deferred transitions)
  3. A task can have sub-tasks one level deep, and parent status auto-derives from child statuses
  4. Tasks are isolated by workspace (Personal / Work) with hard boundaries -- a query for one workspace never returns tasks from the other
  5. User can set a default workspace and override it per-task with @work / @personal prefix logic
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md -- Project scaffold, Prisma schema, database setup, WorkspaceService
- [ ] 01-02-PLAN.md -- Task domain service with TDD (CRUD, status, sub-tasks, workspace isolation, prefix parsing)

### Phase 2: Intelligence Layer
**Goal**: The LLM and voice modules can accept unstructured input, decompose it into structured tasks, maintain multi-turn session context, and enrich existing tasks through follow-up -- all callable as services without Telegram
**Depends on**: Phase 1
**Requirements**: CAP-03, CAP-04, INTL-01, INTL-02, INTL-03
**Success Criteria** (what must be TRUE):
  1. A free-form brain dump (text) is decomposed into a parent task with prioritized sub-tasks via Claude Opus 4.6
  2. LLM calls are routed to the appropriate model (Opus for decomposition, Sonnet for classification and follow-up) with token usage logged per call
  3. After initial decomposition, the system generates 1-2 contextual follow-up questions to enrich the captured tasks
  4. Session context persists in Redis with a 30-minute inactivity TTL, enabling multi-turn conversation without re-explaining context
  5. Follow-up answers merge into existing tasks (updating deadlines, priorities, or descriptions) rather than creating duplicate tasks
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md -- LLM core (model routing, token logging) + brain dump decomposition with TDD
- [ ] 02-02-PLAN.md -- Redis session management (SessionService with TTL, state machine, topic context)
- [ ] 02-03-PLAN.md -- Classification, follow-up question generation, enrichment services + module wiring

### Phase 3: Telegram Interface
**Goal**: The user interacts entirely through Telegram -- sending text or voice messages, receiving structured task breakdowns, managing tasks via buttons, running commands, and adding comments -- completing the end-to-end capture loop
**Depends on**: Phase 2
**Requirements**: CAP-01, CAP-02, TASK-04, TASK-05, TASK-06, INTL-04
**Success Criteria** (what must be TRUE):
  1. User sends a text message to the Telegram bot and receives a structured task breakdown in response
  2. User sends a voice message; the bot shows the transcription and auto-processes it into tasks without requiring explicit approval
  3. User can tap inline keyboard buttons (Done, Start, Defer, Edit) on any task message to change task state
  4. User can run /tasks (list tasks), /workspace (switch workspace), /help (show usage), and /settings (configure preferences)
  5. User can reply to a task message or reference a task ID to add a comment, and the system extracts action items from comments and suggests new sub-tasks
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md -- Schema changes (Comment model, telegramMsgId), dependencies, foundation services (VoiceService, MessageFormatterService, ChatIdGuard, CommentService, CommentProcessingService)
- [ ] 03-02-PLAN.md -- OrchestratorService (end-to-end pipeline), TelegramUpdate handler (all decorators), module wiring, webhook setup

### Phase 4: Proactive Management
**Goal**: The system actively manages timelines by sending reminders before deadlines, prompting check-ins on stale tasks, and resurfacing deferred tasks on their resume dates
**Depends on**: Phase 3
**Requirements**: PROD-01, PROD-02, PROD-03
**Success Criteria** (what must be TRUE):
  1. User receives a Telegram reminder before a task's deadline, with lead time configurable per task or globally
  2. Tasks that have been in_progress for more than N days without updates trigger a check-in prompt asking the user for a status update
  3. Deferred tasks automatically resurface via Telegram message on their configured resume date
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md -- Settings model, pg-boss scheduler lifecycle, NotificationService (proactive Telegram messaging), SettingsService
- [ ] 04-02-PLAN.md -- ReminderService (deadline job scheduling), PollingService (stale check-ins + deferred resurfacing), TaskService hooks, AppModule wiring

### Phase 5: Calendar Integration
**Goal**: Tasks with deadlines and meetings flow into Google Calendar, with stakeholder emails resolved from a contacts directory and time blocks suggested based on effort estimates
**Depends on**: Phase 3
**Requirements**: CAL-01, CAL-02, CAL-03
**Success Criteria** (what must be TRUE):
  1. User can trigger Google Calendar event creation from a task, with title, description, and attendees populated from task context
  2. When a task references a person by name, the system resolves their email from a contacts directory -- and prompts the user to add unknown contacts
  3. System suggests time blocks for tasks based on their deadline and estimated effort, which the user can accept or dismiss
**Plans**: 2 plans

Plans:
- [ ] 05-01-PLAN.md -- Schema (Contact, CalendarEvent), dependencies, GoogleAuthService, CalendarService, ContactService, CalendarModule
- [ ] 05-02-PLAN.md -- CalendarExtractionService, TimeBlockService, OrchestratorService extension, Telegram wiring

### Phase 6: Web Dashboard
**Goal**: A supplementary visual interface where the user can see all tasks at a glance, switch between views, and filter by workspace, status, or deadline
**Depends on**: Phase 1
**Requirements**: DASH-01, DASH-02
**Success Criteria** (what must be TRUE):
  1. User can access a web dashboard (PWA) that displays all tasks from the same database the Telegram bot uses
  2. Dashboard provides kanban view (tasks as cards in status columns) and list view (sortable table), switchable with one click
  3. User can filter tasks by workspace (Personal/Work), status (active/in_progress/done/blocked/deferred), and deadline range
**Plans**: 3 plans

Plans:
- [ ] 06-01-PLAN.md -- Backend REST API (TaskController, WorkspaceController, CORS, ApiKeyGuard)
- [ ] 06-02-PLAN.md -- Dashboard scaffold (Vite + React + Tailwind + shadcn/ui + TanStack Router/Query + PWA + API client)
- [ ] 06-03-PLAN.md -- Dashboard views (kanban board with dnd-kit, list view with TanStack Table, filters, view toggle)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6
Note: Phase 6 depends on Phase 1 (not Phase 5) and could start after Phase 3 if desired.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Project Foundation | 2/2 | Complete | 2026-02-27 |
| 2. Intelligence Layer | 3/3 | Complete | 2026-02-27 |
| 3. Telegram Interface | 2/2 | Complete | 2026-02-28 |
| 4. Proactive Management | 0/? | Not started | - |
| 5. Calendar Integration | 0/? | Not started | - |
| 6. Web Dashboard | 0/? | Not started | - |
