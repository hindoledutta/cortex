# Architecture Research

**Domain:** LLM-powered Telegram bot task management system (NestJS + PostgreSQL + Redis)
**Researched:** 2026-02-27
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Interface Layer                                  │
│  ┌──────────────┐                           ┌──────────────────┐    │
│  │  Telegram     │                           │  REST API         │    │
│  │  Module       │                           │  (Phase 3: PWA)   │    │
│  │  (grammY)     │                           │                   │    │
│  └──────┬───────┘                           └────────┬──────────┘    │
│         │                                            │              │
├─────────┴────────────────────────────────────────────┴──────────────┤
│                     Orchestration Layer                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                 Message Router                                │   │
│  │   Classifies inbound: brain dump | single task | follow-up   │   │
│  │   | command | callback query | voice                         │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                      │
├──────────────────────────────┴──────────────────────────────────────┤
│                     Intelligence Layer                               │
│  ┌───────────────┐  ┌────────────────┐  ┌──────────────────────┐   │
│  │ LLM Module     │  │ Whisper Module  │  │ Session Module       │   │
│  │ (Claude API)   │  │ (OpenAI API)    │  │ (Redis TTL)          │   │
│  │                │  │                 │  │                      │   │
│  │ • Decompose    │  │ • OGG → text    │  │ • 30-min context     │   │
│  │ • Classify     │  │ • Return text   │  │ • Message history    │   │
│  │ • Enrich       │  │                 │  │ • Active task IDs    │   │
│  │ • Follow-up    │  │                 │  │                      │   │
│  └───────┬────────┘  └────────┬───────┘  └──────────┬───────────┘   │
│          │                    │                      │              │
├──────────┴────────────────────┴──────────────────────┴──────────────┤
│                     Domain Layer                                     │
│  ┌──────────────────────┐  ┌───────────────┐  ┌────────────────┐   │
│  │ Task Module           │  │ Workspace      │  │ Contact         │   │
│  │                       │  │ Module         │  │ Module          │   │
│  │ • CRUD + lifecycle    │  │                │  │                 │   │
│  │ • Sub-tasks           │  │ • Routing      │  │ • Name → email  │   │
│  │ • Comments            │  │ • Isolation    │  │ • Directory     │   │
│  │ • Status derivation   │  │ • Defaults     │  │                 │   │
│  └──────────┬────────────┘  └───────┬───────┘  └────────┬───────┘   │
│             │                       │                    │          │
├─────────────┴───────────────────────┴────────────────────┴──────────┤
│                     Infrastructure Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Scheduler     │  │ Calendar      │  │ Prisma                   │  │
│  │ Module        │  │ Module        │  │ Module                   │  │
│  │ (BullMQ)      │  │ (Phase 2)     │  │                          │  │
│  │               │  │               │  │ • PrismaService          │  │
│  │ • Reminders   │  │ • GCal API    │  │ • Connection management  │  │
│  │ • Check-ins   │  │ • Events      │  │ • Health checks          │  │
│  │ • Resurface   │  │ • Time blocks │  │                          │  │
│  └──────┬───────┘  └──────┬────────┘  └────────────┬─────────────┘  │
│         │                 │                         │               │
├─────────┴─────────────────┴─────────────────────────┴───────────────┤
│                     Data Stores                                      │
│  ┌──────────────────────┐        ┌──────────────────────────────┐   │
│  │  PostgreSQL (Neon)    │        │  Redis (Upstash)              │   │
│  │                       │        │                               │   │
│  │  • Tasks, sub-tasks   │        │  • BullMQ job queue           │   │
│  │  • Comments           │        │  • Session context (30m TTL)  │   │
│  │  • Contacts           │        │  • Rate limiting counters     │   │
│  │  • Workspaces         │        │                               │   │
│  │  • Calendar events    │        │                               │   │
│  └──────────────────────┘        └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Telegram Module** | Webhook ingestion, message sending, inline keyboards, voice file download, callback query handling | grammY framework with `@grammyjs/nestjs` adapter. Decorators for update handlers. Webhook middleware on a single POST endpoint. |
| **Message Router** | Classifies inbound messages (brain dump vs single task vs follow-up vs command vs callback) and dispatches to the correct handler chain | A service within the Telegram module that uses the LLM Module for classification (Sonnet) and session state to determine intent. Not a separate NestJS module — a coordination service. |
| **LLM Module** | All Claude API calls. Prompt management. Model routing (Opus vs Sonnet). Structured JSON output parsing. Token tracking. | Service wrapping Anthropic SDK. Prompt templates as typed constants. Zod schemas for response validation. Two sub-services or a single service with model parameter. |
| **Whisper Module** | Voice transcription. Downloads OGG from Telegram, sends to Whisper API, returns text. | Thin wrapper around OpenAI Whisper API. Accepts a file buffer, returns string. Isolated from LLM Module — different provider, different concern. |
| **Session Module** | Conversation context persistence. Stores message history and active task IDs per chat with 30-minute TTL. | Redis hash/JSON per session. TTL auto-expires. Provides `getSession(chatId)` / `updateSession(chatId, data)` / `clearSession(chatId)`. |
| **Task Module** | Core domain. Task CRUD, sub-task management, status lifecycle, parent status derivation, comments, audit. | Prisma-backed service. Enforces business rules (one-level nesting, status transitions, auto-derive parent status). The heaviest domain module. |
| **Workspace Module** | Workspace isolation. Routing messages to correct workspace. Default workspace resolution. | Small module. Mostly configuration and a resolver service. All queries and mutations scope by workspace_id. |
| **Contact Module** | Stakeholder directory. Name-to-email resolution. Prompted enrichment for unknown contacts. | Simple Prisma CRUD. Used by Calendar Module and LLM Module during follow-up. |
| **Scheduler Module** | Background jobs: deadline reminders, stale-task check-ins, deferred task resurfacing. | BullMQ queues with NestJS `@Processor` workers. Delayed/repeatable jobs. Sends notifications back through Telegram Module. |
| **Calendar Module** | Google Calendar event creation, time blocking, attendee management. Phase 2. | Google APIs client library. OAuth 2.0 with stored refresh token. One calendar ID per workspace. |
| **Prisma Module** | Database connection management. Shared PrismaService injectable across all domain modules. | Global module. PrismaService extends PrismaClient, implements `OnModuleInit` for connection, `OnModuleDestroy` for cleanup. |

