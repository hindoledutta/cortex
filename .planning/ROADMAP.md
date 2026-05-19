# Roadmap: Cortex

## Overview

Cortex delivers zero-friction capture through a Telegram bot backed by LLM intelligence. The roadmap builds bottom-up: domain layer first (tasks, workspaces), then intelligence (LLM decomposition, sessions, voice), then the Telegram interface that wires it all together. Once the core capture loop is validated, proactive management (reminders, check-ins) and calendar integration add the timeline dimension. The web dashboard provides visual management once task volume warrants it. Phase 7 expands cortex beyond tasks: notes and meetings get captured into the user's `nirvana-wiki` knowledge vault for downstream curation and querying.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Project Foundation** - NestJS scaffold, Prisma schema, task domain, and workspace isolation
- [x] **Phase 2: Intelligence Layer** - LLM decomposition, voice transcription, session context, and conversational follow-up
- [x] **Phase 3: Telegram Interface** - Bot webhook, message capture, inline keyboards, commands, and comments
- [x] **Phase 4: Proactive Management** - Deadline reminders, stale task check-ins, and deferred task resurfacing
- [x] **Phase 5: Calendar Integration** - Google Calendar events, contacts directory, and time blocking suggestions
- [x] **Phase 6: Web Dashboard** - PWA with kanban view, list view, and filters
- [x] **Phase 7a: Note Capture** - `/note` Telegram command, Vault Module (git pull/write/commit/push), Sonnet slug generation, [Undo], VaultWrite audit log
- [ ] **Phase 7b: Meeting Capture** - `cortex-local` watcher daemon (launchd), Fathom cloud webhook (`/api/meetings/fathom-webhook`, HMAC-SHA256), vault write to `raw/meetings/`, Telegram notification, `/vault recent` *(code complete; Meetily human checkpoint pending; Fathom path live)*

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
- [x] 01-01-PLAN.md -- Project scaffold, Prisma schema, database setup, WorkspaceService
- [x] 01-02-PLAN.md -- Task domain service with TDD (CRUD, status, sub-tasks, workspace isolation, prefix parsing)

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
- [x] 02-01-PLAN.md -- LLM core (model routing, token logging) + brain dump decomposition with TDD
- [x] 02-02-PLAN.md -- Redis session management (SessionService with TTL, state machine, topic context)
- [x] 02-03-PLAN.md -- Classification, follow-up question generation, enrichment services + module wiring

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
- [x] 03-01-PLAN.md -- Schema changes (Comment model, telegramMsgId), dependencies, foundation services (VoiceService, MessageFormatterService, ChatIdGuard, CommentService, CommentProcessingService)
- [x] 03-02-PLAN.md -- OrchestratorService (end-to-end pipeline), TelegramUpdate handler (all decorators), module wiring, webhook setup

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
- [x] 04-01-PLAN.md -- Settings model, pg-boss scheduler lifecycle, NotificationService (proactive Telegram messaging), SettingsService
- [x] 04-02-PLAN.md -- ReminderService (deadline job scheduling), PollingService (stale check-ins + deferred resurfacing), TaskService hooks, AppModule wiring

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
- [x] 05-01-PLAN.md -- Schema (Contact, CalendarEvent), dependencies, GoogleAuthService, CalendarService, ContactService, CalendarModule
- [x] 05-02-PLAN.md -- CalendarExtractionService, TimeBlockService, OrchestratorService extension, Telegram wiring

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
- [x] 06-01-PLAN.md -- Backend REST API (TaskController, WorkspaceController, CORS, ApiKeyGuard)
- [x] 06-02-PLAN.md -- Dashboard scaffold (Vite + React + Tailwind + shadcn/ui + TanStack Router/Query + PWA + API client)
- [x] 06-03-PLAN.md -- Dashboard views (kanban board with dnd-kit, list view with TanStack Table, filters, view toggle)

### Phase 7a: Note Capture
**Goal**: User can invoke `/note` on Telegram (text or voice) and have the content land verbatim in `nirvana-wiki/raw/inbox/` as a committed and pushed markdown file, with a 60-second undo path -- without altering existing task-capture behavior
**Depends on**: Phase 3 (Telegram interface), Phase 2 (LLM + Whisper) — and a GitHub remote for nirvana-wiki with a deploy key configured on Fly.io
**Requirements**: NOTE-01, NOTE-02, NOTE-03, NOTE-04, NOTE-05, NOTE-06, NOTE-07, NOTE-08, NOTE-09, VAULT-01, VAULT-02, VAULT-03, VAULT-04, VAULT-05
**Success Criteria** (what must be TRUE):
  1. `/note <text>` from Telegram results in a verbatim markdown file at `raw/inbox/YYYY-MM-DD-{slug}.md` in the GitHub repo within 6 seconds
  2. `/note` followed by a voice message produces a verbatim transcript at the same path within 10 seconds, reusing the existing Whisper pipeline
  3. The bot reply includes the file path, commit sha, and a `[Undo]` inline button that, when tapped within 60 seconds, reverts the commit and soft-deletes the Note row
  4. `/note` does not interrupt or alter an active task follow-up session — it routes that single message and returns
  5. Cortex commits as `cortex-bot <bot@cortex.local>`; every write produces a `VaultWrite` audit row regardless of success
  6. Cortex never writes outside `raw/inbox/`; conflicts with the wiki-ingest workflow do not occur in normal operation
