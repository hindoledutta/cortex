# Phase 2: Intelligence Layer - Research

**Researched:** 2026-02-28
**Domain:** LLM integration, session management, task decomposition, model routing
**Confidence:** HIGH

## Summary

Phase 2 builds the intelligence core of Cortex: accepting unstructured text brain dumps, decomposing them into structured parent + sub-task hierarchies via Claude Opus 4.6, routing simpler operations (classification, follow-up) to Claude Sonnet 4.6, maintaining multi-turn session context in Redis, and enriching existing tasks through follow-up answers. All services must be callable without Telegram.

The Anthropic TypeScript SDK (`@anthropic-ai/sdk`) provides everything needed: `messages.create()` with structured JSON output via `output_config.format`, token usage tracking via `message.usage`, and streaming support. Structured outputs are GA for both Opus 4.6 and Sonnet 4.6, using constrained decoding to guarantee schema-compliant JSON. For Redis, since the NestJS app runs as a long-lived process on Fly.io (not serverless), `ioredis` is the correct client -- it uses TCP connections which are more efficient than Upstash's HTTP REST client for persistent services. The `@upstash/redis` HTTP client is designed for serverless/edge environments.

**Primary recommendation:** Use `@anthropic-ai/sdk` directly (no LangChain/Vercel AI SDK abstraction layers) with structured JSON output via `output_config.format`, `ioredis` for Redis session storage with 30-minute TTL, and a NestJS service-per-concern architecture (LlmService, SessionService, DecompositionService, FollowUpService, EnrichmentService).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Target 5-10 actionable sub-tasks per brain dump (each sub-task is a single concrete action)
- No hard cap -- soft guidance in the prompt ("aim for 5-10"), LLM adjusts based on input complexity
- LLM infers priorities from context (urgency cues, dependencies, importance signals in the text)
- LLM judges whether input warrants decomposition -- simple/clear inputs become a single task, complex inputs get parent + sub-tasks
- Follow-ups triggered only when gaps detected (missing deadlines, unclear priorities, ambiguous scope, missing context) -- not on every decomposition
- Follow-up questions can target any gap: deadlines/timing, priority clarification, missing context, scope refinement
- Casual and brief tone -- "When's this due?" not "I noticed no deadline was mentioned"
- Batched delivery: 1-2 questions in a single message, user answers all at once
- Maximum one round of follow-ups per decomposition -- no follow-up on the follow-up
- If user's answer is vague (e.g., "soon"), nudge once for clarity then accept whatever comes
- After processing follow-up answers, show a brief summary of what changed ("Updated: deadline set to Friday, equipment task marked high priority")
- If user ignores follow-ups and sends a new dump: process the new dump normally, but include a gentle reminder about the unanswered questions
- 30-minute inactivity TTL in Redis (from requirements)
- Topic-scoped context: each new brain dump starts with clean context within the session; follow-ups only see their own dump's context
- Use Sonnet to classify each incoming message as "continuation of current topic" or "new topic" before processing
- Rich session state in Redis: conversation turns, pending follow-ups, active topic ID, last task IDs -- session is a mini state machine
- Only substantive input (brain dumps, follow-up answers) resets the TTL; quick commands (/tasks, /help) do not
- After session expires, soft recall from recent tasks if user references something from before ("that office move thing" -> search recent tasks to re-establish context)
- On first message after session expiry: "Starting fresh -- your previous session timed out"
- /new command available for users to explicitly clear session and start fresh
- Structured fields + description: update structured fields (deadline, priority) when extractable, append freeform details to task description
- Latest answer wins on conflicts -- most recent input overwrites previous values without confirmation
- Follow-up answers can add NEW sub-tasks if the answer reveals uncaptured work
- No changelog or audit trail -- tasks have current state only, keep it simple
- Model routing is locked: Opus 4.6 for decomposition, Sonnet for classification and follow-up
- Token usage must be logged per LLM call
- All services must be callable without Telegram -- pure service layer

