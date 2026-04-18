---
phase: 02-intelligence-layer
plan: 01
subsystem: llm
tags: [anthropic, claude, opus-4-6, sonnet-4-6, zod, structured-output, decomposition, nestjs]

# Dependency graph
requires:
  - phase: 01-project-foundation
    provides: NestJS module system, TaskService, Prisma schema (TaskStatus, TaskPriority enums)
provides:
  - LlmService with model routing (Opus/Sonnet) and token logging
  - DecompositionService for brain dump to structured task hierarchy
  - Zod schemas for all LLM operations (Decomposition, FollowUp, Enrichment, Classification)
  - LlmModule exporting LlmService and DecompositionService
affects: [02-intelligence-layer, 03-telegram-interface]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk@0.78.0", "zod@4.3.6", "zod-to-json-schema@3.25.1"]
  patterns: ["model routing via MODEL_MAP constant", "structured JSON output via output_config.format", "Zod defense-in-depth validation after structured output", "prompt templates as pure functions in prompts/ directory"]

key-files:
  created:
    - src/llm/llm.types.ts
    - src/llm/llm.service.ts
    - src/llm/llm.service.spec.ts
    - src/llm/llm.module.ts
    - src/llm/decomposition.service.ts
    - src/llm/decomposition.service.spec.ts
    - src/llm/prompts/decomposition.prompt.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Used Anthropic SDK directly (no LangChain/Vercel AI SDK) for full control over structured output and token tracking"
  - "Zod v4 installed (latest) -- zodToJsonSchema requires type cast due to zod-to-json-schema types lagging behind Zod v4 internals"
  - "output_config set via unknown cast on params since SDK types may not yet expose GA structured output config"

patterns-established:
  - "Model routing: MODEL_MAP constant maps LlmOperation to model string"
  - "Token logging: every LLM call logs operation, model, input/output tokens via NestJS Logger"
  - "Prompt templates: pure functions in src/llm/prompts/ directory accepting context params"
  - "Structured output + Zod: output_config.format for constrained decoding, Zod.parse() for defense-in-depth"

requirements-completed: [CAP-03, CAP-04]

# Metrics
duration: 7min
completed: 2026-02-28
---

# Phase 2 Plan 01: LLM Foundation and Brain Dump Decomposition Summary

**LlmService with Opus/Sonnet model routing and DecompositionService producing structured parent + sub-task hierarchies from brain dumps via Zod-validated structured JSON output**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-27T20:21:19Z
- **Completed:** 2026-02-27T20:28:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- LlmService routes 4 operation types to 2 Claude models (Opus 4.6 for decomposition, Sonnet 4.6 for classification/follow-up/enrichment)
- Token usage logged on every LLM call with NestJS Logger
- DecompositionService decomposes brain dumps into parent task + prioritized sub-tasks with gap detection
- Zod schemas defined for all 4 LLM operations (Decomposition, FollowUp, Enrichment, Classification) ready for future plans
- 13 unit tests passing across both services

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create LLM types, service, and module** - `5566d8a` (feat)
2. **Task 2 RED: Failing tests for DecompositionService** - `388f35d` (test)
3. **Task 2 GREEN: Implement DecompositionService** - `6b117b8` (feat)

_Note: Task 2 is TDD with RED then GREEN commits._

## Files Created/Modified
- `src/llm/llm.types.ts` - LlmOperation type, MODEL_MAP, LlmResponse interface, 4 Zod schemas with inferred types
- `src/llm/llm.service.ts` - Injectable NestJS service wrapping Anthropic SDK with model routing and token logging
- `src/llm/llm.service.spec.ts` - 7 tests: model routing (4), token logging, output_config presence/absence
- `src/llm/llm.module.ts` - NestJS module exporting LlmService and DecompositionService
- `src/llm/decomposition.service.ts` - Brain dump decomposition via Opus 4.6 with structured output and Zod validation
- `src/llm/decomposition.service.spec.ts` - 6 tests: complex/simple decomposition, gap detection, Zod validation, prompt/message verification
- `src/llm/prompts/decomposition.prompt.ts` - System prompt builder following user locked decisions
- `package.json` - Added @anthropic-ai/sdk, zod, zod-to-json-schema
- `package-lock.json` - Lock file updated

## Decisions Made
- Used Anthropic SDK directly (no LangChain/Vercel AI abstraction) per research recommendation -- Cortex is Claude-only
- Zod v4 installed as latest; zodToJsonSchema requires type cast due to type definition lag in zod-to-json-schema
- output_config set via unknown cast on MessageCreateParamsNonStreaming since SDK types may not yet expose GA structured output config field
- Prompt caching support built into LlmService signature (accepts cache_control in system prompt array) but not exercised yet

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Vitest mock isolation with vi.restoreAllMocks**
- **Found during:** Task 1 (LlmService tests)
- **Issue:** Using `vi.restoreAllMocks()` in afterEach restored the module-level Anthropic SDK mock, causing subsequent tests to lose the mock implementation
- **Fix:** Changed to explicit `logSpy.mockRestore()` only, keeping module-level SDK mock intact across tests
- **Files modified:** src/llm/llm.service.spec.ts
- **Verification:** All 7 tests pass consistently
- **Committed in:** 5566d8a

**2. [Rule 1 - Bug] Fixed TypeScript strict mode errors in LlmService**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** Using `Record<string, unknown>` for params required double-cast through `unknown` in strict mode; MessageCreateParams union type prevented direct property access on response
- **Fix:** Used `MessageCreateParamsNonStreaming` type explicitly, cast through `unknown` for output_config and usage cache properties
- **Files modified:** src/llm/llm.service.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 5566d8a

**3. [Rule 1 - Bug] Fixed zod-to-json-schema type incompatibility with Zod v4**
- **Found during:** Task 2 GREEN phase
- **Issue:** `zodToJsonSchema(DecompositionResultSchema)` produced TS error because zod-to-json-schema types expect Zod v3 internal API shape
- **Fix:** Cast schema through `unknown` to `Parameters<typeof zodToJsonSchema>[0]` -- runtime behavior is correct
- **Files modified:** src/llm/decomposition.service.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors, all tests pass
- **Committed in:** 6b117b8

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All auto-fixes necessary for correct TypeScript compilation and test isolation. No scope creep.

## Issues Encountered
None beyond the auto-fixed items above.

## User Setup Required
None - no external service configuration required. ANTHROPIC_API_KEY environment variable will be needed at runtime but not for tests.

## Next Phase Readiness
- LlmService and DecompositionService ready for use by Plan 02 (Session/Classification) and Plan 03 (FollowUp/Enrichment)
- All 4 Zod schemas pre-defined in llm.types.ts for immediate use in future plans
- Prompt template pattern established in prompts/ directory for classification, follow-up, and enrichment prompts

## Self-Check: PASSED

All 7 created files verified on disk. All 3 commit hashes found in git log.

---
*Phase: 02-intelligence-layer*
*Completed: 2026-02-28*