**Plans**: 2 plans

Plans:
- [x] 07a-01-PLAN.md -- Schema (Note, VaultWrite), VaultModule (clone bootstrap, pull-rebase-write-commit-push under mutex), env wiring for deploy key
- [x] 07a-02-PLAN.md -- `/note` Telegram command handler (text + voice + reply forms), Sonnet slug generation, OrchestratorService extension, [Undo] callback wiring, `/vault recent` command

### Phase 7b: Meeting Capture
**Goal**: Meeting transcripts land at `nirvana-wiki/raw/meetings/YYYY-MM-DD-{title-slug}.md` in GitHub within 30 seconds via two ingest paths: (1) `cortex-local` daemon watching Meetily output on the Mac mini, or (2) Fathom cloud webhook — without any user action, with Telegram notification on capture
**Depends on**: Phase 7a (VaultModule), Meetily installed and configured on the Mac mini (path 1) or Fathom account with webhook configured (path 2)
**Requirements**: MEET-01, MEET-02, MEET-03, MEET-04, MEET-05, MEET-06, MEET-07, MEET-08, MEET-09, VAULT-06
**Success Criteria** (what must be TRUE):
  1. After a Google Meet call ends, a transcript file appears at `raw/meetings/YYYY-MM-DD-{title-slug}.md` in GitHub within 30 seconds, with the correct date / start time / end time / attendees in the file header
  2. The body is the verbatim transcript — Meetily path: raw transcript; Fathom path: ## Summary / ## Action Items / ## Transcript sections from Fathom's AI output — cortex writes these verbatim without further processing
  3. Telegram receives a notification: `Meeting captured: "<title>" (<duration>, <N> attendees) → <vault path>`
  4. Audio never leaves the Mac mini — only transcript text crosses the network
  5. If `cortex-local` cannot reach the cortex API or push fails, it retries with exponential backoff up to 1 hour, then notifies the owner via Telegram
  6. `/vault recent` on Telegram returns the last 10 vault writes (notes + meetings) with status
  7. All Meeting rows default to the Work workspace (locked decision; no attendee-domain heuristic in v1)
  8. `cortex-local` sends a daily heartbeat to cortex; cortex alerts via Telegram if no heartbeat received in 26 hours
**Plans**: 2 plans

Plans:
- [x] 07b-01-PLAN.md -- Schema (Meeting, Heartbeat), MeetingsController + `/api/meetings/ingest`, `/api/heartbeat` endpoint + heartbeat-staleness scheduled job, `/vault recent` command
- [x] 07b-02-PLAN.md -- `cortex-local` daemon (chokidar watcher, file-stable detection, POST + retry, ingest marker, daily heartbeat ping, launchd plist, install script)
- [x] *(ad-hoc)* Fathom webhook ingest: `FathomWebhookController` (`POST /api/meetings/fathom-webhook`, HMAC-SHA256 guard), source-aware `buildBody()`, discriminated `IngestPayloadSchema`, `fathom-register-webhook.ts` + `fathom-backfill.ts` scripts, queue race fix

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7a -> 7b
Note: Phase 6 depends on Phase 1 (not Phase 5) and could start after Phase 3 if desired. Phase 7a depends on Phase 3 only and can run in parallel with Phase 4-6 once Phase 3 is complete.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Project Foundation | 2/2 | Complete | 2026-02-27 |
| 2. Intelligence Layer | 3/3 | Complete | 2026-02-27 |
| 3. Telegram Interface | 2/2 | Complete | 2026-02-28 |
| 4. Proactive Management | 2/2 | Complete | 2026-02-28 |
| 5. Calendar Integration | 2/2 | Complete | 2026-02-28 |
| 6. Web Dashboard | 3/3 | Complete | 2026-02-28 |
| 7a. Note Capture | 2/2 | Complete | 2026-04-30 |
| 7b. Meeting Capture | 2/2 + Fathom (ad-hoc) | In Progress | - |