### Claude's Discretion
- Exact prompt engineering for decomposition and follow-up generation
- Token budget management and prompt optimization
- Redis session data structure and serialization format
- Error handling for LLM API failures (retries, fallbacks)
- Sonnet classification prompt design for topic detection

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CAP-03 | System decomposes brain dumps into parent task + sub-tasks with priority suggestions (Opus 4.6) | Anthropic SDK `messages.create()` with structured JSON output (`output_config.format`) guarantees schema-compliant decomposition responses. Opus 4.6 model ID: `claude-opus-4-6`. |
| CAP-04 | System routes LLM calls to appropriate model (Opus for decomposition, Sonnet for structured ops) | SDK accepts model as string parameter per call. Create a model routing service that selects `claude-opus-4-6` or `claude-sonnet-4-6` based on operation type. Token usage available via `message.usage`. |
| INTL-01 | System asks contextual follow-up questions after brain dump capture | Sonnet 4.6 generates follow-up questions. Use structured output to get `{ questions: string[], target_task_ids: string[] }`. One round max per decomposition. |
| INTL-02 | Session context persists for 30 minutes of inactivity in Redis | ioredis with Upstash Redis. Store session as JSON string with `EX` (seconds) TTL = 1800. Use hash or string keys with `session:{userId}:{topicId}` pattern. |
| INTL-03 | Follow-up information merges into existing tasks (incremental enrichment, not duplication) | EnrichmentService receives follow-up answers, uses Sonnet to extract structured updates (deadline, priority, description additions, new sub-tasks), then calls existing TaskService.update() and TaskService.create(). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | latest (0.61+) | Claude API client for Opus 4.6 and Sonnet 4.6 | Official Anthropic TypeScript SDK. Direct API access, full typing, streaming, token usage tracking via `message.usage`. No abstraction layer overhead. |
| `ioredis` | ^5 | Redis client for session storage | TCP-based, persistent connections, ideal for long-running NestJS on Fly.io. Supports pipelining, Lua scripting, and all Redis data types. TLS enabled by default on Upstash (`rediss://` protocol). |
| `zod` | ^3.23 | Schema validation for LLM output | Type-safe runtime validation. Parse LLM JSON responses into typed objects. Used alongside structured output for defense-in-depth. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@liaoliaots/nestjs-redis` | ^10 | NestJS module wrapper for ioredis | Provides NestJS-idiomatic DI integration, health checks, multiple instance support. Wraps ioredis cleanly into NestJS module system. |
| `uuid` | ^9 | Generate topic/session IDs | Already used implicitly via Prisma UUIDs; needed for session-scoped topic identifiers. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@anthropic-ai/sdk` (direct) | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) | Adds abstraction layer. Useful if multi-provider needed, but Cortex is Claude-only. Direct SDK gives full control over structured output, caching, and token tracking. |
| `ioredis` | `@upstash/redis` | Upstash HTTP client is designed for serverless (Cloudflare Workers, Lambda). Fly.io runs a persistent NestJS process -- TCP connections via ioredis are more efficient and support pipelining. |
| `zod` | `class-validator` (already in project) | class-validator is decorator-based, better for DTOs. Zod is better for runtime parsing of external data (LLM responses). Use both: class-validator for API DTOs, Zod for LLM output schemas. |

**Installation:**
```bash
npm install @anthropic-ai/sdk ioredis @liaoliaots/nestjs-redis zod
npm install -D @types/ioredis
```

