---
phase: 07a-note-capture
plan: 02
subsystem: telegram
tags: [telegram, nestjs, llm, vault, note, slug, sonnet, whisper]

# Dependency graph
requires:
  - phase: 07a-01
    provides: VaultService.writeFile/revertLastCommit, NoteService.create/findById/softDelete/recent, Note+VaultWrite Prisma models

provides:
  - SlugService: Sonnet slug-generation operation with fallback to HHMM-note
  - slug.prompt.ts: cache-controlled system prompt for 4-6 word kebab-case slug generation
  - handleNoteCommand (3 forms: inline text, bare-then-voice, reply-to-transcription)
  - handleNoteVoice: voice transcription path for pending note sessions
  - persistNote: shared core (slug->vault->DB->Undo-button->60s-timer)
  - handleNoteUndoCallback: defensive undo (age/deletedAt/missing-sha guards)
  - handleVaultRecentCommand: /vault command showing last 10 vault writes
  - pendingNoteVoiceSessions Map with 5-min TTL
  - handleVoice short-circuit at top (10-min cap BEFORE Whisper — NOTE-08)
  - formatNoteSaved / formatNoteReverted / formatVaultRecent formatters
  - NOTE_CALLBACK_PREFIX constant
  - @Command('note'), @Command('vault'), @Action(/^note:undo/) on TelegramUpdate
  - TelegramModule imports VaultModule + NoteModule

