# Architecture

**Analysis Date:** 2026-02-27

## Pattern Overview

**Overall:** Event-Driven Modular Monolith (NestJS-based)

**Key Characteristics:**
- **Module separation by domain:** Telegram, LLM, Calendar, Task, Scheduler modules aligned with business capabilities
- **Event-driven job scheduling:** BullMQ on Upstash Redis for asynchronous reminders and background tasks
- **Webhook-first interface:** Telegram bot webhook (not polling) as primary user interaction point
- **Conversational session management:** Stateful context in Redis for multi-turn brain dump processing
- **Single-user by design:** Chat ID-based authentication; no multi-tenancy complexity

## Layers

**Telegram Module (`src/modules/telegram/`):**
- Purpose: Handle all Telegram bot interactions - webhook receiving, message sending, inline keyboard callbacks, voice file downloads
- Location: `src/modules/telegram/`
- Contains: Controllers for webhooks, services for bot API operations, DTOs for message/callback payloads
- Depends on: Task Module (for task operations), LLM Module (for initial message classification)
- Used by: API clients (Telegram users), LLM Module (for sending responses)

**LLM Module (`src/modules/llm/`):**
- Purpose: Manage all Claude API interactions - brain dump decomposition, conversational follow-up question generation, intent classification, comment action-item extraction
- Location: `src/modules/llm/`
- Contains: Services for Opus 4.6 (decomposition) and Sonnet 4.6 (structured operations), prompt templates, response parsing logic
- Depends on: Session management (Redis), Anthropic SDK
- Used by: Telegram Module (for processing user messages), Task Module (for comment analysis)

**Task Module (`src/modules/task/`):**
- Purpose: Core domain logic for task lifecycle, CRUD operations, sub-task hierarchy, comment management, status workflows
- Location: `src/modules/task/`
- Contains: Services for task creation/update/delete, status transitions, sub-task operations, comment operations; DTOs for task payloads
- Depends on: Prisma ORM, Workspace Module (for workspace scoping)
- Used by: Telegram Module (for creating/updating tasks), Scheduler Module (for reminder generation)

**Calendar Module (`src/modules/calendar/`):**
- Purpose: Google Calendar integration - create events from tasks, add stakeholder attendees, time blocking
- Location: `src/modules/calendar/`
- Contains: Services for Google OAuth flow, event creation, attendee resolution, contact directory management
- Depends on: Task Module (for task context), Google APIs SDK
- Used by: Telegram Module (for user responses to calendar blocking prompts)

**Scheduler Module (`src/modules/scheduler/`):**
- Purpose: Background job scheduling and execution - deadline reminders, check-in prompts, deferred task resurfacing
- Location: `src/modules/scheduler/`
- Contains: Job processors (BullMQ), job queue management, reminder generation logic
- Depends on: Task Module (for task data), Telegram Module (for sending reminders), Redis/BullMQ
- Used by: Boot process (registers job handlers on startup)

**Workspace Module (`src/modules/workspace/`):**
- Purpose: Workspace separation (Personal/Work), scope management for tasks and calendars
- Location: `src/modules/workspace/`
- Contains: Services for workspace queries, default workspace resolution, workspace configuration
- Depends on: Prisma ORM
- Used by: Task Module (for task scoping), Telegram Module (for workspace routing)

**Session Module (`src/modules/session/`):**
- Purpose: Conversation session management - maintain LLM message history, session context, active task references for follow-up processing
- Location: `src/modules/session/`
- Contains: Redis-backed session store, session lifecycle management (creation, refresh, expiry at 30-min timeout)
- Depends on: Redis client
- Used by: LLM Module (for conversation continuity), Telegram Module (for session lifecycle on new messages)

## Data Flow

**Brain Dump Capture Flow:**

1. User sends text/voice message to Telegram bot
2. Telegram webhook routes to `TelegramController.handleUpdate()`
3. For voice messages: download audio from Telegram servers, send to Whisper API, transcribe to text
4. Send transcribed/original text to `LLMService.classifyMessage()` with session context
5. LLM returns classification (simple task, multi-item brain dump, update to existing task, command)
6. If brain dump: `LLMService.decomposeTask()` creates parent task + sub-tasks structure
7. `TaskService.createTask()` and `TaskService.createSubTasks()` save to PostgreSQL
8. `LLMService.generateFollowUpQuestions()` creates contextual questions (deadline, calendar block, stakeholders)
9. Send task summary + first follow-up question to Telegram via `TelegramService.sendMessage()` with inline keyboard buttons
10. Store session context in Redis with task IDs and conversation history
11. User answers follow-up question (may contain more brain dump)
12. Repeat: classify answer in session context, update tasks, ask next question or confirm completion

**Task Status Management Flow:**

1. User taps inline button (e.g., "Done", "Start", "Defer") on task message
2. Telegram sends `callback_query` webhook to `TelegramController.handleCallbackQuery()`
3. Extract task ID and action from callback data
4. Call `TaskService.updateStatus()` to update task status in PostgreSQL
5. For `in_progress`: trigger check-in reminder job in scheduler (3 days without update)
6. For `done`: if parent task, trigger parent auto-completion logic (`TaskService.checkParentCompletion()`)
7. Send confirmation message to Telegram
8. If task moved to `in_progress`: enqueue reminder job in BullMQ

**Calendar Blocking Flow:**