> Note: `@types/ioredis` may not be needed since ioredis v5 ships its own TypeScript definitions. Verify after install.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── llm/                        # LLM integration module
│   ├── llm.module.ts           # Module registration
│   ├── llm.service.ts          # Low-level Claude API wrapper (messages.create, token logging)
│   ├── llm.types.ts            # Shared types, schemas, model constants
│   ├── decomposition.service.ts # Brain dump -> structured tasks (Opus 4.6)
│   ├── classification.service.ts # Message intent classification (Sonnet 4.6)
│   ├── follow-up.service.ts    # Follow-up question generation (Sonnet 4.6)
│   ├── enrichment.service.ts   # Follow-up answer -> task updates (Sonnet 4.6)
│   └── prompts/                # Prompt templates (separate from logic)
│       ├── decomposition.prompt.ts
│       ├── classification.prompt.ts
│       ├── follow-up.prompt.ts
│       └── enrichment.prompt.ts
├── session/                    # Session management module
│   ├── session.module.ts       # Module registration
│   ├── session.service.ts      # Session CRUD, TTL management, state machine
│   └── session.types.ts        # Session state interface, topic state
├── task/                       # Existing from Phase 1
├── workspace/                  # Existing from Phase 1
├── prisma/                     # Existing from Phase 1
└── app.module.ts               # Updated to import LlmModule, SessionModule
```

### Pattern 1: LLM Service with Model Routing and Token Logging
**What:** A single low-level service wraps all Claude API calls, selecting the model per operation type and logging token usage on every call.
**When to use:** Every LLM interaction in the system goes through this service.
**Example:**
```typescript
// Source: Anthropic SDK docs + official pricing docs
import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';

export type LlmOperation = 'decomposition' | 'classification' | 'follow-up' | 'enrichment';

const MODEL_MAP: Record<LlmOperation, string> = {
  decomposition: 'claude-opus-4-6',
  classification: 'claude-sonnet-4-6',
  'follow-up': 'claude-sonnet-4-6',
  enrichment: 'claude-sonnet-4-6',
};

@Injectable()
export class LlmService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(LlmService.name);

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async createMessage(
    operation: LlmOperation,
    systemPrompt: string,
    messages: Anthropic.MessageParam[],
    outputSchema?: Record<string, unknown>,
    maxTokens = 4096,
  ): Promise<{ content: string; usage: Anthropic.Usage }> {
    const model = MODEL_MAP[operation];

    const params: Anthropic.MessageCreateParams = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    };

    // Use structured output when schema provided
    if (outputSchema) {
      params.output_config = {
        format: {
          type: 'json_schema',
          schema: outputSchema,
        },
      };
    }

    const response = await this.client.messages.create(params);

    // Log token usage for every call
    this.logger.log(
      `LLM [${operation}] model=${model} ` +
      `input=${response.usage.input_tokens} output=${response.usage.output_tokens}`,
    );

    const textBlock = response.content.find((b) => b.type === 'text');
    return {
      content: textBlock?.text ?? '',
      usage: response.usage,
    };
  }
}
```

### Pattern 2: Session State Machine in Redis
**What:** Sessions stored as JSON in Redis with TTL, keyed by user ID. Each session tracks a state machine: idle -> decomposing -> awaiting_follow_up -> enriching -> idle.
**When to use:** Every incoming message checks/updates session state.
**Example:**
```typescript
// Source: ioredis docs + project CONTEXT.md decisions
import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

