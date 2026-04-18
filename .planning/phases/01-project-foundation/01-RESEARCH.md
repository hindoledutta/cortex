# Phase 1: Project Foundation - Research

**Researched:** 2026-02-27
**Domain:** NestJS domain layer with Prisma ORM, task management domain model, workspace isolation
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational domain layer for Cortex: NestJS 11 scaffold, Prisma 7 schema with PostgreSQL, task CRUD through a service layer, status lifecycle management, parent-child sub-task relationships with derived parent status, and workspace isolation. This phase has no external interfaces (no Telegram, no LLM, no calendar) -- it is pure domain logic, testable through service-layer unit and integration tests.

The technology stack is stable and well-documented. NestJS 11.1.x is the current stable release (Feb 2026) with no breaking changes from 11.0. Prisma 7.4.x is current and introduces a significant architectural shift: Rust-free query engine, mandatory driver adapters (replacing the embedded query engine), a new `prisma.config.ts` file, and the `prisma-client` generator (replacing `prisma-client-js`). These Prisma 7 changes are well-documented but represent breaking changes from older tutorials -- all configuration must follow the v7 pattern.

**Primary recommendation:** Scaffold NestJS 11 with Prisma 7 using the driver adapter pattern (`@prisma/adapter-pg`), define the task/workspace domain model with enums for status and priority, implement a thin service layer (TaskService, WorkspaceService) with workspace-scoped queries, and validate everything with Vitest unit tests.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Priority: High / Medium / Low (3-level)
- Deadline: Optional (nullable) -- most brain-dump tasks won't have one initially
- Description: Free-text field for additional context
- Titles: LLM-generated concise titles (Phase 2); original input stored as source context
- No effort estimate field in v1 -- can be added in Phase 5 for calendar time-blocking
- Statuses: captured, active, in_progress, done, blocked, deferred
- Flexible transitions -- any status can move to any other status (no enforced linear flow)
- "Captured" = unprocessed inbox state. Brain dump lands here. Becomes "active" after LLM decomposition and user confirmation
- Deferred tasks have an optional resume date (nullable) -- for Phase 4 resurfacing, but not required
- Soft delete only -- no "cancelled" status. Deleted tasks are hidden but recoverable
- Sub-tasks are one level deep (no nesting beyond parent -> child)
- Parent status is always computed from children, never manually overridden
- Derivation rule: progress-based -- 0% done = active, 1-99% = in_progress, 100% = done. Blocked/deferred only if ALL children are blocked/deferred
- Sub-tasks are reorderable -- position/order field, LLM sets initial order, user can rearrange
- Reparenting allowed -- sub-tasks can be moved between parents or promoted to standalone tasks
- Two hardcoded workspaces: Personal and Work (no custom workspaces)
- Default workspace: Work
- Isolation via workspace column + query filter on all queries (no schema separation)
- @work / @personal prefix is a routing signal -- stripped from task title after workspace assignment