affects:
  - 07b-meeting-capture (will extend vault-recent formatter and handleVaultRecentCommand for meetings)
  - future phase referencing note undo or voice note flows

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SlugService mirrors ClassificationService: inject LlmService, build prompt in separate prompts/*.prompt.ts, call createMessage with cache-controlled array format, parse with Zod, fallback on failure"
    - "persistNote pre-generates noteId (randomUUID) before vault write so [Undo] callback has a stable reference before commit SHA is known"
    - "handleVoice short-circuit: check pendingNoteVoiceSessions BEFORE transcription to enforce cost-guard cap without burning Whisper credits"
    - "Undo timer pattern: setTimeout + .unref() + editMessageReplyMarkup({inline_keyboard:[]}) — NOT empty object — to avoid Telegram 400 on expired keyboard"
    - "Side-channel isolation: handleNoteCommand never calls classifyAndRoute, session.refreshTtl, or modifies pendingFollowUps"
    - "@work/@personal prefix: parseWorkspacePrefix helper strips prefix and resolves workspace before persistNote"
    - "extractTranscriptFromTranscriptionMessage: regex against formatTranscription chrome output to recover verbatim transcript for Form 3 (reply-to-voice)"

key-files:
  created:
    - src/llm/slug.service.ts
    - src/llm/slug.service.spec.ts
    - src/llm/prompts/slug.prompt.ts
    - src/telegram/services/note-handlers.spec.ts
  modified:
    - src/llm/llm.types.ts
    - src/llm/llm.module.ts
    - src/telegram/services/orchestrator.service.ts
    - src/telegram/services/message-formatter.service.ts
    - src/telegram/telegram.constants.ts
    - src/telegram/telegram.update.ts
    - src/telegram/telegram.module.ts
    - src/scheduler/scheduler.service.ts

key-decisions:
  - "SlugService NEVER throws — fallback to HHMM-note on any LLM error — note capture must not fail because of a slug"
  - "Note row pre-created with randomUUID before vault write so callback data is stable — vaultCommitSha filled in after writeFile returns"
  - "10-min voice cap lives in handleVoice short-circuit, checked BEFORE ctx.telegram.getFileLink (RESEARCH.md Pitfall 6)"
  - "Undo window enforced at both client side (60s setTimeout clears keyboard) and server side (age check in handleNoteUndoCallback)"
  - "VaultModule + NoteModule imported by TelegramModule, not injected as forwardRef — no circular dep risk for note flow"
  - "pollingIntervalSeconds in pg-boss ConstructorOptions is not valid in v12 — replaced with monitorIntervalSeconds (auto-fix Rule 3)"

patterns-established:
  - "Pending-session Maps pattern: pendingNoteVoiceSessions mirrors pendingContactResolutions — chatId key, expiresAt expiry, delete-on-use"
  - "Note side-channel: a @Command handler that bypasses classifyAndRoute and session state entirely"

requirements-completed:
  - NOTE-01
  - NOTE-02
  - NOTE-03
  - NOTE-04
  - NOTE-05
  - NOTE-06
  - NOTE-07
  - NOTE-08
  - NOTE-09

# Metrics
duration: 10min
completed: 2026-04-29
---

# Phase 07a Plan 02: Note Capture — Telegram Command Layer Summary

**Sonnet slug-generation service wired to three-form /note command, 60s undo flow, and /vault recent — closing the Telegram→git→DB→Undo loop for Phase 7a**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-29T19:21:41Z
- **Completed:** 2026-04-29T19:31:06Z
- **Tasks:** 3 (+ 1 auto-fix deviation)
- **Files modified:** 10

## Accomplishments

- SlugService added: Sonnet 'slug-generation' operation, cache-controlled prompt, HHMM-note fallback, 9 unit tests
- OrchestratorService extended with handleNoteCommand (3 forms), handleNoteVoice, persistNote (slug→vault→DB→Undo-button+60s-timer), handleNoteUndoCallback (defensive), handleVaultRecentCommand, parseWorkspacePrefix, extractTranscriptFromTranscriptionMessage helpers
- handleVoice short-circuit at top (10-min cap BEFORE Whisper, NOTE-08)
- MessageFormatterService: formatNoteSaved (with [Undo] inline button), formatNoteReverted, formatVaultRecent
- TelegramUpdate wired: @Command('note'), @Command('vault'), @Action(/^note:undo/)
- TelegramModule: VaultModule + NoteModule imported

## Task Commits

Each task was committed atomically:

1. **Task 1: SlugService — Sonnet operation, prompt, service, tests** - `b704f91` (feat)
2. **Task 2: Extend OrchestratorService + MessageFormatter + constants** - `512f8ff` (feat)
3. **Task 3: Wire telegram.update.ts decorators + module imports** - `a0297fa` (feat)
4. **Deviation fix: scheduler pg-boss pollingIntervalSeconds** - `539bcc9` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/llm/slug.service.ts` — SlugService with generate(body) + dateTimeFallback static helper
- `src/llm/slug.service.spec.ts` — 9 unit tests covering pass-through, normalization, junk-fallback, error-fallback, LLM call shape
- `src/llm/prompts/slug.prompt.ts` — buildSlugPrompt() with cache_control ephemeral + 3 examples
- `src/llm/llm.types.ts` — Added 'slug-generation' to LlmOperation + MODEL_MAP + SlugResultSchema
- `src/llm/llm.module.ts` — Added SlugService to providers + exports
- `src/telegram/services/orchestrator.service.ts` — All note handlers + state maps + constants + helper methods
- `src/telegram/services/message-formatter.service.ts` — formatNoteSaved, formatNoteReverted, formatVaultRecent
- `src/telegram/services/note-handlers.spec.ts` — 9 unit tests for parseWorkspacePrefix + extractTranscriptFromTranscriptionMessage
- `src/telegram/telegram.constants.ts` — NOTE_CALLBACK_PREFIX = 'note:undo'
- `src/telegram/telegram.update.ts` — @Command('note'), @Command('vault'), @Action(/^note:undo/)
- `src/telegram/telegram.module.ts` — VaultModule + NoteModule imports
- `src/scheduler/scheduler.service.ts` — pollingIntervalSeconds → monitorIntervalSeconds (Rule 3 fix)

## Decisions Made

- SlugService NEVER throws — fallback to HHMM-note on any LLM failure, note capture must not fail over a slug
- Pre-generate noteId before vault write so the [Undo] callback has a stable ID regardless of commit timing
- 10-min cap enforced at handleVoice BEFORE getFileLink (cost guard, RESEARCH.md Pitfall 6)
- Undo window enforced at both client-side (60s setTimeout clears keyboard) and server-side (age + deletedAt guard in handleNoteUndoCallback)
- VaultModule and NoteModule imported directly into TelegramModule — no circular dependency risk for the note flow

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pg-boss pollingIntervalSeconds → monitorIntervalSeconds**
- **Found during:** Task 3 (fly deploy)
- **Issue:** `pollingIntervalSeconds` does not exist in pg-boss v12 `ConstructorOptions` (it belongs to `JobPollingOptions`). This caused `tsc` to fail in Docker, blocking the Fly build
- **Fix:** Renamed to `monitorIntervalSeconds` which is the correct field in `ConstructorOptions` for controlling the maintenance monitor interval
- **Files modified:** `src/scheduler/scheduler.service.ts`
- **Verification:** `npm run build` succeeds with zero TypeScript errors after fix
- **Committed in:** `539bcc9` (separate fix commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking)
**Impact on plan:** Pre-existing bug unrelated to note flow — necessary fix to allow deploy to proceed. No scope creep.

## Issues Encountered

- Neon free-tier compute quota exceeded during `fly deploy` after `prisma migrate deploy` ran. The Fly Docker build and TypeScript compilation completed successfully. The migration failure is an external infrastructure constraint (quota reset), not a code error. The previous deployment's Note + VaultWrite tables were applied in plan 07a-01; plan 07a-02 adds no new migrations, so the quota exhaustion is from repeated `migrate deploy` calls during the deploy sequence.
- The pre-existing `decomposition.service.spec.ts` test failures (5 tests, workspace enum mismatch) were present before this plan and are out of scope — logged to deferred-items.

## User Setup Required

None — no new environment variables or external service configuration required. VaultModule, NoteModule, and LlmModule already have their required env vars from plan 07a-01.

## Next Phase Readiness

- All Phase 7a NOTE-01 through NOTE-09 success criteria are implemented and wired end-to-end
- `/vault recent` is built ahead of Phase 7b — `formatVaultRecent` accepts `kind: string` to support future meeting writes
- Phase 7b (meeting capture) can reuse: `persistNote` pattern for `persistMeeting`, `pendingNoteVoiceSessions` map pattern, `formatVaultRecent` (already generic)
- Blocker: Neon compute quota needs to reset before the next `fly deploy` will succeed

---
*Phase: 07a-note-capture*
*Completed: 2026-04-29*