interface SessionState {
  id: string;
  userId: string;
  status: 'idle' | 'awaiting_follow_up';
  activeTopic: {
    id: string;
    parentTaskId: string | null;
    taskIds: string[];
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    pendingFollowUps: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

const SESSION_TTL = 1800; // 30 minutes in seconds

@Injectable()
export class SessionService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  private key(userId: string): string {
    return `session:${userId}`;
  }

  async get(userId: string): Promise<SessionState | null> {
    const data = await this.redis.get(this.key(userId));
    return data ? JSON.parse(data) : null;
  }

  async set(userId: string, state: SessionState): Promise<void> {
    await this.redis.set(
      this.key(userId),
      JSON.stringify(state),
      'EX',
      SESSION_TTL,
    );
  }

  async refreshTtl(userId: string): Promise<void> {
    await this.redis.expire(this.key(userId), SESSION_TTL);
  }

  async clear(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }
}
```

### Pattern 3: Structured Output with Zod Validation
**What:** Define JSON schemas for each LLM operation, use `output_config.format` for constrained decoding, then validate with Zod as defense-in-depth.
**When to use:** Every LLM call that returns structured data.
**Example:**
```typescript
// Source: Anthropic structured output docs (GA)
import { z } from 'zod';

// Zod schema for decomposition output
export const DecompositionResultSchema = z.object({
  needs_decomposition: z.boolean(),
  parent_task: z.object({
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(['high', 'medium', 'low']),
    deadline: z.string().nullable(),
  }).nullable(),
  sub_tasks: z.array(z.object({
    title: z.string(),
    description: z.string().nullable(),
    priority: z.enum(['high', 'medium', 'low']),
    position: z.number(),
  })),
  follow_up_needed: z.boolean(),
  detected_gaps: z.array(z.string()),
});

export type DecompositionResult = z.infer<typeof DecompositionResultSchema>;

// Convert Zod schema to JSON Schema for output_config
// (Zod's .jsonSchema() or use zod-to-json-schema)
```

### Pattern 4: Prompt Templates as Functions
**What:** Prompts defined as TypeScript functions that accept context parameters, returning the system prompt string. Separates prompt logic from service logic.
**When to use:** All prompt construction.
**Example:**
```typescript
// Source: Anthropic prompt engineering best practices
export function buildDecompositionPrompt(workspaceName: string): string {
  return `You are Cortex, a personal task management assistant.

Your job: take a brain dump and decompose it into actionable tasks.

## Rules
- If the input is a simple, clear single action, return it as one task (needs_decomposition: false)
- If the input contains multiple actionable items, create a parent task with sub-tasks
- Aim for 5-10 sub-tasks per brain dump, adjusting based on complexity
- Each sub-task must be a single concrete action
- Infer priorities from urgency cues, dependencies, and importance signals
- Extract deadlines if mentioned (return ISO 8601 format)
- The current workspace is: ${workspaceName}

## Output
Return a JSON object matching the provided schema exactly.`;
}
```

### Anti-Patterns to Avoid
- **Chaining LLM calls when one suffices:** Don't call Sonnet to classify then Opus to decompose sequentially when Opus alone can handle the full brain dump. Classification is for incoming messages in an active session, not for initial decomposition.
- **Storing full conversation history in Redis:** Only store the current topic's conversation turns. Session-scoped, not unbounded. Keep it small to stay within Upstash free tier.
- **Parsing LLM JSON with regex:** Use `output_config.format` for guaranteed schema compliance, then `JSON.parse()` + Zod validation. Never regex-parse LLM output.
- **Hardcoding prompts in service methods:** Prompts should be in separate files/functions. They will be iterated on frequently and mixing them with business logic makes both harder to maintain.
- **Creating a generic "AI provider" abstraction:** Cortex uses Claude exclusively. Adding a provider abstraction (for "future flexibility") adds complexity with zero current value.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON schema validation of LLM output | Custom JSON parser/validator | `output_config.format` (structured output) + Zod | Constrained decoding guarantees valid JSON at the token generation level. Zod provides TypeScript type inference. |
| Redis connection management in NestJS | Custom Redis provider with lifecycle hooks | `@liaoliaots/nestjs-redis` | Handles connection lifecycle, health checks, graceful shutdown, multiple instances. 100+ tests. |
| Retry logic for LLM API calls | Custom retry with backoff | Anthropic SDK built-in retries OR `async-retry` | SDK has configurable retry behavior. For custom needs, `async-retry` handles exponential backoff correctly. |
| Token cost calculation | Manual price-per-token math | Log `message.usage` object directly | `input_tokens` and `output_tokens` are returned on every response. Calculate costs at reporting time, not call time, since pricing changes. |
| JSON Schema from Zod | Manual JSON schema authoring | `zod-to-json-schema` | Derive JSON Schema from Zod types automatically. Single source of truth for both runtime validation and API schema. |

**Key insight:** The Anthropic API now offers GA structured outputs with constrained decoding. This eliminates the entire category of "LLM returned malformed JSON" bugs that previously required complex retry logic and schema validation workarounds. Use it.

## Common Pitfalls

### Pitfall 1: Exceeding Upstash Free Tier (10,000 commands/day)
**What goes wrong:** Each session read/write/TTL refresh is a Redis command. With rich session state and frequent operations, you can hit the 10K daily limit.
**Why it happens:** Naive implementation does GET + SET + EXPIRE on every message, plus individual field reads. That's 3+ commands per interaction.
**How to avoid:** Use single `SET ... EX 1800` (combines set + TTL in one command). Read full session with one GET, modify in memory, write back with one SET. Batch operations. Estimated usage: ~100-300 commands/day for single user.
**Warning signs:** Monitor Upstash dashboard for daily command count approaching 5K.

### Pitfall 2: Token Budget Blowup on Opus Decomposition
**What goes wrong:** Including too much context in the Opus decomposition call (full session history, all existing tasks) leads to expensive input token counts.
**Why it happens:** Opus is $5/MTok input, $25/MTok output. A 2000-token system prompt + 1000-token brain dump + 2000-token output = ~$0.035 per decomposition. Adding 5000 tokens of context pushes it to ~$0.06.
**How to avoid:** Keep decomposition prompts focused: system prompt + current brain dump only. No session history needed for initial decomposition. Use prompt caching (`cache_control`) for the system prompt to reduce repeat costs by 90%.
**Warning signs:** Monthly LLM spend exceeding $15 for decomposition alone.

### Pitfall 3: Session TTL Not Refreshed Correctly
**What goes wrong:** Session expires mid-conversation because TTL refresh only happens on certain code paths.
**Why it happens:** The requirement says "only substantive input resets TTL; quick commands do not." Missing a code path means unexpected expiry.
**How to avoid:** Create a clear `isSubstantiveInput(message)` classifier. Apply TTL refresh in exactly one place (a session middleware or guard), not scattered across services.
**Warning signs:** Users report "Starting fresh" messages appearing unexpectedly.

### Pitfall 4: Race Condition in Session State Updates
**What goes wrong:** Two rapid messages from the same user (e.g., voice + text correction) can cause read-modify-write race conditions on Redis session state.
**Why it happens:** GET -> modify -> SET is not atomic in Redis.
**How to avoid:** For single-user app this is low risk, but if it occurs: use Redis WATCH/MULTI/EXEC for optimistic locking, or use Lua scripts for atomic read-modify-write. Alternatively, serialize message processing per user with a simple in-memory queue.
**Warning signs:** Session state reverting to a previous version after rapid messages.

### Pitfall 5: Follow-Up Questions Reference Stale Task State
**What goes wrong:** Follow-up questions are generated based on task state at decomposition time, but by the time the user answers, tasks may have been modified.
**Why it happens:** The follow-up generation stores task IDs but doesn't re-read task state before presenting questions.
**How to avoid:** When processing follow-up answers, always re-read current task state from the database. Don't cache task state in the session -- only store task IDs.
**Warning signs:** Follow-up answers fail to apply because referenced tasks were deleted or modified.

### Pitfall 6: Structured Output Schema Too Rigid
**What goes wrong:** LLM fails to comply with overly strict schemas (e.g., requiring exact enum values the LLM doesn't know about).
**Why it happens:** Structured output uses constrained decoding -- the model literally cannot produce tokens outside the schema. But if the schema is too narrow, the model gets "stuck" and produces suboptimal content.
**How to avoid:** Keep schemas focused on structure, not content. Use broad string types for descriptions, enums only for well-defined fields (priority, status). Test schemas with diverse brain dump inputs.
**Warning signs:** LLM responses that feel "forced" or have empty/placeholder values.

## Code Examples

Verified patterns from official sources:

### Structured JSON Output (GA, No Beta Header Needed)
```typescript
// Source: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const response = await client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  messages: [
    { role: 'user', content: userBrainDump }
  ],
  system: decompositionSystemPrompt,
  output_config: {
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          needs_decomposition: { type: 'boolean' },
          parent_task: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              deadline: { type: ['string', 'null'] },
            },
            required: ['title', 'priority'],
          },
          sub_tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                position: { type: 'integer' },
              },
              required: ['title', 'priority', 'position'],
            },
          },
        },
        required: ['needs_decomposition', 'sub_tasks'],
        additionalProperties: false,
      },
    },
  },
});

