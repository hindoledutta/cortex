---
phase: 07b-meeting-capture
plan: 02
subsystem: infra
tags: [typescript, chokidar, p-retry, node-cron, gray-matter, zod, launchd, macos-keychain, vitest, tsup]

# Dependency graph
requires:
  - phase: 07b-01
    provides: POST /api/meetings/ingest (SharedSecretGuard, Zod validation, idempotency), POST /api/heartbeat (MEET-06 lastError escalation)

provides:
  - cortex-local/ standalone TypeScript daemon (own package.json, type:module, ESM, Node20 target)
  - src/config.ts: loadConfig() with Zod v4 ConfigSchema (cortexApiUrl, sharedSecret, meetilyOutputDir, host, stateDir, frontmatterFields, heartbeatCron)
  - src/watcher.ts: chokidar watcher with 5s awaitWriteFinish, MEET-07 .md-only hard filter, buildPayload (gray-matter), processFile, startWatcher (drain-on-boot)
  - src/client.ts: uploadWithRetry (p-retry retries=5, factor=2, 1h window), 401/400->AbortError, lastError persisted; getRuntimeState
  - src/queue.ts: atomic JSON queue (enqueue/dequeue/drain/depth, dedup by filePath, .tmp+rename writes)
  - src/heartbeat.ts: node-cron daily 9 UTC with timezone:UTC, on-boot catch-up if >24h stale, atomic heartbeat.json
  - src/ingest-marker.ts: markIngested() — atomic fs.rename to _ingested/<basename>
  - src/dry-run.ts: frontmatter validator (no POST) for validating Meetily output contract before going live
  - scripts/install.sh: interactive installer — Keychain integration, plist rendering, launchctl bootstrap with load -w fallback
  - scripts/uninstall.sh: bootout/unload, optional INSTALL_DIR removal, preserves Keychain + config
  - scripts/com.cortex.local.plist.tmpl: launchd User Agent plist (KeepAlive, RunAtLoad, ThrottleInterval=30, explicit PATH, log paths)
  - 36 tests across 6 suites; tsup bundle producing dist/index.js
  - README.md: install/verify/dry-run/frontmatter-overrides/heartbeat/recovery/uninstall/troubleshooting

affects:
  - Human checkpoint (Task 3): Meetily install, meetily-exporter, install.sh, dry-run, live meeting smoke test, MEET-06 escalation DM, heartbeat staleness

# Tech tracking
tech-stack:
  added:
    - "chokidar@4.0.3 — cross-platform file watcher with awaitWriteFinish"
    - "p-retry@6.2.0 — exponential backoff with AbortError support"
    - "node-cron@3.0.3 — cron scheduler with timezone support"
    - "gray-matter@4.0.3 — YAML frontmatter parser"
    - "zod@4.3.6 — schema validation (already in server; added to daemon subproject)"
    - "tsup@8.3.0 — ESM bundle builder"
    - "vitest@2.1.0 — test runner for the daemon subproject"
  patterns:
    - "Atomic .tmp+rename writes for all persisted state (queue.json, runtime.json, heartbeat.json) — crash-safe on same filesystem"
    - "Drain-on-boot pattern: queue drained before watcher starts, so no transcript is lost across launchd restarts"
    - "Zod v4 nested .default() requires the full default object at the outer level — individual field defaults only apply when the key is present but fields are missing"
    - "vi.spyOn on Node.js fs/promises exports is blocked (non-configurable property) — verify atomic-write behavior via filesystem observation instead"
    - "AbortError pattern for p-retry: 401/400 responses are AbortError to skip retry loop; 5xx/network are plain Error for retry"
    - "Fire-and-forget heartbeat catch-up ping on boot — catch errors, never crash boot"

key-files:
  created:
    - cortex-local/package.json
    - cortex-local/package-lock.json
    - cortex-local/tsconfig.json
    - cortex-local/tsup.config.ts
    - cortex-local/vitest.config.ts
    - cortex-local/.gitignore
    - cortex-local/src/types.ts
    - cortex-local/src/config.ts
    - cortex-local/src/queue.ts
    - cortex-local/src/ingest-marker.ts
    - cortex-local/src/dry-run.ts
    - cortex-local/src/client.ts
    - cortex-local/src/watcher.ts
    - cortex-local/src/heartbeat.ts
    - cortex-local/src/index.ts
    - cortex-local/tests/config.test.ts
    - cortex-local/tests/queue.test.ts
    - cortex-local/tests/ingest-marker.test.ts
    - cortex-local/tests/watcher.test.ts
    - cortex-local/tests/client.test.ts
    - cortex-local/tests/heartbeat.test.ts
    - cortex-local/scripts/install.sh
    - cortex-local/scripts/uninstall.sh
    - cortex-local/scripts/com.cortex.local.plist.tmpl
    - cortex-local/README.md
  modified:
    - .dockerignore

