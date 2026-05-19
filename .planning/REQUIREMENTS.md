# Requirements: Cortex

**Defined:** 2026-02-27
**Last expanded:** 2026-04-26 (Phase 7 — Knowledge Capture)
**Core Value:** Zero-friction capture -- user speaks or types a brain dump into Telegram, system turns it into either organized, trackable tasks (with structure, timelines, and calendar commitments) or knowledge (notes, meeting transcripts) delivered into the user's `nirvana-wiki` for downstream curation and querying.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Capture

- [x] **CAP-01**: User can send text message to Telegram bot and have it processed as task input
- [x] **CAP-02**: User can send voice message; system transcribes via Whisper, shows transcription, and auto-processes
- [x] **CAP-03**: System decomposes brain dumps into parent task + sub-tasks with priority suggestions (Opus 4.6)
- [x] **CAP-04**: System routes LLM calls to appropriate model (Opus for decomposition, Sonnet for structured ops)

### Task Management

- [x] **TASK-01**: User can create, read, update, and delete tasks
- [x] **TASK-02**: Tasks follow status lifecycle: captured -> active -> in_progress -> done (+ blocked, deferred)
- [x] **TASK-03**: Tasks can have sub-tasks one level deep; parent status auto-derives from children
- [x] **TASK-04**: User can manage tasks via inline keyboard buttons (Done, Start, Defer, Edit)
- [x] **TASK-05**: User can run /tasks, /workspace, /help, /settings commands
- [x] **TASK-06**: User can add comments to tasks by replying to bot messages or referencing task ID

### Intelligence

- [x] **INTL-01**: System asks contextual follow-up questions after brain dump capture
- [x] **INTL-02**: Session context persists for 30 minutes of inactivity in Redis
- [x] **INTL-03**: Follow-up information merges into existing tasks (incremental enrichment, not duplication)
- [x] **INTL-04**: System extracts action items from task comments and suggests new sub-tasks

### Workspaces

- [x] **WKSP-01**: Tasks are isolated by workspace (Personal / Work) with hard boundaries
- [x] **WKSP-02**: User can override workspace with @work / @personal prefix
- [x] **WKSP-03**: User can set and switch static default workspace

### Proactive Management

- [x] **PROD-01**: System sends deadline reminders via Telegram with configurable lead time
- [x] **PROD-02**: System prompts check-in for tasks in_progress for more than N days without updates
- [x] **PROD-03**: System resurfaces deferred tasks on their resume date

### Calendar

- [x] **CAL-01**: System creates Google Calendar events from tasks with title, description, and attendees
- [x] **CAL-02**: System maintains contacts directory (name -> email) and prompts for unknown stakeholders
- [x] **CAL-03**: System suggests time blocks based on task deadline and estimated effort

### Dashboard

- [ ] **DASH-01**: User can access web dashboard PWA to view and manage tasks
- [x] **DASH-02**: Dashboard provides kanban view, list view, and filters by workspace/status/deadline

### Knowledge Capture — Notes (Phase 7a)

- [x] **NOTE-01**: User can invoke `/note <text>` on Telegram to capture a text note routed to nirvana-wiki (not as a task)
- [x] **NOTE-02**: User can invoke `/note` followed by a voice message to capture a voice note (transcribed via existing Whisper pipeline)
- [x] **NOTE-03**: User can reply to a transcribed voice message with `/note` to re-route it from "task" to "note"
- [x] **NOTE-04**: System writes notes verbatim (no LLM rewriting) to `nirvana-wiki/raw/inbox/YYYY-MM-DD-{slug}.md` with a Source / Captured / Workspace header
- [x] **NOTE-05**: System generates a 4-6 word kebab-case slug for the filename via Sonnet (no body changes)
- [x] **NOTE-06**: Bot replies with the file path and commit sha, plus an `[Undo]` inline button valid for 60 seconds
- [x] **NOTE-07**: `[Undo]` reverts the git commit, pushes, and soft-deletes the Note record
- [x] **NOTE-08**: Voice notes longer than 10 minutes are rejected with a clear error (Whisper cost guard)
- [x] **NOTE-09**: `/note` is a side-channel — does not interrupt or alter an active task follow-up session

### Knowledge Capture — Meetings (Phase 7b)

> **Rescope (2026-05-19):** Originally planned around a local cortex-local daemon watching Meetily. That path was dropped — meeting capture is now Fathom-only. Requirements below reflect the current Fathom architecture; original Meetily-specific requirements (MEET-01, -02, -06, -07, -09) are dropped.