// Guaranteed valid JSON -- constrained decoding
const result = JSON.parse(response.content[0].text);

// Token usage tracking
console.log(response.usage);
// { input_tokens: 1250, output_tokens: 890 }
```

### Token Usage Logging per Call
```typescript
// Source: Anthropic SDK TypeScript README
// message.usage is available on every response

interface TokenLog {
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: Date;
}

// After each LLM call:
const log: TokenLog = {
  operation: 'decomposition',
  model: 'claude-opus-4-6',
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  timestamp: new Date(),
};
// Store in DB or structured logger
```

### Redis Session with TTL (ioredis)
```typescript
// Source: ioredis docs + Upstash connection docs
import Redis from 'ioredis';

// Upstash connection (TLS enabled by default)
const redis = new Redis(process.env.UPSTASH_REDIS_URL);
// URL format: rediss://:password@endpoint:port

// Set session with 30-minute TTL (single command)
await redis.set(
  'session:user123',
  JSON.stringify(sessionState),
  'EX',
  1800
);

// Get session
const data = await redis.get('session:user123');
const session = data ? JSON.parse(data) : null;

// Refresh TTL without rewriting data
await redis.expire('session:user123', 1800);
```

### NestJS Redis Module Registration
```typescript
// Source: @liaoliaots/nestjs-redis docs
import { RedisModule } from '@liaoliaots/nestjs-redis';