## Recommended Project Structure

```
src/
├── app.module.ts              # Root module — imports all feature modules
├── main.ts                    # Bootstrap, webhook setup, global pipes
│
├── common/                    # Shared utilities (no business logic)
│   ├── decorators/            # Custom decorators (e.g., @ChatOwner)
│   ├── filters/               # Exception filters (Telegram error → user message)
│   ├── guards/                # Auth guard (chat_id verification)
│   ├── interceptors/          # Logging, timing interceptors
│   ├── pipes/                 # Validation pipes
│   └── types/                 # Shared TypeScript types and enums
│
├── config/                    # Configuration module
│   ├── config.module.ts       # NestJS ConfigModule setup
│   └── config.ts              # Typed config with validation (Zod or class-validator)
│
├── prisma/                    # Database layer
│   ├── prisma.module.ts       # Global module exporting PrismaService
│   ├── prisma.service.ts      # Extends PrismaClient, lifecycle hooks
│   └── migrations/            # Prisma migration files
│
├── telegram/                  # Telegram interface module
│   ├── telegram.module.ts     # grammY bot setup, webhook registration
│   ├── telegram.update.ts     # Update handlers (decorators for commands, messages)
│   ├── telegram.service.ts    # Outbound message sending, keyboard building
│   ├── handlers/              # Handler classes per concern
│   │   ├── message.handler.ts     # Text/voice message routing
│   │   ├── command.handler.ts     # /tasks, /workspace, /help, /settings
│   │   └── callback.handler.ts   # Inline keyboard button presses
│   └── keyboards/             # Inline keyboard builders
│       └── task.keyboard.ts
│
├── llm/                       # LLM integration module
│   ├── llm.module.ts
│   ├── llm.service.ts         # Claude API wrapper (model routing)
│   ├── prompts/               # Prompt templates as typed constants
│   │   ├── decompose.prompt.ts    # Brain dump → structured tasks
│   │   ├── classify.prompt.ts     # Message intent classification
│   │   ├── followup.prompt.ts     # Contextual follow-up generation
│   │   └── enrich.prompt.ts       # Incremental task enrichment
│   └── schemas/               # Zod schemas for structured LLM output
│       ├── decomposition.schema.ts
│       ├── classification.schema.ts
│       └── enrichment.schema.ts
│
├── whisper/                   # Voice transcription module
│   ├── whisper.module.ts
│   └── whisper.service.ts     # OpenAI Whisper API wrapper
│
├── session/                   # Conversation session module
│   ├── session.module.ts
│   └── session.service.ts     # Redis-backed session CRUD with TTL
│
├── task/                      # Core domain module
│   ├── task.module.ts
│   ├── task.service.ts        # Business logic, status lifecycle
│   ├── task.repository.ts     # Prisma queries (optional repository layer)
│   ├── dto/                   # Data transfer objects
│   │   ├── create-task.dto.ts
│   │   ├── update-task.dto.ts
│   │   └── task-filter.dto.ts
│   └── entities/              # Domain types (mirrors Prisma but decoupled)
│       └── task.entity.ts
│
├── workspace/                 # Workspace module
│   ├── workspace.module.ts
│   ├── workspace.service.ts   # Routing, defaults, isolation enforcement
│   └── dto/
│       └── switch-workspace.dto.ts
│
├── contact/                   # Contact directory module
│   ├── contact.module.ts
│   └── contact.service.ts     # Name → email CRUD
│
├── scheduler/                 # BullMQ background jobs module
│   ├── scheduler.module.ts    # Queue registration, BullModule setup
│   ├── producers/             # Job producers (enqueue jobs)
│   │   ├── reminder.producer.ts
│   │   └── checkin.producer.ts
│   └── processors/            # Job consumers (process jobs)
│       ├── reminder.processor.ts      # Deadline reminder handler
│       ├── checkin.processor.ts       # Stale task check-in handler
│       └── resurface.processor.ts     # Deferred task resurfacing
│
└── calendar/                  # Google Calendar module (Phase 2)
    ├── calendar.module.ts
    ├── calendar.service.ts    # GCal API: create events, add attendees
    └── dto/
        └── create-event.dto.ts
```