### Claude's Discretion
- Database schema design and Prisma model structure
- NestJS module organization and service patterns
- Exact soft delete implementation (deleted_at timestamp vs flag)
- Validation rules and error handling patterns
- Test structure and coverage approach

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TASK-01 | User can create, read, update, and delete tasks | TaskService CRUD methods with Prisma Client; soft delete via `deletedAt` timestamp column; all queries filter `deletedAt IS NULL` by default |
| TASK-02 | Tasks follow status lifecycle: captured -> active -> in_progress -> done (+ blocked, deferred) | Prisma enum `TaskStatus` with 6 values; flexible transitions (no state machine enforcement per user decision); service validates status is a valid enum value |
| TASK-03 | Tasks can have sub-tasks one level deep; parent status auto-derives from children | Prisma self-referential one-to-many relation on Task model; depth enforcement in service layer (reject child-of-child); computed parent status in service method using progress-based derivation rule |
| WKSP-01 | Tasks are isolated by workspace (Personal / Work) with hard boundaries | Workspace column on Task + mandatory workspace filter on every query; two seeded workspace rows; no cross-workspace queries possible through service API |
| WKSP-02 | User can override workspace with @work / @personal prefix | Prefix parsing utility function that extracts workspace signal and returns cleaned title; integrated into task creation flow |
| WKSP-03 | User can set and switch static default workspace | Workspace model with `isDefault` boolean; service method to get/set default; exactly one workspace is default at any time |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/core` | 11.1.x | Application framework | Module system fits domain separation; TypeScript-first; DI container for testability |
| `@nestjs/common` | 11.1.x | Decorators, pipes, guards | Standard companion to @nestjs/core |
| `@nestjs/platform-express` | 11.1.x | HTTP adapter | Default NestJS platform; required even for non-HTTP phases (app bootstrap) |
| `prisma` | 7.4.x | CLI, migrations, schema management | Dev dependency for `prisma migrate`, `prisma generate`, `prisma db seed` |
| `@prisma/client` | 7.4.x | Type-safe database client | Generated from schema; full TypeScript type safety; query builder |
| `@prisma/adapter-pg` | 7.4.x | PostgreSQL driver adapter | **Required in Prisma 7** -- replaces embedded Rust query engine |
| `pg` | 8.x | PostgreSQL driver | Underlying driver used by @prisma/adapter-pg |
| TypeScript | 5.5+ | Language | NestJS 11 requires TS 5.4+; Prisma 7 requires TS 5.4+ |
| Node.js | 22.x | Runtime | Prisma 7 requires Node 20.19+; NestJS 11 supports Node 20/22; use LTS 22 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/config` | 4.x | Environment variable loading | Load DATABASE_URL and other env vars via ConfigModule |
| `class-validator` | 0.14.x | DTO validation | Validate incoming data to service methods (title required, status enum, etc.) |
| `class-transformer` | 0.5.x | DTO transformation | Transform plain objects to class instances for validation |
| `dotenv` | 16.x | Environment variables | **Required by Prisma 7** -- env vars no longer auto-loaded |
| `uuid` | 11.x | UUID generation | If not using Prisma's `@default(uuid())` -- likely not needed |

### Dev Dependencies
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 3.x | Test runner | Faster than Jest, native ESM, excellent TS support |
| `unplugin-swc` | 1.x | SWC plugin for Vitest | Required: NestJS decorators need `emitDecoratorMetadata` which esbuild lacks |
| `@swc/core` | 1.x | SWC compiler | Required by unplugin-swc for decorator metadata support |
| `@vitest/coverage-v8` | 3.x | Coverage reporting | Code coverage for domain layer tests |
| `@nestjs/testing` | 11.1.x | Test utilities | `Test.createTestingModule()` for service unit tests |
| `tsx` | 4.x | TypeScript execution | Run seed scripts (`tsx prisma/seed.ts`) |
| `@nestjs/cli` | 11.x | Project scaffold and codegen | `nest new`, `nest generate module/service` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest | Jest | Jest is NestJS default but slower, worse ESM support, memory issues on large suites. Vitest requires SWC plugin setup but is 3-4x faster. |
| class-validator | zod | Zod is more composable but doesn't integrate with NestJS ValidationPipe natively. class-validator is the NestJS ecosystem standard. |
| @prisma/adapter-pg | @prisma/adapter-pg-worker | pg-worker is for serverless/edge. Standard pg adapter is correct for Fly.io long-running process. |

**Installation:**
```bash
# Core
npm install @nestjs/core @nestjs/common @nestjs/platform-express @nestjs/config
npm install @prisma/client @prisma/adapter-pg pg
npm install class-validator class-transformer
npm install dotenv

# Dev
npm install -D prisma @nestjs/cli @nestjs/testing
npm install -D vitest unplugin-swc @swc/core @vitest/coverage-v8
npm install -D tsx typescript @types/node @types/pg
```

## Architecture Patterns