@Module({
  imports: [
    RedisModule.forRootAsync({
      useFactory: () => ({
        config: {
          url: process.env.UPSTASH_REDIS_URL,
          // TLS handled automatically by rediss:// protocol
        },
      }),
    }),
  ],
})
export class SessionModule {}
```

### Prompt Caching for System Prompts
```typescript
// Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
// Cache the system prompt to save 90% on repeated calls

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  system: [
    {
      type: 'text',
      text: classificationSystemPrompt, // ~500 tokens, cached
      cache_control: { type: 'ephemeral' }, // 5-minute TTL
    },
  ],
  messages: [{ role: 'user', content: incomingMessage }],
});

// Usage will show cache_read_input_tokens when cache hits
// response.usage.cache_read_input_tokens
// response.usage.cache_creation_input_tokens
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tool-use trick for structured output (`tool_choice: { type: 'tool', name: 'json' }`) | `output_config.format` with `json_schema` type (GA) | Nov 2025 (beta), Feb 2026 (GA) | No more beta headers. Constrained decoding guarantees schema compliance. Simpler API surface. |
| `output_format` parameter | `output_config.format` parameter | Feb 2026 (migration) | Parameter moved but old format still works during transition. Use new `output_config` going forward. |
| Claude Opus 4.1 ($15/$75 per MTok) | Claude Opus 4.6 ($5/$25 per MTok) | Feb 2026 | 67% cost reduction. Same quality tier. Model ID: `claude-opus-4-6`. |
| Claude Sonnet 4.5 ($3/$15 per MTok) | Claude Sonnet 4.6 ($3/$15 per MTok) | Feb 2026 | Same pricing, improved capabilities. Model ID: `claude-sonnet-4-6`. |
| Prompt caching 5-min only | 5-min and 1-hour cache durations | 2025 | 1-hour cache writes cost 2x base input (vs 1.25x for 5-min). Cache reads always 0.1x. Good for system prompts that don't change per user. |