### Structure Rationale

- **`telegram/`:** Single entry point for all Telegram interactions. Handlers are split by concern (messages, commands, callbacks) to prevent a monolithic update file. The service handles outbound only — no business logic here.
- **`llm/`:** Isolates all LLM concerns. Prompt templates and output schemas are co-located because they are tightly coupled (a prompt change often requires a schema change). Model routing (Opus vs Sonnet) is an internal detail of `llm.service.ts`.
- **`whisper/`:** Separate from `llm/` because it is a different provider (OpenAI, not Anthropic), different concern (audio transcription, not text generation), and could be swapped independently.
- **`session/`:** Dedicated module because session management is infrastructure (Redis TTL mechanics) that multiple modules consume. The Telegram module and LLM module both need session data.
- **`task/`:** The core domain module. Heaviest business logic lives here. Optional repository layer pattern separates Prisma queries from business logic if queries grow complex.
- **`scheduler/`:** Producer-consumer separation within the module. Producers are called by other modules (e.g., Task Module enqueues a reminder when a deadline is set). Processors run independently, consuming from BullMQ queues.
- **`common/`:** Cross-cutting concerns only. No business logic. A guard for chat_id verification, filters that convert exceptions into Telegram-friendly messages, shared type definitions.

## Architectural Patterns

### Pattern 1: Module-per-Domain with Explicit Exports