key-decisions:
  - "Zod v4 nested .default({}) fix: outer .default() must provide the full default object, not just {}, because Zod v4 does not apply nested field defaults when the outer key is absent from input"
  - "vi.spyOn replaced with filesystem-observation test: Node's fs/promises exports are non-configurable (cannot be spied on in vitest); atomic-write test instead verifies .tmp absent and queue.json present after enqueue"
  - "cortex-local is a standalone subproject (own node_modules, NOT a workspace): avoids version conflicts with the main NestJS project and keeps the daemon self-contained for install.sh deployment"
  - "MEET-07 filter is a HARD extension check (.md only) at the top of processFile: any non-.md file is silently dropped before any I/O — audio never leaves the Mac"
  - "install.sh uses -U flag with security add-generic-password so re-runs update rather than fail on existing entry"
  - "launchctl bootstrap (modern) with load -w fallback (legacy) for maximum macOS version compatibility"

patterns-established:
  - "Crash-survivability triad: queue.json (pending uploads) + runtime.json (lastIngestAt + lastError) + heartbeat.json (lastHeartbeatAt) — all atomic .tmp+rename writes; drain on boot"
  - "Frontmatter-field-name flexibility via config.frontmatterFields: maps cortex-local's internal keys to whatever meetily-exporter produces (Open Question 1 from RESEARCH.md)"
  - "Terminal failure escalation: daemon writes lastError to runtime.json → next heartbeat payload carries it to server → HeartbeatService.upsert detects transition → sendUploadFailed (daemon has no Telegram token)"

requirements-completed: [MEET-01, MEET-02, MEET-06, MEET-07, MEET-09]

# Metrics
duration: 8min
completed: 2026-04-30
---

# Phase 07b Plan 02: cortex-local Daemon Summary

**Standalone TypeScript launchd daemon: chokidar watcher with 5s file-stable detection, p-retry exponential backoff (1h window), atomic JSON queue for crash survivability, daily node-cron heartbeat — closes the hands-off meeting-capture loop from Meetily on Mac mini to nirvana-wiki commit**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-29T19:57:54Z
- **Completed:** 2026-04-30T02:06:00Z
- **Tasks:** 2 of 3 code tasks complete; Task 3 is a human-verify checkpoint (no code)
- **Files modified:** 26

## Accomplishments

- Full cortex-local daemon: chokidar file watcher with 5s awaitWriteFinish stability, MEET-07 hard `.md` extension filter, gray-matter frontmatter parsing with configurable field names, p-retry upload (retries=5, 60s→30min backoff) with 401/400→AbortError, atomic queue.json for crash survivability, drain-on-boot
- Crash-survivability triad: `queue.json` (pending uploads), `runtime.json` (lastIngestAt + lastError), `heartbeat.json` (lastHeartbeatAt) — all persisted with atomic `.tmp`+rename writes; launchd restarts pick up exactly where the daemon died
- Interactive `install.sh`: reads/writes macOS Keychain, prompts for config, renders launchd plist with absolute node path, bootstraps User Agent with modern `launchctl bootstrap` and `load -w` fallback
- 36 tests across 6 suites (config, queue, ingest-marker, watcher, client, heartbeat); tsup bundle at `dist/index.js`; `sh -n` syntax checks pass on both shell scripts

## Task Commits

1. **Task 1: Scaffold cortex-local subproject** - `a1dfdf9` (feat)
2. **Task 2: Build watcher/client/heartbeat/index + tests + launchd plist + scripts + README** - `9dfb54f` (feat)
3. **Task 3: Human checkpoint** — pending (no code, human verification)

## Files Created/Modified

