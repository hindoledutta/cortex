# Codebase Concerns

**Analysis Date:** 2026-02-27

## Project Status Note

This project is in the design phase. The HLD (`/Users/hindole/work/cortex/docs/hld.md`) has been approved but implementation has not begun. The concerns below are architectural risks and design considerations that should be addressed during Phase 1 implementation.

---

## Design & Architectural Concerns

### LLM Cost Blowout Risk

**Issue:** Opus 4.6 brain dump decomposition could become expensive at scale or with power users.

**Files (future):**
- `src/modules/llm/decomposition.service.ts` (planned)
- `src/modules/llm/prompts/` (planned)

**Impact:**
- Budget exceeded: $25+/month instead of estimated $11-21/month
- Uncontrolled token usage without visibility into cost drivers
- No built-in safeguards or rate limiting by operation type

**Current mitigation:** Tiered LLM routing (Opus for decomposition only, Sonnet for structured ops). Insufficient without:

**Recommendations:**
1. Implement token usage logging and daily dashboard visible in Telegram (`/stats` command)
2. Add hard monthly limits via API client configuration (abort if exceeded)
3. Add cost-tracking alerts via Telegram at thresholds (50%, 75%, 90% of monthly budget)
4. Implement fallback to Sonnet for brain dumps >5000 tokens to detect and log escalations
5. Cache Opus responses for identical user inputs (session deduplication)

---

### Conversation Session Context Management Complexity

**Issue:** Ephemeral conversation sessions with 30-minute TTL create fragmentation and state management risk.

**Files (future):**
- `src/modules/conversations/session.service.ts` (planned)
- `src/modules/redis/cache.service.ts` (planned)

**Problem:**
- After 30 minutes of inactivity, session context is lost. User cannot reference prior conversation naturally.
- Cross-session task updates require extra LLM calls to re-establish context
- No durable audit trail of conversation flow (only in ephemeral Redis)
- Risk of infinite context windows during 30-minute sessions → token explosion on complex brain dumps

**Why it matters:**
- User experience degrades when they return to a task after a break: "I told you about this earlier" requires re-explaining
- Billing impact: every session restart requires re-context-setting with Opus

**Recommendations:**
1. Store conversation history durably in Postgres (ConversationSession table is sketched, but needs history field)
2. Implement conversation pruning: drop oldest messages if session context >8k tokens
3. Add session resumption: if user references a prior task by name within 24 hours, load compressed session context automatically
4. Build a `get_session_summary()` helper that summarizes prior context in 200-300 tokens for cost-efficient reloading
5. Test with users: does 30-minute TTL match actual usage patterns? May need to be 1-2 hours.

---

### Workspace Routing Logic Fragility

**Issue:** Multiple ways to specify workspace (`@work` prefix, `/workspace` command, static default, future time-based rules) create surface for bugs.

**Files (future):**
- `src/modules/workspace/routing.service.ts` (planned)
- `src/services/telegram/message-handler.ts` (planned)

**Problem:**
- Prefix parsing (@work, @personal) could miss edge cases: `@work @personal` or `@work123`
- Default workspace logic in capture path vs explicit prefix needs consistent precedence rules
- Time-based rules (Phase 2) will add 3rd control path; poor design now locks in problems later
- No validation that workspace exists before routing (FK constraint catches at DB but not gracefully)

**Current design flaw:**
- HLD says "If no prefix and no matching rule, use the current active workspace" but "current active workspace" is not clearly defined (stored in Redis? Postgres? User state?)

**Recommendations:**
1. Design and document a single workspace resolution algorithm:
   ```
   workspace = extract_prefix(message)
            or match_time_based_rule(now, user_workspace_rules)
            or get_active_workspace_from_session(session_id)
            or user_default_workspace
   ```
2. Add workspace validation: retrieve workspace object (not just ID) early in handler pipeline
3. Implement comprehensive tests for all permutations (prefix + default, prefix + time rule, no prefix, etc.)
4. Add error response if workspace resolution fails: "I couldn't find workspace X. Did you mean Work or Personal?"

---

### Whisper Transcription Accuracy Dependency

**Issue:** Voice capture accuracy floor is 95%; no fallback if transcription quality is poor.

**Files (future):**
- `src/modules/transcription/whisper.service.ts` (planned)
- `src/modules/telegram/voice-handler.ts` (planned)