**Deprecated/outdated:**
- `anthropic-beta: structured-outputs-2025-11-13` header: No longer needed. Structured outputs are GA.
- `output_format` parameter: Deprecated in favor of `output_config.format`. Still works during transition.
- `betaZodTool` helper for structured output: Was a workaround before native JSON output. Use `output_config.format` instead.

## Open Questions

1. **Prompt caching effectiveness for Cortex's usage pattern**
   - What we know: System prompts can be cached for 5 min (1.25x write, 0.1x read). Single user means ~minutes between calls.
   - What's unclear: Whether cache hits will be frequent enough to save money given the single-user access pattern. 5-minute ephemeral TTL may expire between uses.
   - Recommendation: Implement prompt caching from the start (low effort). Monitor cache hit rate via `usage.cache_read_input_tokens`. If hit rate is low, consider 1-hour cache (2x write cost but better hit rate).

2. **zod-to-json-schema reliability**
   - What we know: The `zod-to-json-schema` package converts Zod schemas to JSON Schema. Anthropic's structured output uses JSON Schema.
   - What's unclear: Whether all Zod features map cleanly to JSON Schema features supported by Anthropic's constrained decoding. Some edge cases (discriminated unions, refinements) may not translate.
   - Recommendation: Keep output schemas simple (objects, arrays, strings, enums, numbers). Test the generated JSON Schema against the API before relying on automated conversion. Consider authoring JSON Schema directly for critical schemas (decomposition output) and using Zod only for runtime validation.

3. **Soft recall after session expiry**
   - What we know: CONTEXT.md says "soft recall from recent tasks if user references something from before." This requires searching recent tasks by fuzzy text match.
   - What's unclear: How to implement fuzzy matching against task titles efficiently. Postgres ILIKE is simple but may not match "that office move thing" to "Office relocation planning."
   - Recommendation: For v1, use simple keyword search (ILIKE with extracted keywords). If that proves insufficient, consider adding pg_trgm extension for trigram similarity search. Don't over-engineer this for launch.

## Sources

### Primary (HIGH confidence)
- [Anthropic Structured Outputs Docs (GA)](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) - JSON output config, schema format, constrained decoding, TypeScript examples
- [Anthropic Pricing Page](https://platform.claude.com/docs/en/about-claude/pricing) - Opus 4.6: $5/$25 MTok, Sonnet 4.6: $3/$15 MTok, prompt caching multipliers, usage object structure
- [Anthropic TypeScript SDK GitHub](https://github.com/anthropics/anthropic-sdk-typescript) - `messages.create()`, streaming, `message.usage`, model parameter
- [Anthropic Prompt Caching Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) - `cache_control`, 5-min/1-hour TTL, cost savings
- [Upstash Redis Connection Docs](https://upstash.com/docs/redis/howto/connectclient) - ioredis connection string (`rediss://`), TLS-by-default, HTTP vs TCP recommendation
- [@liaoliaots/nestjs-redis GitHub](https://github.com/liaoliaots/nestjs-redis) - NestJS module for ioredis, async configuration, DI integration

### Secondary (MEDIUM confidence)
- [Anthropic Prompt Engineering Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) - Prompt structure, task decomposition patterns
- [Upstash Redis Pricing](https://upstash.com/docs/redis/overall/pricing) - Free tier: 10K commands/day, TLS, persistence

### Tertiary (LOW confidence)
- None. All findings verified through primary/secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified through official docs. @anthropic-ai/sdk, ioredis, and zod are battle-tested, well-maintained packages.
- Architecture: HIGH - Patterns follow NestJS conventions (module per concern, DI) and existing Phase 1 patterns in the codebase. Structured output is GA.
- Pitfalls: HIGH - Cost and TTL pitfalls derived from official pricing docs and Upstash free tier limits. Race condition pitfall is a standard distributed systems concern.

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable domain -- SDK and API are GA, pricing confirmed)