**What:** Each NestJS module encapsulates one domain concern. Modules communicate only through exported services. No direct Prisma access from outside the owning module.

**When to use:** Always. This is the foundational NestJS pattern.

**Trade-offs:** Slightly more boilerplate (module declarations, imports/exports). Prevents circular dependencies and keeps modules testable in isolation.

**Example:**
```typescript
// task/task.module.ts
@Module({
  imports: [PrismaModule, WorkspaceModule, SessionModule],
  providers: [TaskService],
  exports: [TaskService], // Only TaskService is visible to other modules
})
export class TaskModule {}

// scheduler/scheduler.module.ts
@Module({
  imports: [
    BullModule.registerQueue({ name: 'reminders' }, { name: 'checkins' }),
    TaskModule,      // Import to access TaskService
    TelegramModule,  // Import to send notifications
  ],
  providers: [ReminderProducer, ReminderProcessor, CheckinProcessor],
  exports: [ReminderProducer], // Task module calls this to schedule reminders
})
export class SchedulerModule {}
```

### Pattern 2: LLM Service with Model Routing and Structured Output

**What:** A single LLM service wraps the Anthropic SDK and routes calls to the correct model (Opus for decomposition, Sonnet for classification/structured ops). Responses are validated against Zod schemas before returning.

**When to use:** Any system with tiered LLM routing or multiple model use cases.

**Trade-offs:** Centralizes all LLM logic (easy to monitor, rate-limit, swap models). The prompt/schema co-location means changes are localized. Cost tracking becomes straightforward.

**Example:**
```typescript
// llm/llm.service.ts
@Injectable()
export class LlmService {
  constructor(
    private readonly anthropic: Anthropic,
    private readonly config: ConfigService,
  ) {}

  async decompose(input: string, sessionContext: SessionContext): Promise<DecompositionResult> {
    const response = await this.anthropic.messages.create({
      model: 'claude-opus-4-6',  // Opus for complex decomposition
      system: DECOMPOSE_SYSTEM_PROMPT,
      messages: [...sessionContext.history, { role: 'user', content: input }],
    });
    return DecompositionSchema.parse(JSON.parse(response.content[0].text));
  }

  async classify(input: string): Promise<ClassificationResult> {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',  // Sonnet for structured ops
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: input }],
    });
    return ClassificationSchema.parse(JSON.parse(response.content[0].text));
  }
}
```

### Pattern 3: Producer-Consumer for Background Jobs

**What:** Domain modules (Task, Calendar) produce jobs by enqueueing them. Separate processor classes consume and execute them. BullMQ + Redis handles the queue, retries, and delayed execution.

**When to use:** Any deferred or scheduled work: reminders, check-ins, deferred task resurfacing.

**Trade-offs:** Adds a queue abstraction between "decide to do something" and "do it". Enables retry logic, delay, and rate limiting. Requires Redis. Slightly harder to trace than synchronous calls.

**Example:**
```typescript
// scheduler/producers/reminder.producer.ts
@Injectable()
export class ReminderProducer {
  constructor(@InjectQueue('reminders') private queue: Queue) {}

  async scheduleDeadlineReminder(taskId: string, deadline: Date, leadTime: number) {
    const delay = deadline.getTime() - leadTime - Date.now();
    await this.queue.add('deadline', { taskId }, { delay, jobId: `reminder:${taskId}` });
  }
}

// scheduler/processors/reminder.processor.ts
@Processor('reminders')
export class ReminderProcessor extends WorkerHost {
  constructor(
    private readonly taskService: TaskService,
    private readonly telegramService: TelegramService,
  ) { super(); }

  async process(job: Job<{ taskId: string }>) {
    const task = await this.taskService.findById(job.data.taskId);
    if (task && task.status !== 'done') {
      await this.telegramService.sendReminder(task);
    }
  }
}
```

### Pattern 4: Session-Scoped Context with Redis TTL

**What:** Conversation sessions are stored in Redis with automatic TTL expiry (30 minutes). Sessions carry LLM message history and active task IDs. No database writes for ephemeral session data.