**Problem:**
- If Whisper returns low-confidence transcription, user only sees "I heard: [potentially garbled text]". Confirmation happens after bad transcription.
- No confidence score from Whisper API returned to user
- Accents, background noise, domain-specific terms (names, company jargon) risk transcription failure silently
- Cascades into bad task decomposition: garbage in → garbage out from Opus

**Impact:** User receives poorly structured tasks without realizing the input was misheard.

**Recommendations:**
1. Whisper API returns `confidence` if available; use it to flag uncertain transcriptions
2. If confidence < 0.80, ask user to confirm before processing: "I'm not confident. Can you type it or say again?"
3. Build a feedback loop: when user corrects a task, capture original vs corrected transcription and log for quality monitoring
4. Consider implementing optional re-recording: user can tap "Record again" from confirmation screen
5. For Phase 2, add manual voice transcript override: user can edit the transcription before it's processed

---

### Single LLM Session Window for Brain Dump Decomposition

**Issue:** Entire brain dump decomposition happens in one Opus call with no intermediate checkpoints.

**Files (future):**
- `src/modules/llm/decomposition.service.ts` (planned)

**Problem:**
- If Opus hallucinates (e.g., invents a sub-task that doesn't make sense), entire decomposition is compromised
- No validation that decomposed tasks are semantically valid before saving to DB
- User cannot interactively refine structure during the LLM call
- Token costs spike on very complex brain dumps; no early-stopping mechanism

**Recommendations:**
1. Implement a two-stage decomposition:
   - Stage 1: Opus returns {task_structure, confidence_score, flags_for_review}
   - Stage 2: If confidence < 0.85 or flags present, ask user: "Does this structure make sense? Adjust before I save."
2. Add validation layer: check that all sub-tasks are semantically distinct and tied to parent task
3. Implement a "max decomposition depth" check: reject brain dumps with >10 actionables in first pass (ask user to prioritize top 5)
4. Add token budget enforcement: if decomposition prompt + history exceeds 6k tokens, summarize prior context

---

### Google Calendar Integration Permissions & Scope Creep Risk

**Issue:** Phase 2 Google Calendar requires OAuth setup; insufficient scoping/security design.

**Files (future):**
- `src/modules/calendar/google-auth.service.ts` (planned, Phase 2)
- `src/modules/calendar/google-calendar.service.ts` (planned, Phase 2)

**Problem:**
- HLD specifies OAuth with "offline refresh token" but no mention of how refresh token is stored securely
- Scopes: `calendar.events` (read/write) is very broad; could allow creation of events on any calendar, not just workspace calendars
- No audit trail of who created a calendar event (system vs user)
- Revoking access is not documented; if user deletes workspace, are calendar events orphaned?
- Cross-workspace calendar leakage is possible if workspace isolation is not enforced at API call layer

**Impact:** Security incident if refresh token is leaked; compliance issue if events are created without user awareness.

**Recommendations:**
1. Use `calendar.events` scope but enforce workspace isolation: wrap all Google Calendar calls with workspace_id check
2. Store refresh token in Postgres encrypted at rest (use NestJS encryption interceptor or Prisma middleware)
3. Audit all calendar operations: log who (user_id), what (create/update/delete), when, which event, to which calendar
4. Implement calendar revocation: when workspace is deleted, delete all associated CalendarEvent records and optionally delete corresponding Google events
5. Add rate limiting to calendar operations (5 events per minute per workspace)
6. Document workspace → Google Calendar ID mapping validation: ensure calendar_id belongs to the correct workspace

---

### Task Hierarchy: One Level Deep is Limiting

**Issue:** Design restricts sub-tasks to one level. Complex decompositions cannot be hierarchical.

**Files (future):**
- `src/models/task.entity.ts` (planned)
- `src/services/task/task.service.ts` (planned)

**Problem:**
- User captures: "Build marketing funnel" → decomposes to [Research, Design, Build, Deploy]
- User later refines "Design" → should split into [Define audience, Design funnel steps, Design email sequences]
- Current schema only allows one level: parent → children. No grandchildren.
- Leads to workaround: user creates top-level "Design" task, mimicking child. Duplication and confusion.
- Blocks Phase 3 kanban view if tasks don't hierarchy properly

**Why it matters:** Real decomposition is often tree-shaped, not just flat lists.

**Current impact:** Limited in Phase 1 (simple captures). High risk in Phase 2+ as power users refine tasks.

**Recommendations:**
1. Extend Task schema to allow unlimited nesting (parent_task_id FK stays, no depth limit)
2. Add depth validation: max 4 levels (prevent user from creating 20-level trees)
3. Update parent status derivation to work recursively: parent is done only if all descendants are done
4. Update UI (Phase 3) to display tree-style with collapse/expand
5. Create a migration path: if Phase 1 ships with one-level, Phase 1.5 can allow unlimited nesting via schema migration

---

### Reminder & Job Scheduling Robustness

**Issue:** BullMQ-based job queue (Upstash Redis) is under-specified for reliability.

**Files (future):**
- `src/modules/scheduler/reminder.service.ts` (planned)
- `src/modules/scheduler/bullmq.config.ts` (planned)

**Problem:**
- If a reminder job fails (e.g., Telegram API timeout), no retry strategy is documented
- No dead-letter queue for failed jobs; reminders silently vanish
- Upstash free tier has 10k commands/day limit; if hit, new jobs might be rejected
- No visibility into job queue health from user perspective
- Sessions context for reminders isn't clear: does a check-in reminder include task history?

**Impact:** User misses deadline reminders with no indication they failed.

**Recommendations:**
1. Configure BullMQ with retry strategy: exponential backoff up to 3 retries, 5s initial delay
2. Implement dead-letter handling: failed reminders are logged and surfaced to user via periodic summary
3. Add monitoring: `/stats` command shows "X reminders scheduled, Y pending" to user
4. Add job deduplication: if reminder job for task X already exists in queue, skip creating another
5. Test Upstash limit: monitor daily command count and alert if approaching 10k
6. Design reminder context: should include compressed task state (title, deadline, status) for user clarity

---

### Telegram Rate Limiting & Bot Robustness

**Issue:** Single Telegram bot token, no client-side rate limiting, potential for message loss.

**Files (future):**
- `src/modules/telegram/telegram.service.ts` (planned)
- `src/modules/telegram/webhook-handler.ts` (planned)

**Problem:**
- HLD notes "Telegram rate limits: negligible" but no client-side limit implementation planned
- If bot sends >30 messages/sec to user, Telegram silently drops/delays them
- No queue or batch mechanism for rapid-fire messages (e.g., creating 10 sub-tasks sends 10 confirmations)
- If webhook handler crashes mid-request, Telegram may retry, causing duplicate processing
- No idempotency key for webhook requests

**Impact:** Lost messages, duplicate task creation, user confusion.

**Recommendations:**
1. Implement client-side rate limiter: queue Telegram sends, dispatch at max 5 msgs/sec
2. Add idempotency: store `telegram_update_id` in DB, reject duplicate webhook deliveries
3. Batch confirmations: "Created 10 sub-tasks" instead of 10 separate messages
4. Add webhook signature verification (Telegram provides `X-Telegram-Bot-API-Secret-SHA256`)
5. Implement graceful degradation: if webhook handler fails, return 500 to Telegram and let it retry

---

### Database Storage & Scaling Limits

**Issue:** Neon free tier has 0.5 GB limit; growth path unclear.

**Files (future):**
- Database schema (Prisma schema) (planned)

**Problem:**
- HLD estimates "~50K tasks" fits in 0.5 GB, but this assumes:
  - Average task size: ~10 KB (unrealistic if comments are long)
  - No historical data retention beyond current tasks
  - No indices or overhead
- No archive strategy for old tasks
- When free tier hits limit, writes fail catastrophically (no soft failover)
- Neon auto-suspend/wake may cause latency spikes during resume

**Impact:** After ~1-2 years of heavy usage (>50 tasks/week), DB fills and breaks.

**Recommendations:**
1. Implement task archival: tasks with status=done and completed_at > 90 days are archived (moved to separate table or deleted with summary export)
2. Add database size monitoring: `/stats` shows "using X MB of Y GB"
3. Plan upgrade path: if 80% of free tier is used, auto-alert user to migrate to Neon paid ($15/month for 3 GB)
4. Implement data export: user can export all tasks as JSON for backup/portability
5. Monitor Neon suspend events: log when DB is resumed to detect and optimize query patterns

---

### Error Handling & User Feedback Gaps

**Issue:** HLD doesn't specify error handling for common failure modes.

**Files (future):**
- All service files will need consistent error handling
- `src/modules/telegram/error-handler.middleware.ts` (planned)

**Problem scenarios:**
1. Whisper transcription fails (network error, invalid audio format)
   - Current plan: "unknown, would break capture flow"
   - No graceful fallback
2. Opus decomposition times out (>5 second latency)
   - User sees hanging bot, no feedback
   - No timeout strategy
3. Google Calendar event creation fails (quota hit, workspace calendar deleted)
   - Calendar integration silently fails
   - Task created but not calendar-blocked (user unaware)
4. Redis connection lost
   - Session context vanishes mid-conversation
   - No fallback to Postgres-based session storage
5. Fly.io VM restarts mid-request
   - Webhook request crashes; duplicate task creation on retry

**Impact:** Poor UX, data inconsistency, silent failures.

**Recommendations:**
1. Design a comprehensive error taxonomy:
   - Retriable errors (network, timeout): retry with exponential backoff
   - Non-retriable errors (auth, invalid input): fail fast with user feedback
   - Partial failures (Whisper succeeds, Opus fails): save transcription, ask user to confirm processing
2. Implement timeout guardrails:
   - Voice capture: 8s timeout total (download + transcribe + return)
   - Decomposition: 5s timeout with fallback to Sonnet if Opus times out
   - Calendar operations: 3s timeout, graceful skip if Google API slow
3. Add comprehensive error messages to user:
   - "Couldn't transcribe. Try speaking more slowly or in a quiet place."
   - "Decomposition took too long. I'll save the raw text and you can refine it later."
4. Implement circuit breaker pattern for external APIs (Whisper, Claude, Google Calendar)
5. Add observability: log all errors to structured log (include request ID for debugging)

---

### Authentication: chat_id Only

**Issue:** Using Telegram `chat_id` as sole auth mechanism lacks depth.

**Files (future):**
- `src/modules/auth/telegram-auth.strategy.ts` (planned)

**Problem:**
- If Telegram user ID is compromised, attacker gains full access
- No audit log of who accessed what (user identity is implicit in chat_id)
- Shared devices: if user shares device with family member, they can impersonate them in bot
- No way to revoke/reset authentication without re-auth flow
- Session tokens are not mentioned; if Telegram client auth is lost, is user logged out?

**Impact:** Single point of failure; no per-session audit trail.

**Recommendations:**
1. Use Telegram chat_id as primary identity but add defense-in-depth:
   - Store chat_id in User table, add optional user_password field (for Phase 2+ if needed)
   - Add per-device sessions: generate session token after auth, include in API calls
2. Implement audit logging: log all user actions (task create, update, delete) with timestamp and session_id
3. Add /logout command: revoke current session token
4. Add /login_locations command: show recent logins, revoke suspicious sessions
5. For Phase 2, consider TOTP 2FA or Telegram authentication timestamp validation

---

## Phase 1 Implementation Risks

### Compressed Timeline & Scope Coupling

**Issue:** Phase 1 has many interconnected pieces that must work together.

**Risk:**
- Telegram webhook handler depends on LLM module, which depends on prompt quality, which depends on task structure
- If any piece is weak, entire pipeline degrades
- Testing becomes complex (Telegram mock, LLM mock, DB, Redis)

**Recommendations:**
1. Implement in dependency order:
   - Task CRUD (core)
   - Workspace management (used by all)
   - Telegram handler (glue)
   - LLM integration (intelligence layer)
2. Use feature flags: launch with simple task capture first, add decomposition after basic stability
3. Build extensive test suites for happy paths and common errors before launching

---

### Missing Phase 1 Features That Impact Design

**Issue:** Several design assumptions are deferred to Phase 2+, but Phase 1 architecture must support them.

**Examples:**
1. Time-based workspace routing (Phase 2): current phase 1 workspace routing doesn't anticipate this
2. Google Calendar integration (Phase 2): Task schema has optional `deadline` field, but no mechanism to auto-generate calendar events yet
3. Dashboard (Phase 3): Task API design must support pagination, filters, exports from day one

**Recommendations:**
1. Design API endpoints assuming Phase 2 features exist: include pagination, filtering, sorting from Phase 1
2. Add schema fields for Phase 2 even if unused in Phase 1 (e.g., `google_event_id` on Task table)
3. Document which fields/endpoints are "Phase 1 only" vs "ready for Phase 2"

---

## Test Coverage Concerns

**Issue:** No testing strategy is outlined; high-complexity code paths lack clarity on coverage.

**Untested areas (future):**

1. **LLM Context Management** (`src/modules/llm/session-context.service.ts`)
   - Complex logic: conversation history pruning, task reference resolution
   - Risk: silent context loss, off-by-one errors in token counting
   - Recommendation: 100% unit test coverage; integration tests with mock Opus

2. **Task Status Derivation** (`src/services/task/task.service.ts`, parent status from children)
   - Logic: parent is done if all children done, parent in_progress if any child in_progress
   - Risk: race conditions if child status updates happen concurrently
   - Recommendation: atomic transaction tests; concurrent update tests

3. **Workspace Isolation** (all services)
   - Risk: workspace leakage, task visible across workspaces
   - Recommendation: add per-service tests verifying workspace_id is checked on all reads/writes

4. **Telegram Message Parsing** (`src/modules/telegram/message-parser.ts`)
   - Complex: prefix extraction, command parsing, reply-to tracking
   - Risk: parsing edge cases cause failures
   - Recommendation: fuzzing tests; >50 test cases covering punctuation, unicode, emojis

5. **Whisper Integration** (`src/modules/transcription/whisper.service.ts`)
   - Risk: API failures, invalid audio, rate limiting
   - Recommendation: mock Whisper API; test failure cases, confidence thresholds

**Recommendations:**
1. Enforce minimum coverage: 80% overall, 100% for critical paths (auth, workspace isolation, task CRUD)
2. Use integration tests for full flows: voice capture → decomposition → task creation
3. Load test with concurrent users: simulate 100 tasks being created in parallel

---

## Known Design Trade-Offs to Monitor

### 1. Opus Cost vs Accuracy

**Trade-off:** Using Opus for decomposition is expensive but accurate. Sonnet is cheaper but worse at understanding messy brain dumps.

**Monitor:** Track decomposition quality and cost. If cost exceeds $20/month, consider:
- Caching responses (user sends same brain dump twice)
- Implementing Sonnet fallback for simple captures (<500 tokens)
- Hybrid approach: Sonnet for classification, Opus only if ambiguous

### 2. Session Timeout: 30 Minutes

**Trade-off:** Short timeout (30 min) saves Redis memory but fragments conversations. Long timeout uses more memory.

**Monitor:** User feedback on whether context is lost too early. Consider:
- Increasing to 1-2 hours if users report loss
- Implementing session compression after 30 min (summarize history to reduce tokens)

### 3. One-Level Task Hierarchy

**Trade-off:** Simple schema, limited expressiveness. Chosen for Phase 1 simplicity.

**Risk:** Power users frustrated by inability to nest beyond one level. Adds tech debt.

**Recommendation:** Plan migration path to unlimited nesting before Phase 2 ship date.

---

## Dependency Vulnerabilities

**Risk Areas (future implementation):**

1. **NestJS 11 + ecosystem**
   - Monitor: security patches, LTS support
   - Action: pin minor versions, review dependency updates monthly

2. **OpenAI Whisper API**
   - Risk: service discontinuation, pricing changes, accuracy degradation
   - Contingency: test ElevenLabs or Google Cloud Speech-to-Text as alternatives

3. **Fly.io Free Tier**
   - Risk: free tier removal, forced migration
   - Contingency: Docker containerization is portable; Hetzner ($4/mo) or Railway ($5/mo) are pre-evaluated as alternatives

4. **Claude API Pricing**
   - Risk: Opus 4.6 price increases; model deprecation
   - Contingency: monitor quarterly; plan migration to future models

---

## Summary of Priority Concerns

| Concern | Severity | Phase | Recommendation |
|---------|----------|-------|-----------------|
| LLM cost monitoring | HIGH | Phase 1 | Implement token tracking, alerts, fallback |
| Session context durability | HIGH | Phase 1 | Store in Postgres, not just Redis |
| Whisper fallback | HIGH | Phase 1 | Confidence scoring, re-record option |
| Error handling strategy | HIGH | Phase 1 | Design comprehensive taxonomy, timeouts |
| Database archival plan | MEDIUM | Phase 1 | Implement cleanup for old tasks |
| Workspace routing algorithm | MEDIUM | Phase 1 | Document single source of truth, test permutations |
| Task hierarchy limits | MEDIUM | Phase 2 prep | Plan migration to unlimited nesting |
| Google Calendar security | MEDIUM | Phase 2 | Encrypt refresh tokens, audit operations |
| Telegram rate limiting | MEDIUM | Phase 1 | Implement queue, idempotency |
| Testing strategy | HIGH | Phase 1 | Define coverage targets, test matrix |

---

*Concerns audit: 2026-02-27*
