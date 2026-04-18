# Phase 1: Project Foundation - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

NestJS scaffold, Prisma schema, task domain service, and workspace isolation. A working domain layer where tasks can be created, updated, queried, and organized by workspace — testable without any external interface. No Telegram, no LLM, no calendar — pure domain logic.

</domain>

<decisions>
## Implementation Decisions

### Task shape & fields
- Priority: High / Medium / Low (3-level)
- Deadline: Optional (nullable) — most brain-dump tasks won't have one initially
- Description: Free-text field for additional context
- Titles: LLM-generated concise titles (Phase 2); original input stored as source context
- No effort estimate field in v1 — can be added in Phase 5 for calendar time-blocking

### Status lifecycle
- Statuses: captured, active, in_progress, done, blocked, deferred
- Flexible transitions — any status can move to any other status (no enforced linear flow)
- "Captured" = unprocessed inbox state. Brain dump lands here. Becomes "active" after LLM decomposition and user confirmation
- Deferred tasks have an optional resume date (nullable) — for Phase 4 resurfacing, but not required
- Soft delete only — no "cancelled" status. Deleted tasks are hidden but recoverable

### Parent-child behavior
- Sub-tasks are one level deep (no nesting beyond parent → child)
- Parent status is always computed from children, never manually overridden
- Derivation rule: progress-based — 0% done = active, 1-99% = in_progress, 100% = done. Blocked/deferred only if ALL children are blocked/deferred
- Sub-tasks are reorderable — position/order field, LLM sets initial order, user can rearrange
- Reparenting allowed — sub-tasks can be moved between parents or promoted to standalone tasks

### Workspace mechanics
- Two hardcoded workspaces: Personal and Work (no custom workspaces)
- Default workspace: Work
- Isolation via workspace column + query filter on all queries (no schema separation)
- @work / @personal prefix is a routing signal — stripped from task title after workspace assignment

### Claude's Discretion
- Database schema design and Prisma model structure
- NestJS module organization and service patterns
- Exact soft delete implementation (deleted_at timestamp vs flag)
- Validation rules and error handling patterns
- Test structure and coverage approach

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-project-foundation*
*Context gathered: 2026-02-27*
