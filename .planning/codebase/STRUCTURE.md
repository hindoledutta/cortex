# Codebase Structure

**Analysis Date:** 2026-02-27

## Directory Layout

```
cortex/
├── docs/                          # Project documentation
│   └── hld.md                     # High-level design document (SSOT for architecture)
│
├── src/                           # Application source code (planned)
│   ├── main.ts                    # NestJS application bootstrap
│   ├── app.module.ts              # Root module with all feature modules
│   ├── app.controller.ts           # Health check endpoint
│   │
│   ├── modules/                   # Domain-driven modules
│   │   ├── telegram/              # Telegram bot integration
│   │   │   ├── telegram.module.ts
│   │   │   ├── telegram.controller.ts        # POST /webhook/telegram
│   │   │   ├── telegram.service.ts           # Bot API operations
│   │   │   └── dto/
│   │   │       ├── telegram-update.dto.ts    # Incoming webhook payload
│   │   │       └── telegram-response.dto.ts  # Message send response
│   │   │
│   │   ├── llm/                   # LLM interactions (Claude)
│   │   │   ├── llm.module.ts
│   │   │   ├── llm.service.ts                # Claude API calls
│   │   │   ├── prompts/
│   │   │   │   ├── decomposition.prompt.ts  # Brain dump decomposition
│   │   │   │   ├── classification.prompt.ts # Message classification
│   │   │   │   ├── followup.prompt.ts       # Follow-up question generation
│   │   │   │   └── comment-parsing.prompt.ts
│   │   │   └── dto/
│   │   │       ├── decomposition-response.dto.ts
│   │   │       └── classification-response.dto.ts
│   │   │
│   │   ├── task/                  # Task management domain
│   │   │   ├── task.module.ts
│   │   │   ├── task.service.ts               # Task CRUD, lifecycle, hierarchy
│   │   │   ├── entities/
│   │   │   │   ├── task.entity.ts           # Prisma-mapped Task model
│   │   │   │   └── comment.entity.ts        # Comment entity
│   │   │   ├── dto/
│   │   │   │   ├── create-task.dto.ts
│   │   │   │   ├── update-task.dto.ts
│   │   │   │   ├── update-status.dto.ts
│   │   │   │   └── create-comment.dto.ts
│   │   │   └── task.controller.ts           # Future API endpoints for dashboard
│   │   │
│   │   ├── workspace/             # Workspace separation logic
│   │   │   ├── workspace.module.ts
│   │   │   ├── workspace.service.ts         # Workspace queries, defaults
│   │   │   ├── entities/
│   │   │   │   └── workspace.entity.ts      # Prisma-mapped Workspace model
│   │   │   └── dto/
│   │   │       └── workspace-config.dto.ts
│   │   │
│   │   ├── calendar/              # Google Calendar integration (Phase 2)
│   │   │   ├── calendar.module.ts
│   │   │   ├── calendar.service.ts          # Google Calendar API operations
│   │   │   ├── contact.service.ts           # Stakeholder email resolution
│   │   │   ├── entities/
│   │   │   │   ├── calendar-event.entity.ts
│   │   │   │   └── contact.entity.ts
│   │   │   └── dto/
│   │   │       ├── create-event.dto.ts
│   │   │       └── parse-calendar-intent.dto.ts
│   │   │
│   │   ├── session/               # Conversation session management
│   │   │   ├── session.module.ts
│   │   │   ├── session.service.ts           # Redis-backed session store
│   │   │   └── dto/
│   │   │       └── session-context.dto.ts
│   │   │
│   │   ├── scheduler/             # Background job scheduling (BullMQ)
│   │   │   ├── scheduler.module.ts
│   │   │   ├── scheduler.service.ts         # Job enqueuing, registration
│   │   │   ├── jobs/
│   │   │   │   ├── reminder-deadline.job.ts
│   │   │   │   ├── reminder-checkin.job.ts
│   │   │   │   └── reminder-deferred.job.ts
│   │   │   └── processors/
│   │   │       └── reminder.processor.ts    # BullMQ job handler
│   │   │
│   │   └── config/                # Configuration module
│   │       ├── config.module.ts
│   │       └── configuration.ts    # Environment variable schema + validation
│   │
│   ├── common/                    # Shared utilities, filters, guards
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts    # Global exception handler
│   │   ├── guards/
│   │   │   └── telegram-auth.guard.ts      # Chat ID validation
│   │   ├── middleware/
│   │   │   └── request-logging.middleware.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts          # DTO validation
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts
│   │   ├── logging/
│   │   │   └── logger.service.ts           # Structured logging
│   │   └── types/
│   │       ├── task.types.ts               # TypeScript interfaces for Task domain
│   │       ├── workspace.types.ts
│   │       └── telegram.types.ts
│   │
│   └── utils/                     # Utility functions
│       ├── date.utils.ts          # Deadline/reminder date calculations
│       ├── string.utils.ts        # Task title generation, parsing
│       └── json.utils.ts          # Safe JSON parsing for LLM responses
│
├── prisma/                        # Database schema and migrations
│   ├── schema.prisma              # Data model definition (ORM-agnostic)
│   ├── migrations/                # Auto-generated migration files
│   └── seed.ts                    # Optional: seed script for demo data
│
├── docker/                        # Docker configuration
│   ├── Dockerfile                 # Multi-stage build for Fly.io
│   └── docker-compose.yml         # Local dev: PostgreSQL + Redis
│
├── tests/                         # Test suite (planned)
│   ├── unit/                      # Unit tests for services, utils
│   │   ├── task.service.spec.ts
│   │   ├── llm.service.spec.ts
│   │   └── ...
│   ├── integration/               # Integration tests
│   │   ├── telegram-flow.spec.ts  # Full brain dump flow
│   │   ├── task-status.spec.ts
│   │   └── ...
│   └── fixtures/                  # Test data factories
│       ├── task.factory.ts
│       ├── workspace.factory.ts
│       └── telegram.fixtures.ts
│
├── config/                        # Configuration files
│   ├── tsconfig.json              # TypeScript compiler config with path aliases
│   ├── .eslintrc.js               # ESLint rules
│   ├── .prettierrc                # Code formatting
│   ├── jest.config.js             # Jest test runner config
│   ├── nest-cli.json              # NestJS CLI config
│   ├── fly.toml                   # Fly.io deployment config
│   └── .env.example               # Template for environment variables
│
├── .github/                       # GitHub Actions CI/CD (planned)
│   └── workflows/
│       ├── test.yml               # Run tests on PR
│       └── deploy.yml             # Deploy to Fly.io on main merge
│
├── .planning/                     # GSD planning framework
│   └── codebase/
│       ├── STACK.md               # Technology stack analysis
│       ├── ARCHITECTURE.md        # Architecture patterns and layers
│       ├── STRUCTURE.md           # This file
│       ├── CONVENTIONS.md         # Coding conventions (to be created)
│       ├── TESTING.md             # Testing patterns (to be created)
│       └── INTEGRATIONS.md        # External service integrations (to be created)
│
├── docs/
│   └── hld.md                     # High-level design (source of truth)
│
├── README.md                      # Project overview
├── package.json                   # Node.js dependencies and scripts
├── package-lock.json              # Dependency lock file
└── .gitignore                     # Git ignore patterns
```

