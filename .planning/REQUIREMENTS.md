# Requirements: Cortex

**Defined:** 2026-02-27
**Core Value:** Zero-friction capture -- user speaks or types a brain dump into Telegram, system turns it into organized, trackable tasks with structure, timelines, and calendar commitments.

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

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after roadmap creation*