**When to use:** Any conversational system where context must persist across messages but is inherently temporary.

**Trade-offs:** Fast reads/writes. Automatic cleanup. Data loss on Redis failure is acceptable (user restarts conversation). No schema migrations needed for session structure changes.

## Data Flow

### Flow 1: Brain Dump (Voice)

```
User sends voice message to Telegram
    │
    ▼
Telegram Webhook POST → Telegram Module
    │
    ▼
Telegram Module downloads OGG file from Telegram servers
    │
    ▼
Whisper Module: OGG buffer → OpenAI Whisper API → transcribed text
    │
    ▼
Telegram Module sends transcription back to user ("I heard: ...")
    │
    ▼
Session Module: load session context for chat_id (Redis GET)
    │
    ▼
LLM Module (Sonnet): classify message → "brain_dump"
    │
    ▼
Workspace Module: resolve target workspace (prefix override or default)
    │
    ▼
LLM Module (Opus): decompose brain dump → { parent_task, sub_tasks[], follow_ups[] }
    │
    ▼
Task Module: create parent task + sub-tasks in PostgreSQL
    │
    ▼
Session Module: update session with new task IDs and LLM history (Redis SET + TTL)
    │
    ▼
Scheduler Module: enqueue reminder jobs if deadlines detected (BullMQ)
    │
    ▼
Telegram Module: send task summary with inline keyboards + first follow-up question
```

### Flow 2: Quick Single Task (Text)

```
User sends text message → Telegram Webhook → Telegram Module
    │
    ▼
Session Module: load session (may be empty — fresh context)
    │
    ▼
LLM Module (Sonnet): classify → "single_task"
    │
    ▼
Workspace Module: resolve workspace
    │
    ▼
Task Module: create single task (status: captured)
    │
    ▼
Telegram Module: confirm with inline keyboard buttons [Done] [Set deadline] [Delete]
```

### Flow 3: Follow-up Enrichment

```
User sends reply in active session → Telegram Webhook → Telegram Module
    │
    ▼
Session Module: load session (has context — within 30-min window)
    │
    ▼
LLM Module (Sonnet): classify → "follow_up" (matches active session)
    │
    ▼
LLM Module (Opus or Sonnet depending on complexity):
  enrich existing tasks with new information (deadline, stakeholder, priority)
    │
    ▼
Task Module: update tasks in PostgreSQL (merge, not duplicate)
    │
    ▼
Session Module: update session with latest exchange
    │
    ▼
Telegram Module: confirm changes, ask next follow-up or "All set!"
```

### Flow 4: Background Reminder (Scheduler-Driven)

```
BullMQ delayed job fires → Reminder Processor
    │
    ▼
Task Module: load task, verify still active (not done/deleted)
    │
    ▼
Telegram Module: send reminder message with action buttons [Done] [Defer] [Snooze]
```

### Key Data Flows

1. **Inbound path:** Telegram Webhook → Message Router (classify) → Intelligence Layer (process) → Domain Layer (persist) → Telegram (respond). Every inbound message follows this chain.
2. **Outbound path:** Scheduler fires job → Domain query → Telegram send. Proactive messages originate from the Scheduler Module.
3. **Session path:** Redis is read at the start of every inbound message and written at the end. Session data never goes to PostgreSQL.
4. **LLM path:** All LLM calls go through `LlmService`. No module calls the Anthropic SDK directly. This centralizes token tracking, error handling, and model routing.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single user (target) | Monolith on Fly.io free tier. Single process handles webhook, BullMQ workers, and all modules. No scaling needed. |
| 10-50 users (hypothetical) | Same architecture. Increase Neon and Upstash tiers. Add connection pooling (Prisma with PgBouncer). LLM costs scale linearly — most expensive bottleneck. |
| 100+ users (unlikely, out of scope) | Separate worker process for BullMQ processors. Add request queuing for LLM calls to prevent API rate limits. Consider per-user session isolation in Redis. |

