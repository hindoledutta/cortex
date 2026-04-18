---
phase: 02-intelligence-layer
plan: 03
subsystem: llm
tags: [anthropic, sonnet-4-6, classification, follow-up, enrichment, zod, nestjs]

# Dependency graph
requires:
  - phase: 02-intelligence-layer
    provides: LlmService with model routing, Zod schemas for all operations, DecompositionService
  - phase: 02-intelligence-layer
    provides: SessionService with Redis-backed session state and TopicContext types
  - phase: 01-project-foundation
    provides: TaskService with CRUD operations, TaskPriority/TaskStatus enums
provides:
  - ClassificationService for 4-intent message classification via Sonnet with prompt caching
  - FollowUpService for gap-targeted question generation (1-2 questions, no-call when no gaps)
  - EnrichmentService for follow-up answer processing with task updates and sub-task creation
  - LlmModule exporting all 5 services (Llm, Decomposition, Classification, FollowUp, Enrichment)
  - AppModule wired with SessionModule and LlmModule for full Phase 2 DI availability
affects: [03-telegram-interface]

# Tech tracking
tech-stack:
  added: []
  patterns: ["prompt caching via cache_control array format for classification", "no-LLM-call short circuit when no gaps detected", "graceful partial failure in enrichment task updates"]

key-files:
  created:
    - src/llm/prompts/classification.prompt.ts
    - src/llm/classification.service.ts
    - src/llm/classification.service.spec.ts
    - src/llm/prompts/follow-up.prompt.ts
    - src/llm/follow-up.service.ts
    - src/llm/follow-up.service.spec.ts
    - src/llm/prompts/enrichment.prompt.ts
    - src/llm/enrichment.service.ts
    - src/llm/enrichment.service.spec.ts
  modified:
    - src/llm/llm.module.ts
    - src/app.module.ts

key-decisions:
  - "Prompt caching (cache_control ephemeral) used only for classification system prompt since it is called most frequently"
  - "FollowUpService short-circuits with empty questions when no gaps detected, saving LLM cost"
  - "EnrichmentService continues processing remaining updates when a single task update fails (partial failure tolerance)"

patterns-established:
  - "Prompt caching: use buildXxxSystemMessage() returning array with cache_control for high-frequency operations"
  - "Cost optimization: short-circuit LLM calls when the answer is deterministic (empty gaps = empty questions)"
  - "Partial failure tolerance: catch per-item errors in batch operations, log warnings, continue processing"

requirements-completed: [INTL-01, INTL-02, INTL-03]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 2 Plan 03: Classification, Follow-Up, and Enrichment Services Summary

**Message classification into 4 intents via Sonnet with prompt caching, gap-targeted follow-up question generation, and follow-up answer enrichment with task mutation and sub-task creation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-27T20:32:32Z
- **Completed:** 2026-02-27T20:37:42Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- ClassificationService classifies messages into 4 intents (new_brain_dump, follow_up_answer, command, unclear) using Sonnet with prompt caching
- FollowUpService generates 1-2 targeted follow-up questions only when gaps detected; short-circuits with no LLM call when no gaps
- EnrichmentService extracts structured updates from follow-up answers and applies them via TaskService (deadline, priority, description append, new sub-tasks)
- Graceful partial failure: individual task update failures logged but don't abort the enrichment batch
- LlmModule exports all 5 services; AppModule imports LlmModule and SessionModule completing Phase 2 wiring
- 45 total unit tests passing across all Phase 2 services (LLM + Session)

## Task Commits

Each task was committed atomically:

1. **Task 1: ClassificationService and FollowUpService with prompts and tests** - `77d4ff4` (feat)
2. **Task 2: EnrichmentService with TaskService integration, update LlmModule and AppModule** - `45100b2` (feat)

## Files Created/Modified
- `src/llm/prompts/classification.prompt.ts` - System prompt builder with cache_control array format for Sonnet prompt caching
- `src/llm/classification.service.ts` - 4-intent message classification service using Sonnet via LlmService
- `src/llm/classification.service.spec.ts` - 6 tests: intent types, pending follow-up context, prompt caching, Zod validation
- `src/llm/prompts/follow-up.prompt.ts` - System prompt builder for gap-targeted follow-up question generation
- `src/llm/follow-up.service.ts` - Follow-up question generation with no-LLM short circuit and max-2 question limit
- `src/llm/follow-up.service.spec.ts` - 6 tests: empty gaps, question generation, max limit, message content, Zod validation
- `src/llm/prompts/enrichment.prompt.ts` - System prompt builder for follow-up answer structured extraction
- `src/llm/enrichment.service.ts` - Follow-up answer processing with task updates and sub-task creation via TaskService
- `src/llm/enrichment.service.spec.ts` - 9 tests: deadline/priority/description updates, sub-task creation, partial failure, Zod validation
- `src/llm/llm.module.ts` - Added TaskModule import, 3 new service providers/exports
- `src/app.module.ts` - Added SessionModule and LlmModule imports

## Decisions Made
1. **Prompt caching for classification only** - Classification is the highest-frequency operation (called on every user message), so cache_control ephemeral is applied to its system prompt. Follow-up and enrichment prompts use plain strings since they are called less frequently.
2. **No-LLM short circuit in FollowUpService** - When detectedGaps is empty, the service returns immediately with empty questions array without making an LLM call. This saves cost and latency per user decision that follow-ups should only occur when gaps are detected.
3. **Partial failure tolerance in EnrichmentService** - If a single task update fails (e.g., task not found), the error is logged as a warning and processing continues with remaining updates. This prevents a single bad task_id from the LLM from aborting the entire enrichment.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. ANTHROPIC_API_KEY and REDIS_URL environment variables will be needed at runtime but not for tests.

## Next Phase Readiness
- Complete intelligence layer is now available via DI: Decomposition, Classification, FollowUp, Enrichment, Session
- Phase 3 (Telegram Interface) can import LlmModule and SessionModule to orchestrate the full brain dump conversation flow
- Maximum one round of follow-ups per decomposition is enforced by design (FollowUpService generates questions once after decomposition; EnrichmentService processes the answer and produces a summary)

## Self-Check: PASSED

All 11 created/modified files verified on disk. Both task commits (77d4ff4, 45100b2) verified in git history.

---
*Phase: 02-intelligence-layer*
*Completed: 2026-02-28*