1. LLM generates follow-up question: "Should I block time on your calendar?"
2. User answers (e.g., "Yes, 2 hours Tuesday, invite Sarah")
3. `LLMService.parseCalendarIntent()` extracts structured data (date, duration, attendees)
4. `ContactService.resolveEmails()` looks up attendee emails in contact directory
5. If email unknown: `TelegramService.askForEmail()` prompts user
6. User provides email, save to contact directory
7. `CalendarService.createEvent()` calls Google Calendar API to create event
8. Store `CalendarEvent` record linked to task in PostgreSQL
9. Send confirmation to Telegram with event details

**Reminder Execution Flow:**

1. Background job in BullMQ fires at scheduled time (deadline reminder, check-in, deferred resurfacing)
2. Job processor in `SchedulerService` retrieves task context from PostgreSQL
3. Format reminder message with task details and quick-action buttons
4. Send via `TelegramService.sendMessage()`
5. User responds with action (Done, Blocked, Defer, Brain dump update)
6. Route response back through normal message handling flow

**State Management:**

- **Persistent state:** Tasks, comments, contacts, workspace configs, calendar events in PostgreSQL (source of truth)
- **Session state:** Conversation context (LLM message history, active task IDs, follow-up question tracking) in Redis with 30-min TTL
- **Job queue state:** Reminder jobs and scheduled operations in Redis via BullMQ
- **Cache layer:** Session context and frequently-accessed workspace configs in Redis

## Key Abstractions

**Task Hierarchy:**
- Purpose: Represent brain dumps as parent tasks with decomposed sub-tasks (one level deep, no infinite nesting)
- Examples: `src/modules/task/entities/task.entity.ts`, `src/modules/task/task.service.ts`
- Pattern: Parent task with `parent_task_id = null`, sub-tasks with `parent_task_id = parent UUID`. Parent status auto-derives from children.

**Workspace Scoping:**
- Purpose: Isolate tasks, calendars, and reminder preferences by workspace (Personal/Work)
- Examples: `src/modules/workspace/workspace.service.ts`
- Pattern: Every entity (Task, Comment, Contact) belongs to exactly one workspace. Queries always filter by workspace context. No cross-workspace data leakage.

**Conversation Session:**
- Purpose: Maintain conversational context across multiple user messages within a 30-minute window
- Examples: `src/modules/session/session.service.ts`, stored in Redis
- Pattern: Session contains LLM message history, active task IDs being discussed, follow-up questions. Each session tied to workspace_id. On timeout expiry, new messages start fresh context but can reference existing tasks by name/ID.

**Status Workflow:**
- Purpose: Enforce valid state transitions for task lifecycle
- Examples: `src/modules/task/task.service.ts` (updateStatus method)
- Pattern:
  ```
  captured → active → in_progress → done
         ↘ blocked (with reason)
         ↘ deferred (with optional resume date)
  ```
  Transitions validated in service layer.

**Contact Resolution:**
- Purpose: Map stakeholder names to email addresses during calendar blocking
- Examples: `src/modules/calendar/contact.service.ts`
- Pattern: Global contacts (workspace_id = null) and workspace-scoped contacts (workspace_id = workspace UUID). On unknown stakeholder, prompt user for email, store for future use.

## Entry Points

**Telegram Webhook Endpoint (`src/modules/telegram/telegram.controller.ts`):**
- Location: `POST /webhook/telegram` (or path defined in Fly.io + Telegram Bot settings)
- Triggers: Incoming message or callback query from Telegram servers
- Responsibilities: Validate webhook signature, parse update payload, route to appropriate handler (message vs callback query), return 200 OK immediately to Telegram

**API Health Check (`src/health.controller.ts`):**
- Location: `GET /health`
- Triggers: Monitoring, Fly.io health checks
- Responsibilities: Return 200 with status info

**Scheduled Job Handlers (BullMQ Processors):**
- Location: `src/modules/scheduler/jobs/`
- Triggers: Time-based or enqueued via BullMQ
- Responsibilities: Retrieve task context, format reminder, send to Telegram, handle retries

## Error Handling

**Strategy:** Graceful degradation with detailed logging

**Patterns:**
- **Telegram API failures:** Log error, don't crash. Re-queue failed message sends as job. User can retry via `/tasks` command.
- **LLM processing errors:** If decomposition fails, fall back to single-task creation. Log full prompt and error for debugging.
- **Database operations:** Transaction rollback on failure. Log with context (workspace_id, task_id). Return error to user via Telegram.
- **External API failures (Whisper, Google Calendar):** Catch errors, prompt user to retry. Store state for resumption.
- **Webhook signature validation:** Reject unsigned requests with 403. Log source IP.

## Cross-Cutting Concerns

**Logging:** Structured logging (Winston or Pino) in all modules
- What: Request ID tracking, API call start/end, error stack traces, LLM token usage
- Where: `src/common/logging/logger.service.ts`
- Pattern: Inject logger into every service, use contextual fields (workspace_id, task_id, user_action)

**Validation:** Class-validator DTOs on all HTTP payloads and database operations
- What: Type checking, required fields, enum validation, string length limits
- Where: `src/modules/*/dto/` directories
- Pattern: Use decorators (@IsString, @IsEnum, @IsOptional) on DTO classes, validate in controller before service

**Authentication:** Chat ID-based (single user)
- What: Verify incoming Telegram updates are from configured chat_id
- Where: `src/modules/telegram/telegram.service.ts` (webhook signature + chat_id check)
- Pattern: Extract TELEGRAM_CHAT_ID from env, check update.message.chat.id or callback_query.from.id matches

**Rate Limiting:** IP-based (Telegram webhook + API calls)
- What: Prevent bot/user from overwhelming system
- Where: Telegram API (server-side), Helmet middleware on NestJS app
- Pattern: Helmet rate limit middleware, Redis-backed counter for custom limits

---

*Architecture analysis: 2026-02-27*