### Recommended Project Structure
```
cortex/
├── prisma/
│   ├── schema.prisma            # Data model, enums, relations
│   ├── migrations/              # Auto-generated migration files
│   └── seed.ts                  # Seed Personal + Work workspaces
├── prisma.config.ts             # Prisma 7 config (datasource, migrations)
├── src/
│   ├── app.module.ts            # Root module, imports all feature modules
│   ├── main.ts                  # Bootstrap
│   ├── prisma/
│   │   ├── prisma.module.ts     # Global Prisma module
│   │   └── prisma.service.ts    # PrismaClient wrapper with adapter
│   ├── workspace/
│   │   ├── workspace.module.ts
│   │   ├── workspace.service.ts # Workspace CRUD, default management
│   │   ├── workspace.service.spec.ts
│   │   └── dto/
│   │       └── ...
│   └── task/
│       ├── task.module.ts
│       ├── task.service.ts      # Task CRUD, status, sub-tasks, soft delete
│       ├── task.service.spec.ts
│       ├── task-status.util.ts  # Parent status derivation logic
│       ├── workspace-prefix.util.ts  # @work/@personal parsing
│       └── dto/
│           ├── create-task.dto.ts
│           └── update-task.dto.ts
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

### Pattern 1: PrismaService with Driver Adapter (Prisma 7)

**What:** Wrap PrismaClient in a NestJS injectable service using the new Prisma 7 driver adapter pattern.
**When to use:** Every project using Prisma 7 with NestJS.

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    super({ adapter });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

```typescript
// src/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**Source:** [Prisma NestJS Guide](https://www.prisma.io/docs/guides/nestjs), [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)

### Pattern 2: Workspace-Scoped Queries

**What:** Every task query includes a mandatory workspace filter to enforce isolation.
**When to use:** Every read operation on tasks.

```typescript
// src/task/task.service.ts
@Injectable()
export class TaskService {
  constructor(private prisma: PrismaService) {}

  async findAll(workspaceId: string) {
    return this.prisma.task.findMany({
      where: {
        workspaceId,
        deletedAt: null,    // soft delete filter
        parentId: null,     // top-level tasks only
      },
      include: {
        children: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

**Key insight:** The `workspaceId` parameter is REQUIRED on every query method. There is no method to query tasks across workspaces. This is enforced at the service API level, not by database-level RLS.

### Pattern 3: Computed Parent Status (Service-Level Derivation)

**What:** Parent task status is never stored in the database. It is computed from children on read.
**When to use:** Every time a parent task is returned.

```typescript
// src/task/task-status.util.ts
import { TaskStatus } from '../generated/prisma/client';

export function deriveParentStatus(childStatuses: TaskStatus[]): TaskStatus {
  if (childStatuses.length === 0) {
    return TaskStatus.active; // no children = standalone task
  }

  const doneCount = childStatuses.filter(s => s === TaskStatus.done).length;
  const total = childStatuses.length;

  // 100% done = done
  if (doneCount === total) return TaskStatus.done;

  // All blocked/deferred = blocked/deferred
  const allBlocked = childStatuses.every(
    s => s === TaskStatus.blocked || s === TaskStatus.deferred
  );
  if (allBlocked) {
    const allDeferred = childStatuses.every(s => s === TaskStatus.deferred);
    return allDeferred ? TaskStatus.deferred : TaskStatus.blocked;
  }

  // 1-99% done = in_progress
  if (doneCount > 0) return TaskStatus.in_progress;

  // 0% done = active (default)
  return TaskStatus.active;
}
```

**Design decision:** Status is computed in the service layer, NOT stored on the parent. This avoids consistency issues. When a child status changes, the parent's derived status automatically reflects it on the next read. No update triggers or event listeners needed.

**Alternative considered:** Prisma Client Extension `result` component for computed fields. Rejected because parent status depends on child records (a relation), and Prisma computed fields can only depend on scalar fields of the same record.

### Pattern 4: Soft Delete via deletedAt Timestamp

**What:** Use a nullable `DateTime` column (`deletedAt`) instead of a boolean flag. All queries filter `deletedAt IS NULL`.
**When to use:** All task delete operations and all task read operations.

```typescript
// Soft delete
async softDelete(id: string, workspaceId: string) {
  return this.prisma.task.update({
    where: { id, workspaceId },
    data: { deletedAt: new Date() },
  });
}