- [x] **MEET-02**: When Fathom signals a completed recording, cortex receives an HMAC-SHA256-signed webhook at `POST /api/meetings/fathom-webhook` with title, started_at, ended_at, attendees, transcript, and optional summary + action_items
- [x] **MEET-03**: Cortex verifies the webhook signature against `FATHOM_WEBHOOK_SECRET` (the `whsec_` value from Fathom's dashboard, base64-decoded before HMAC); for backfill, `POST /api/meetings/ingest` is shared-secret-Bearer-authenticated
- [x] **MEET-04**: Cortex persists a Meeting row and writes the transcript verbatim to `nirvana-wiki/raw/meetings/YYYY-MM-DD-{title-slug}.md` with a Source / Date / Started / Ended / Attendees header, plus Summary / Action Items / Transcript sections from Fathom's AI output
- [x] **MEET-05**: Bot DMs owner: `Meeting captured: "<title>" (<duration>, <N> attendees) → <vault path>`
- [x] **MEET-08**: All Meeting rows are created in the Work workspace by default (no attendee-domain heuristic in v1)

### Knowledge Capture — Vault (Phase 7 shared)

- [ ] **VAULT-01**: Cortex maintains a working clone of nirvana-wiki on a Fly.io persistent volume
- [ ] **VAULT-02**: Every write follows pull-rebase → write → commit → push under a single-writer mutex
- [ ] **VAULT-03**: Cortex writes only to `raw/inbox/` and `raw/meetings/` — never to `wiki/` or other paths
- [ ] **VAULT-04**: Cortex commits as `cortex-bot <bot@cortex.local>` for log auditability
- [ ] **VAULT-05**: Every write is recorded in a `VaultWrite` audit log (kind, source_id, vault_path, commit_sha, succeeded, error)
- [x] **VAULT-06**: User can run `/vault recent` on Telegram to list the last 10 vault writes with status

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Workspaces

- **WKSP-04**: System auto-switches default workspace based on time-of-day rules (e.g., Work on weekdays 9am-6pm)

### Dashboard

- **DASH-03**: Dashboard works offline with IndexedDB + service worker sync

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-user / team features | Solo use only -- kills single-user simplicity, different product category |
| File attachments on tasks | Telegram file storage is temporary; link to Drive instead |
| Recurring tasks | Use Google Calendar recurring events; recurring task engines are deceptively complex |
| Integrations beyond Google Calendar | Each integration is a maintenance surface; ROI near zero for single user |
| Mobile native app | PWA covers visual management; Telegram covers quick capture |
| Email notifications | Telegram is the notification channel; period |
| Natural language search | Simple ILIKE keyword search covers 90% of needs for <1000 tasks |
| Habit tracking | Different domain, different data model; use a dedicated app |
| AI auto-scheduling | Suggest time blocks but let user decide; auto-scheduling is a whole product |
| Cortex writing to `nirvana-wiki/wiki/` (curated) | Owned by the existing Claude-ingest workflow; two writers would drift |
| Real-time / live meeting transcription | Post-meeting only; live coaching is a different product |
| Audio file persistence (DB or vault) | Transcripts only; audio is a privacy + storage liability |
| Multi-source meeting ingestion | Fathom-only; adding Otter/Zoom-AI/etc. would require a new webhook controller per source |
| Cortex-side meeting summaries / action item extraction | The wiki-ingest workflow already does source-summary extraction when promoting `raw/` → `wiki/` |
| New query/search surface (Telegram `/search`, web search UI) | Obsidian + Claude Code in the vault + curated `wiki/` views already cover queryability |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CAP-01 | Phase 3 | Complete |
| CAP-02 | Phase 3 | Complete |
| CAP-03 | Phase 2 | Complete |
| CAP-04 | Phase 2 | Complete |
| TASK-01 | Phase 1 | Complete |
| TASK-02 | Phase 1 | Complete |
| TASK-03 | Phase 1 | Complete |
| TASK-04 | Phase 3 | Complete |
| TASK-05 | Phase 3 | Complete |
| TASK-06 | Phase 3 | Complete |
| INTL-01 | Phase 2 | Complete |
| INTL-02 | Phase 2 | Complete |
| INTL-03 | Phase 2 | Complete |
| INTL-04 | Phase 3 | Complete |
| WKSP-01 | Phase 1 | Complete |
| WKSP-02 | Phase 1 | Complete |
| WKSP-03 | Phase 1 | Complete |
| PROD-01 | Phase 4 | Complete |
| PROD-02 | Phase 4 | Complete |
| PROD-03 | Phase 4 | Complete |
| CAL-01 | Phase 5 | Complete |
| CAL-02 | Phase 5 | Complete |
| CAL-03 | Phase 5 | Complete |
| DASH-01 | Phase 6 | Pending |
| DASH-02 | Phase 6 | Complete |
| NOTE-01..09 | Phase 7a | Pending |
| MEET-01..09 | Phase 7b | Pending |
| VAULT-01..06 | Phase 7 (shared across 7a + 7b) | Pending |

**Coverage:**
- v1 requirements: 25 total (mapped to phases 1-6)
- v1.1 requirements: 24 new (NOTE: 9, MEET: 9, VAULT: 6) mapped to Phase 7
- Total mapped: 49
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-04-26 after Phase 7 (Knowledge Capture) added*