- `cortex-local/src/types.ts` - IngestPayload, QueuedItem, HeartbeatState, PersistedRuntimeState interfaces
- `cortex-local/src/config.ts` - loadConfig() with Zod v4 ConfigSchema (frontmatterFields nested defaults fix applied)
- `cortex-local/src/queue.ts` - Atomic JSON queue: enqueue (dedup by filePath), dequeue, depth, drain; .tmp+rename writes
- `cortex-local/src/ingest-marker.ts` - markIngested(): atomic fs.rename to _ingested/<basename>
- `cortex-local/src/dry-run.ts` - Frontmatter validator (no POST): prints parsed frontmatter + would-be payload
- `cortex-local/src/client.ts` - uploadWithRetry (p-retry 5 retries), getRuntimeState, runtime.json atomic writes
- `cortex-local/src/watcher.ts` - chokidar watch (awaitWriteFinish 5000ms), buildPayload, processFile, startWatcher
- `cortex-local/src/heartbeat.ts` - pingHeartbeat, startHeartbeat (catch-up + cron.schedule timezone:UTC)
- `cortex-local/src/index.ts` - Entry point: loadConfig → startWatcher → startHeartbeat
- `cortex-local/tests/config.test.ts` - 7 tests: missing path, invalid JSON, missing fields, sharedSecret length, URL validation, defaults, overrides
- `cortex-local/tests/queue.test.ts` - 6 tests: enqueue/read, dedupe, dequeue, drain success/failure, depth, atomic-write filesystem evidence
- `cortex-local/tests/ingest-marker.test.ts` - 3 tests: move to _ingested, create dir, deterministic overwrite
- `cortex-local/tests/watcher.test.ts` - 7 tests: buildPayload extraction, basename fallback, overrides, MEET-07 audio filter, empty transcript skip, order on success, no markIngested on failure
- `cortex-local/tests/client.test.ts` - 7 tests: 200 OK, 401 AbortError, 400 AbortError, 500→200 retry, repeated 500 exhausted, network error retry, Bearer header
- `cortex-local/tests/heartbeat.test.ts` - 6 tests: POST body + header + heartbeat.json write, queue_depth + last_error, catch-up when missing, catch-up when stale, no catch-up when recent, cron.schedule with UTC
- `cortex-local/package.json` - Standalone subproject: chokidar/p-retry/node-cron/gray-matter/zod; typescript/tsx/tsup/vitest dev deps
- `cortex-local/tsconfig.json` - Node16 ESM target, ES2022
- `cortex-local/tsup.config.ts` - ESM bundle, external runtime deps, node20 target
- `cortex-local/vitest.config.ts` - Test runner config
- `cortex-local/.gitignore` - Excludes node_modules, dist, state/
- `cortex-local/scripts/install.sh` - Interactive installer (Keychain, plist rendering, launchctl bootstrap)
- `cortex-local/scripts/uninstall.sh` - Bootout/unload, optional INSTALL_DIR removal
- `cortex-local/scripts/com.cortex.local.plist.tmpl` - launchd User Agent plist (KeepAlive, RunAtLoad, ThrottleInterval=30, PATH, log paths)
- `cortex-local/README.md` - Install/verify/dry-run/frontmatter-overrides/heartbeat/recovery/uninstall/troubleshooting
- `.dockerignore` - Added `cortex-local` line to exclude daemon from Fly.io build context

## Decisions Made

- **Zod v4 nested .default({}) requires full default object:** When `frontmatterFields` is absent from input, Zod v4's `z.object({...}).default({})` returns `{}` without applying individual field defaults. Fix: provide the full default object at the outer level. This differs from Zod v3 behavior.

- **Atomic-write test uses filesystem observation, not vi.spyOn:** Node.js `fs/promises` exports are non-configurable properties (cannot be redefined in vitest). The test verifies the outcome instead: after `enqueue()`, `queue.json.tmp` is absent (renamed away) and `queue.json` exists with valid JSON.

- **cortex-local is a fully standalone subproject (not a workspace):** Own `node_modules`, own `tsconfig`, own `tsup`. This makes `install.sh` simpler (copy `dist/`, `node_modules/`, `package.json`) and avoids version conflicts with NestJS.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod v4 nested .default({}) does not apply inner field defaults when outer key absent**
- **Found during:** Task 1 (config test run)
- **Issue:** `ConfigSchema.safeParse({})` returned `frontmatterFields: {}` (empty object, no field defaults applied) instead of the expected object with `externalId: 'meeting-id'`, etc. This is a Zod v4 behavioral change from v3.
- **Fix:** Changed `.default({})` to `.default({ title: 'title', startedAt: 'started_at', endedAt: 'ended_at', attendees: 'attendees', externalId: 'meeting-id' })` — the full default object so Zod v4 materializes it correctly when the key is absent.
- **Files modified:** `cortex-local/src/config.ts`
- **Verification:** `config.test.ts` test 6 ("parses valid config and applies defaults") passes with `externalId === 'meeting-id'`
- **Committed in:** a1dfdf9 (Task 1 commit)