// Restore
async restore(id: string, workspaceId: string) {
  return this.prisma.task.update({
    where: { id, workspaceId },
    data: { deletedAt: null },
  });
}
```

**Why timestamp over boolean:** A timestamp records WHEN something was deleted, enabling "deleted in last 30 days" queries and time-based cleanup. A boolean only tells you it was deleted.

### Pattern 5: Workspace Prefix Parsing

**What:** Parse @work / @personal prefix from task input, extract workspace signal, return cleaned title.
**When to use:** Task creation flow.

```typescript
// src/task/workspace-prefix.util.ts
export interface ParsedInput {
  title: string;
  workspaceOverride: 'work' | 'personal' | null;
}

export function parseWorkspacePrefix(input: string): ParsedInput {
  const match = input.match(/^@(work|personal)\s+/i);
  if (match) {
    return {
      title: input.slice(match[0].length).trim(),
      workspaceOverride: match[1].toLowerCase() as 'work' | 'personal',
    };
  }
  return { title: input.trim(), workspaceOverride: null };
}
```

### Anti-Patterns to Avoid

- **Storing derived parent status in the database:** Creates consistency bugs. Parent status and child statuses will drift apart unless you build a trigger/event system. Compute on read instead.
- **Allowing nested sub-tasks (child of child):** The schema allows self-referential relations to arbitrary depth. Enforcement must be in the service layer: reject creation of a task whose proposed parent already has a parent.
- **Cross-workspace queries in the service API:** Never expose a method like `findAllTasks()` without a workspace parameter. Even admin/debug queries should require explicit workspace selection.
- **Using Prisma middleware (`$use()`):** Removed in Prisma 7. Use Client Extensions (`$extends()`) instead if you need query interception.
- **Hardcoding database URL:** Use `@nestjs/config` with ConfigModule to load from environment. Prisma 7's `prisma.config.ts` uses `env()` helper for CLI operations, but runtime code should use NestJS ConfigService.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation | Custom UUID function | Prisma `@default(uuid())` | Database-generated, no collision risk, zero code |
| Timestamp management | Manual `new Date()` on every write | Prisma `@default(now())` and `@updatedAt` | Prisma handles created_at and updated_at automatically |
| Database migrations | Raw SQL migration scripts | `prisma migrate dev` / `prisma migrate deploy` | Type-safe, versioned, reversible migration workflow |
| Input validation | Manual if/else checks | `class-validator` decorators on DTOs | Declarative, composable, integrates with NestJS pipe |
| Enum validation | String comparison logic | Prisma-generated TypeScript enums | Type-safe at compile time AND database level |
| Connection pooling | Manual pool management | `@prisma/adapter-pg` handles pooling via `pg.Pool` | Driver adapter manages connection lifecycle |

**Key insight:** Prisma 7 handles most data-layer concerns (types, migrations, timestamps, UUIDs, enums). The service layer should focus on business logic (workspace isolation, sub-task depth enforcement, parent status derivation, soft delete filtering) and delegate data operations to Prisma.

## Common Pitfalls

### Pitfall 1: Prisma 7 Generator Name Change
**What goes wrong:** Using `provider = "prisma-client-js"` in schema.prisma causes generate to fail.
**Why it happens:** Prisma 7 renamed the generator from `prisma-client-js` to `prisma-client` and requires an explicit `output` path.
**How to avoid:** Use the new generator block:
```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated/prisma/client"
}
```
**Warning signs:** `prisma generate` errors about unknown provider.

### Pitfall 2: Missing Driver Adapter
**What goes wrong:** `new PrismaClient()` throws "must pass adapter or accelerateUrl".
**Why it happens:** Prisma 7 removed the embedded Rust query engine. You must provide a driver adapter explicitly.
**How to avoid:** Always construct PrismaClient with `{ adapter: new PrismaPg({ connectionString }) }`.
**Warning signs:** Runtime error on first database operation.

### Pitfall 3: Self-Referential Relation Cycles
**What goes wrong:** Prisma migration fails with referential action cycle error on the Task self-relation.
**Why it happens:** Default `onDelete: SetNull` and `onUpdate: Cascade` create a cycle on self-referential relations.
**How to avoid:** Explicitly set `onDelete: NoAction` and `onUpdate: NoAction` on one side of the self-relation:
```prisma
parent    Task?   @relation("SubTasks", fields: [parentId], references: [id], onDelete: NoAction, onUpdate: NoAction)
children  Task[]  @relation("SubTasks")
```
**Warning signs:** Prisma migrate error about cyclic referential actions.

### Pitfall 4: Prisma 7 Environment Variable Loading
**What goes wrong:** `prisma migrate dev` fails because DATABASE_URL is undefined.
**Why it happens:** Prisma 7 no longer auto-loads `.env` files. The `prisma.config.ts` must explicitly load them.
**How to avoid:** Add `import "dotenv/config"` at the top of `prisma.config.ts`, and install `dotenv` as a dependency.
**Warning signs:** "Environment variable not found" errors from Prisma CLI.

### Pitfall 5: Sub-Task Depth Not Enforced by Schema
**What goes wrong:** A sub-task gets created as a child of another sub-task, violating the one-level-deep rule.
**Why it happens:** Prisma's self-referential relation allows arbitrary depth. The schema cannot enforce max depth.
**How to avoid:** Service-layer check before creating a sub-task:
```typescript
if (parentId) {
  const parent = await this.prisma.task.findUnique({ where: { id: parentId } });
  if (parent?.parentId) {
    throw new BadRequestException('Sub-tasks cannot have sub-tasks (max 1 level deep)');
  }
}
```
**Warning signs:** Nested sub-tasks appearing in queries.

### Pitfall 6: Forgetting Soft Delete Filter
**What goes wrong:** Deleted tasks appear in query results.
**Why it happens:** Every query must explicitly add `where: { deletedAt: null }`. Easy to forget in new query methods.
**How to avoid:** Two strategies: (1) Prisma Client Extension that auto-adds the filter to all `findMany`/`findFirst`/`findUnique` operations, or (2) a helper method that wraps the base where clause. Option (2) is simpler and more transparent for Phase 1.
**Warning signs:** "Deleted" tasks showing up in task lists.

### Pitfall 7: Vitest Needs SWC for NestJS Decorators
**What goes wrong:** Vitest tests fail with "Reflect.getMetadata is not a function" or decorator errors.
**Why it happens:** Vitest uses esbuild by default, which does not support `emitDecoratorMetadata`. NestJS relies on decorator metadata for dependency injection.
**How to avoid:** Install `unplugin-swc` and `@swc/core`, configure Vitest to use the SWC plugin, and create a `.swcrc` with `decoratorMetadata: true`.
**Warning signs:** Test failures related to undefined metadata or DI resolution errors.

### Pitfall 8: Prisma 7 Client Import Path
**What goes wrong:** Import `from '@prisma/client'` fails or gives wrong types.
**Why it happens:** Prisma 7 generates the client to a custom output path (`./generated/prisma/client`), not the default `@prisma/client` location.
**How to avoid:** Import from the generated path: `import { PrismaClient, TaskStatus } from '../generated/prisma/client'`. Set up a TypeScript path alias for convenience.
**Warning signs:** TypeScript "module not found" errors or stale types.

## Code Examples

### Prisma Schema (Phase 1 Domain Model)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client"
  output   = "./generated/prisma/client"
}

datasource db {
  provider = "postgresql"
}

enum TaskStatus {
  captured
  active
  in_progress
  done
  blocked
  deferred
}

enum TaskPriority {
  high
  medium
  low
}

enum WorkspaceName {
  personal
  work
}

model Workspace {
  id        String        @id @default(uuid())
  name      WorkspaceName @unique
  isDefault Boolean       @default(false)
  createdAt DateTime      @default(now()) @map("created_at")
  updatedAt DateTime      @updatedAt @map("updated_at")
  tasks     Task[]

  @@map("workspaces")
}

model Task {
  id             String       @id @default(uuid())
  workspaceId    String       @map("workspace_id")
  workspace      Workspace    @relation(fields: [workspaceId], references: [id])
  parentId       String?      @map("parent_id")
  parent         Task?        @relation("SubTasks", fields: [parentId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  children       Task[]       @relation("SubTasks")
  title          String
  description    String?
  sourceInput    String?      @map("source_input")
  status         TaskStatus   @default(captured)
  priority       TaskPriority @default(medium)
  blockedReason  String?      @map("blocked_reason")
  deferredUntil  DateTime?    @map("deferred_until")
  deadline       DateTime?
  position       Int          @default(0)
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")
  completedAt    DateTime?    @map("completed_at")
  deletedAt      DateTime?    @map("deleted_at")

  @@index([workspaceId, deletedAt])
  @@index([parentId])
  @@map("tasks")
}
```