## Directory Purposes

**src/:**
- Purpose: Application source code (organized by domain module)
- Contains: NestJS modules, services, controllers, DTOs, entities
- Key files: `main.ts` (bootstrap), `app.module.ts` (module registration)

**src/modules/:**
- Purpose: Domain-driven feature modules aligned with business capabilities
- Contains: Feature-specific controllers, services, DTOs, entities
- Key files: Each module has `{feature}.module.ts`, `{feature}.service.ts`, `{feature}.controller.ts` (if applicable)

**src/common/:**
- Purpose: Shared cross-cutting concerns (logging, validation, auth, error handling)
- Contains: Guards, filters, middleware, interceptors, shared types, utilities
- Key files: `logger.service.ts`, `all-exceptions.filter.ts`, `telegram-auth.guard.ts`

**src/utils/:**
- Purpose: Reusable utility functions (date calculations, parsing, formatting)
- Contains: Pure functions, no state
- Key files: Organized by concern (date, string, JSON)

**prisma/:**
- Purpose: Database schema definition and migrations
- Contains: `schema.prisma` (source of truth for data model), auto-generated migration files
- Key files: `schema.prisma` (entities: Workspace, Task, Comment, Contact, CalendarEvent, ConversationSession)

**tests/:**
- Purpose: Test suite organized by test type
- Contains: Unit tests (services, utils), integration tests (full flows), test fixtures/factories
- Key files: `*.spec.ts` files, `fixtures/` for test data factories

**docker/:**
- Purpose: Container configuration for local dev and production deployment
- Contains: Dockerfile (multi-stage build), docker-compose.yml (local dev stack with Postgres + Redis)
- Key files: `Dockerfile` (production), `docker-compose.yml` (dev environment)

**config/:**
- Purpose: Build and runtime configuration files
- Contains: TypeScript, ESLint, Prettier, Jest, NestJS CLI, Fly.io, environment templates
- Key files: `tsconfig.json`, `.eslintrc.js`, `jest.config.js`, `fly.toml`

**.planning/:**
- Purpose: GSD (Get Shit Done) framework and codebase analysis documents
- Contains: STACK.md, ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, INTEGRATIONS.md, CONCERNS.md
- Key files: Documents generated by mapping commands for future phases

## Key File Locations

**Entry Points:**
- `src/main.ts`: Application bootstrap - NestJS app creation, module registration, HTTP listener startup
- `src/app.module.ts`: Root module definition - imports all feature modules (Telegram, LLM, Task, Workspace, Calendar, Scheduler, Config, Session)