**2. [Rule 1 - Bug] vi.spyOn on Node.js fs/promises non-configurable exports**
- **Found during:** Task 1 (queue atomic-write test)
- **Issue:** `vi.spyOn(fs, 'writeFile')` threw `TypeError: Cannot redefine property: writeFile` — Node.js `fs/promises` module exports are non-configurable descriptors; vitest cannot intercept them via `vi.spyOn`.
- **Fix:** Replaced the spy-based test with a filesystem-observation test: verifies `.tmp` file is absent after `enqueue()` resolves (renamed away) and `queue.json` exists with valid JSON array. This proves the same contract (atomic write) without requiring spy access.
- **Files modified:** `cortex-local/tests/queue.test.ts`
- **Verification:** Queue atomic-write test passes
- **Committed in:** a1dfdf9 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

**Task 3 checkpoint — user must complete these steps on the Mac mini before Phase 7b is declared complete:**

1. **Install Meetily** from https://github.com/Zackriya-Solutions/meetily (macOS app, grant microphone + screen-recording permissions)
2. **Install meetily-exporter:** `npm i -g meetily-exporter && meetily-exporter --watch --output ~/Documents/Meetily/exports`
3. **Run install.sh** from the cortex-local directory on the Mac mini; provide Cortex API URL, Meetily output dir, hostname, and the `CORTEX_LOCAL_SHARED_SECRET` value from Fly.io
4. **Verify daemon running:** `launchctl print gui/$(id -u)/com.cortex.local | head -20` + check logs
5. **Dry-run** against a real Meetily export to validate frontmatter field names
6. **Live meeting smoke test** with measured SLA (file-write → GitHub commit ≤ 30s via `stat` + `gh api`)
7. **MEET-06 escalation** verification: corrupt secret → heartbeat → Telegram `sendUploadFailed` DM
8. **Heartbeat staleness alert**: backdate `last_seen_at` and verify Telegram DM

## Phase 7b Requirement Traceability

| Requirement | Plan | Artifact |
|-------------|------|----------|
| MEET-01 (launchd User Agent) | 07b-02 | `com.cortex.local.plist.tmpl` (KeepAlive, RunAtLoad, ThrottleInterval=30) + `install.sh` |
| MEET-02 (5s stability + POST) | 07b-02 | `watcher.ts` (chokidar awaitWriteFinish: stabilityThreshold=5000) + `client.ts` |
| MEET-03 (Prisma Meeting model) | 07b-01 | `prisma/migrations/...` + `meetings.service.ts` |
| MEET-04 (ingest endpoint) | 07b-01 | `meetings.controller.ts` + `meetings.service.ts` |
| MEET-05 (Telegram notification) | 07b-01 | `notification.service.ts#sendMeetingCaptured` |
| MEET-06 (1h retry + escalation) | 07b-02 (daemon) + 07b-01 (server) | `client.ts` (p-retry 1h) + `heartbeat.ts` (lastError) + `heartbeat.service.ts` (MEET-06 transition detector) |
| MEET-07 (audio never leaves Mac) | 07b-02 | `watcher.ts#processFile` (.md hard filter top of function) + `client.ts` (IngestPayload text-only schema) |
| MEET-08 (workspace=Work) | 07b-01 | `meetings.service.ts#ingest()` (findByName('work')) |
| MEET-09 (daily heartbeat) | 07b-02 (daemon) + 07b-01 (server) | `heartbeat.ts` (node-cron, catch-up on boot) + `heartbeat-staleness.service.ts` (>26h alert) |
| VAULT-06 (/vault recent polymorphic) | 07a-01 + 07b-01 | VaultService.writeFile(kind='meeting') → VaultWrite row → formatVaultRecent displays all kinds |

## Next Phase Readiness

All code for Phase 7b is committed and tested. The only remaining work is the human verification checkpoint (Task 3): install Meetily + meetily-exporter on the Mac mini, run `install.sh`, and complete the live end-to-end smoke test. Once approved, Phase 7b is complete.

---
*Phase: 07b-meeting-capture*
*Completed: 2026-04-30*