**Source:** [Prisma Self-Relations Docs](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/self-relations), [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)

### Prisma 7 Configuration File

```typescript
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

### Database Seed Script

```typescript
// prisma/seed.ts
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.workspace.upsert({
    where: { name: 'work' },
    update: {},
    create: { name: 'work', isDefault: true },
  });

  await prisma.workspace.upsert({
    where: { name: 'personal' },
    update: {},
    create: { name: 'personal', isDefault: false },
  });

  console.log('Seeded workspaces: work (default), personal');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
```

### Vitest Configuration for NestJS

```typescript
// vitest.config.ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.module.ts', 'src/main.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@generated': resolve(__dirname, './prisma/generated'),
    },
  },
  plugins: [swc.vite()],
});
```

### SWC Configuration

```json
// .swcrc
{
  "sourceMaps": true,
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "decorators": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": true
    }
  }
}
```

### Service Unit Test Pattern

```typescript
// src/task/task.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { TaskService } from './task.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TaskService', () => {
  let service: TaskService;
  let prisma: PrismaService;

  const mockPrisma = {
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('should create a task in the specified workspace', async () => {
      const dto = { title: 'Test task', workspaceId: 'ws-1' };
      mockPrisma.task.create.mockResolvedValue({ id: '1', ...dto, status: 'captured' });

      const result = await service.create(dto);

      expect(mockPrisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Test task',
          workspaceId: 'ws-1',
          status: 'captured',
        }),
      });
      expect(result.status).toBe('captured');
    });
  });
});
```

**Source:** [NestJS Testing Docs](https://docs.nestjs.com/fundamentals/testing), [Vitest + NestJS setup guide](https://blog.ablo.ai/jest-to-vitest-in-nestjs)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `prisma-client-js` generator | `prisma-client` generator with explicit output | Prisma 7 (Nov 2024) | Import paths change; must update generator block |
| Embedded Rust query engine | Driver adapters (`@prisma/adapter-pg`) | Prisma 7 (Nov 2024) | 3x faster queries, 90% smaller bundles, explicit adapter required |
| `$use()` middleware | `$extends()` Client Extensions | Prisma 5.x+ (GA), `$use()` removed in 7 | Soft delete must use extensions or service-layer filtering |
| Auto-loaded `.env` files | Explicit `dotenv/config` import in `prisma.config.ts` | Prisma 7 (Nov 2024) | Must install dotenv and import explicitly |
| `datasource.url` in schema.prisma | `datasource.url` in `prisma.config.ts` | Prisma 7 (Nov 2024) | Schema file no longer has connection string |
| Jest (NestJS default) | Vitest + SWC (community adoption) | 2024-2025 trend | 3-4x faster test runs; requires SWC plugin for decorators |

**Deprecated/outdated:**
- `prisma-client-js`: Replaced by `prisma-client` in Prisma 7. All tutorials before Nov 2024 use the old name.
- `PrismaClient.$use()`: Removed in Prisma 7. Any middleware patterns must be rewritten as Client Extensions.
- `@prisma/client` default import: Prisma 7 generates to a custom output directory. Import path depends on `output` in generator block.

## Open Questions

1. **ESM vs CommonJS for NestJS**
   - What we know: Prisma 7 recommends `"type": "module"` in package.json. NestJS 11 has experimental ESM support but most NestJS projects still use CommonJS.
   - What's unclear: Whether NestJS 11 + Prisma 7 works cleanly with CommonJS, or if ESM is required.
   - Recommendation: Start with CommonJS (NestJS default). Prisma 7's `prisma.config.ts` handles ESM for CLI operations independently. If CommonJS causes issues with Prisma client imports, switch to ESM. This is LOW risk -- Prisma's adapter-pg works in both module systems.

2. **Prisma Client Output Path Convention**
   - What we know: Prisma 7 requires explicit `output` in the generator. Official docs show `./generated/prisma/client`.
   - What's unclear: Whether to put generated code in `prisma/generated/` (next to schema) or `src/generated/` (in source tree).
   - Recommendation: Use `prisma/generated/prisma/client` (next to schema, outside src). Add to `.gitignore`. Set up a TypeScript path alias `@generated` for clean imports.

3. **Neon PostgreSQL Connection with Prisma 7 Adapter**
   - What we know: Neon uses connection pooling and may require SSL. Prisma 7's pg adapter has stricter SSL defaults.
   - What's unclear: Whether `@prisma/adapter-pg` works with Neon's pooled connection string out of the box, or if SSL configuration is needed.
   - Recommendation: Test early with Neon connection string. If SSL issues arise, pass `ssl: { rejectUnauthorized: false }` to the adapter config. Neon's connection strings typically include `sslmode=require` which should work.

## Sources

### Primary (HIGH confidence)
- [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7) - Breaking changes, adapter setup, config file
- [Prisma Self-Relations Docs](https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/self-relations) - One-to-many self-referential pattern
- [Prisma NestJS Integration Guide](https://www.prisma.io/docs/guides/nestjs) - PrismaService pattern, module setup
- [Prisma Config Reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference) - prisma.config.ts structure
- [NestJS 11 Release](https://trilon.io/blog/announcing-nestjs-11-whats-new) - v11 features and changes
- [NestJS Testing Docs](https://docs.nestjs.com/fundamentals/testing) - TestingModule, mock providers
- [GitHub NestJS Releases](https://github.com/nestjs/nest/releases) - Confirmed v11.1.14 (Feb 2026)
- [GitHub Prisma Releases](https://github.com/prisma/prisma/releases) - Confirmed v7.4.1 (Feb 2025)

### Secondary (MEDIUM confidence)
- [Prisma 7 NestJS adapter blog](https://mgregersen.dk/upgrading-prisma-to-rust-free-client-in-nestjs/) - Real-world Prisma 7 + NestJS migration
- [Vitest + NestJS migration](https://blog.ablo.ai/jest-to-vitest-in-nestjs) - SWC plugin setup, config examples
- [Prisma soft delete patterns](https://matranga.dev/true-soft-deletion-in-prisma-orm/) - Client Extension approach
- [NestJS Vitest setup](https://zenn.dev/maronn/articles/nestjs-vitest-migrate?locale=en) - unplugin-swc configuration

### Tertiary (LOW confidence)
- ESM/CJS compatibility for NestJS 11 + Prisma 7 -- no authoritative source found confirming ideal module system. Recommendation based on community patterns and NestJS defaults.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official releases and docs; versions confirmed current as of Feb 2026
- Architecture: HIGH - Patterns derived from official Prisma and NestJS documentation; self-referential relations verified in Prisma docs
- Pitfalls: HIGH - Prisma 7 breaking changes well-documented in official upgrade guide; NestJS/Vitest SWC requirement verified in multiple sources
- Domain model: HIGH - Schema directly maps to HLD data model and CONTEXT.md locked decisions

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (30 days -- stable ecosystem, no major releases expected)