### Scaling Priorities

1. **First bottleneck: LLM cost.** At ~$0.50-1.00 per brain dump (Opus), LLM spend is the constraint, not compute or database. Tiered routing (Opus only for decomposition) is the primary mitigation. Already designed in.
2. **Second bottleneck: Upstash command limits (10K/day free).** With aggressive session reads/writes and BullMQ operations, a busy period could approach limits. Mitigation: batch session updates, keep BullMQ job count low. Upgrade to paid tier ($10/mo) if needed.

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Telegram Handlers

**What people do:** Put task creation logic, LLM calls, and database writes directly inside Telegram update handlers or callback query handlers.

**Why it's wrong:** Telegram handlers become untestable monoliths. Cannot reuse logic from REST API (Phase 3 dashboard). Telegram-specific concerns (message formatting, keyboard building) mix with domain logic.

**Do this instead:** Telegram handlers call domain services (TaskService, LlmService). Handlers are thin dispatchers: parse input, call service, format response.

### Anti-Pattern 2: Shared Prisma Client Without Module Boundary

**What people do:** Import PrismaService everywhere and write raw Prisma queries in any module — e.g., the Telegram handler directly queries tasks.

**Why it's wrong:** No ownership of data access patterns. Query changes in one module break another. Cannot enforce business rules (e.g., workspace isolation) consistently.

**Do this instead:** Only the Task Module queries the `task` table. Other modules call `TaskService` methods. The repository pattern (optional) further isolates query logic from business logic.

### Anti-Pattern 3: Storing Session in PostgreSQL

**What people do:** Write every conversation turn to PostgreSQL for durability, then query it on every incoming message.

**Why it's wrong:** Sessions are ephemeral (30-min TTL). PostgreSQL adds latency and unnecessary writes. Session schema changes require migrations. Cleaning up expired sessions requires a cron job.

**Do this instead:** Redis with TTL. Automatic expiry. Fast reads. If Redis loses data, the user simply starts a new conversation — acceptable for ephemeral context.

### Anti-Pattern 4: One LLM Call per Module

**What people do:** Each module initializes its own Anthropic client, manages its own prompts, and makes independent API calls.

**Why it's wrong:** No centralized token tracking or cost monitoring. Model routing logic duplicated. Error handling inconsistent. Cannot apply global rate limiting.

**Do this instead:** Single LLM Module with a centralized service. All modules call `LlmService` methods. Prompts and schemas co-located in `llm/prompts/` and `llm/schemas/`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **Telegram Bot API** | Webhook (POST to `/api/telegram/webhook`). grammY handles update parsing. | Must set webhook URL via `bot.api.setWebhook()` on startup. Verify webhook secret for security. Voice messages require `getFile()` + HTTP download of OGG. |
| **Anthropic Claude API** | Direct SDK (`@anthropic-ai/sdk`). Synchronous request-response per message. | Two models: Opus for decomposition, Sonnet for structured ops. Structured output via JSON mode. Retry with exponential backoff on 429/500. |
| **OpenAI Whisper API** | REST POST to `/v1/audio/transcriptions`. Multipart form upload (OGG buffer). | Returns plain text. Fast (~1-2s for typical voice messages). No streaming needed. |
| **Google Calendar API** (Phase 2) | Google APIs Node.js client. OAuth 2.0 with stored refresh token. | One-time browser-based OAuth setup. Refresh token stored in DB or env. Scopes: `calendar.events`. |
| **Redis (Upstash)** | `ioredis` client via BullMQ and direct access for sessions. | Single connection shared. BullMQ uses it for job queues. Session module uses it for key-value with TTL. Upstash requires TLS connection string. |
| **PostgreSQL (Neon)** | Prisma ORM with connection string. | Neon serverless driver compatible with Prisma. Connection pooling via Neon's built-in pooler (port 5432 for direct, 6543 for pooled). Use pooled connection for production. |

### Internal Module Communication