**Configuration:**
- `prisma/schema.prisma`: Data model (Workspace, Task, Comment, Contact, CalendarEvent, ConversationSession)
- `config/tsconfig.json`: TypeScript compiler options with path aliases (@modules/, @services/, @dto/, @types/, @utils/)
- `config/.env.example`: Template for required environment variables

**Core Logic:**
- `src/modules/telegram/telegram.controller.ts`: HTTP endpoint for incoming Telegram webhooks
- `src/modules/telegram/telegram.service.ts`: Telegram Bot API client operations (send message, download file, edit keyboard)
- `src/modules/llm/llm.service.ts`: Claude API interactions (Opus for decomposition, Sonnet for structured operations)
- `src/modules/task/task.service.ts`: Task CRUD, lifecycle management, sub-task hierarchy, status transitions
- `src/modules/workspace/workspace.service.ts`: Workspace queries, default workspace resolution
- `src/modules/session/session.service.ts`: Redis-backed conversation session management
- `src/modules/scheduler/scheduler.service.ts`: BullMQ job enqueueing and processor registration

**Testing:**
- `tests/unit/`: Unit tests for services, utils, pure functions
- `tests/integration/`: Integration tests for complete flows (brain dump → task creation → follow-up)
- `tests/fixtures/`: Test data factories for consistent test setup

## Naming Conventions

**Files:**
- Feature modules: `{feature}.module.ts`, `{feature}.service.ts`, `{feature}.controller.ts`
- DTOs: `{operation}.dto.ts` (e.g., `create-task.dto.ts`, `update-status.dto.ts`)
- Entities: `{entity}.entity.ts` (Prisma-mapped)
- Prompts: `{purpose}.prompt.ts` (e.g., `decomposition.prompt.ts`, `classification.prompt.ts`)
- Job/Processor files: `{job-name}.job.ts`, `{processor-name}.processor.ts`
- Test files: `{file-under-test}.spec.ts` (co-located with source)
- Guards/Middleware: `{purpose}.guard.ts`, `{purpose}.middleware.ts`

**Directories:**
- Feature modules: Singular noun, lowercase (`telegram/`, `llm/`, `task/`, `workspace/`, `calendar/`, `scheduler/`, `session/`)
- Shared utilities: Plural noun, lowercase (`common/`, `utils/`, `filters/`, `guards/`, `middleware/`)
- Configuration: `config/`, `.github/`
- Tests: `tests/` with subdirectories by type (`unit/`, `integration/`, `fixtures/`)

## Where to Add New Code

**New Feature (e.g., notification system, dashboard API):**
- Primary code: Create new module in `src/modules/{feature}/` with structure: `{feature}.module.ts`, `{feature}.service.ts`, `{feature}.controller.ts` (if HTTP endpoints), `dto/`, `entities/` (if database)
- Tests: `tests/unit/{feature}.service.spec.ts`, `tests/integration/{feature}-flow.spec.ts`
- Registration: Import new module in `src/app.module.ts` imports array

**New Service/Helper Utility:**
- Implementation: `src/utils/{concern}.utils.ts` (pure functions)
- Tests: `tests/unit/{concern}.utils.spec.ts`
- Usage: Import and call from services that need the utility

**New API Endpoint (Dashboard phase):**
- Controller method: Add to appropriate module controller (e.g., `TaskController` in `src/modules/task/task.controller.ts`)
- DTO: Create request/response DTOs in `src/modules/{feature}/dto/`
- Service method: Add business logic to `src/modules/{feature}/{feature}.service.ts`
- Tests: Unit test the service method, integration test the HTTP flow

**New Job/Scheduler Task (e.g., new reminder type):**
- Job definition: `src/modules/scheduler/jobs/{job-name}.job.ts`
- Processor: `src/modules/scheduler/processors/{processor-name}.processor.ts`
- Enqueuing: Add logic to appropriate service (e.g., `TaskService` for deadline reminders on task creation)
- Registration: Register processor in `SchedulerModule` on app bootstrap

**Database Migration (schema changes):**
- Edit `prisma/schema.prisma` (add/modify model or field)
- Generate migration: `npx prisma migrate dev --name {migration_name}`
- Auto-migrates on deploy; roll back if needed via `npx prisma migrate resolve --rolled-back {migration_name}`

## Special Directories

**src/common/:**
- Purpose: Shared cross-cutting concerns
- Generated: No
- Committed: Yes (shared code)

**prisma/migrations/:**
- Purpose: Auto-generated database migration files
- Generated: Yes (by Prisma CLI)
- Committed: Yes (track schema history)

**.planning/codebase/:**
- Purpose: Analysis documents for future implementation phases
- Generated: Yes (by mapping commands)
- Committed: Yes (reference for executors)

**node_modules/ and .next/ (if PWA added):**
- Purpose: Dependencies and build artifacts
- Generated: Yes
- Committed: No (.gitignore entries)

---

*Structure analysis: 2026-02-27*