| Boundary | Direction | Communication | Notes |
|----------|-----------|---------------|-------|
| Telegram → LLM | Telegram calls LlmService | Direct DI (import LlmModule) | Classification and decomposition requests |
| Telegram → Task | Telegram calls TaskService | Direct DI (import TaskModule) | Task creation, status updates from button presses |
| Telegram → Session | Telegram calls SessionService | Direct DI (import SessionModule) | Load/save session on every inbound message |
| Telegram → Whisper | Telegram calls WhisperService | Direct DI (import WhisperModule) | Voice message transcription |
| Task → Scheduler | Task calls ReminderProducer | Direct DI (import SchedulerModule) | Enqueue reminder when deadline set |
| Scheduler → Task | Processor calls TaskService | Direct DI (import TaskModule) | Load task data when reminder fires |
| Scheduler → Telegram | Processor calls TelegramService | Direct DI (import TelegramModule) | Send reminder/check-in notification |
| LLM → Session | LlmService reads session context | Direct DI (import SessionModule) | Include message history in LLM calls |
| Calendar → Contact | CalendarService calls ContactService | Direct DI (import ContactModule) | Resolve attendee names to emails |
| Calendar → Task | CalendarService reads task data | Direct DI (import TaskModule) | Get task details for calendar event |

### Module Dependency Graph (Build Order)

```
Level 0 (no deps):     common/  config/  prisma/
Level 1 (infra only):  session/  whisper/  contact/
Level 2 (domain):      workspace/  task/
Level 3 (intelligence): llm/
Level 4 (scheduling):  scheduler/
Level 5 (interface):   telegram/
Level 6 (Phase 2):     calendar/
Level 7 (Phase 3):     REST API / dashboard endpoints
```

**Build order rationale:** Start from the bottom (data stores and configuration), build up through domain modules, then add intelligence, scheduling, and finally the interface layer. The Telegram module depends on nearly everything else, so it is assembled last. This means the first thing you build (Prisma + Task + Workspace) is testable without Telegram — you can validate the domain layer with unit tests before wiring up the bot.

## Suggested Build Sequence

Based on the dependency graph, the recommended build order within Phase 1 is:

1. **Project scaffold + Config + Prisma** — NestJS project, environment config, database schema, migrations. Everything else depends on this.
2. **Task Module + Workspace Module** — Core domain. CRUD, status lifecycle, sub-task derivation, workspace isolation. Testable in isolation.
3. **Session Module** — Redis connection, session CRUD with TTL. Required before any conversational feature works.
4. **LLM Module** — Claude API integration, prompt templates, structured output schemas. Depends on session for context.
5. **Whisper Module** — Voice transcription. Independent of LLM module. Can be built in parallel with step 4.
6. **Telegram Module** — Webhook, message routing, handlers, keyboards. Depends on all the above. This is the integration layer that wires everything together.
7. **Scheduler Module** — BullMQ setup, reminder producers and processors. Can start after Task Module exists but full integration requires Telegram Module for notifications.

## Sources

- [NestJS Official Documentation — Modules](https://docs.nestjs.com/modules) — Module architecture, imports/exports, global modules
- [NestJS Official Documentation — Queues](https://docs.nestjs.com/techniques/queues) — BullMQ integration pattern
- [NestJS Official Documentation — Prisma Recipe](https://docs.nestjs.com/recipes/prisma) — PrismaService pattern
- [BullMQ NestJS Guide](https://docs.bullmq.io/guide/nestjs) — WorkerHost processor pattern, queue registration
- [grammY Framework Comparison](https://grammy.dev/resources/comparison) — grammY vs Telegraf: TypeScript support, documentation quality
- [@grammyjs/nestjs npm](https://www.npmjs.com/package/@grammyjs/nestjs) — NestJS adapter for grammY
- [Prisma NestJS Guide](https://www.prisma.io/docs/guides/nestjs) — Modern Prisma + NestJS integration with connection management

---
*Architecture research for: LLM-powered Telegram bot task management system*
*Researched: 2026-02-27*
