# Feature Research

**Domain:** Intelligent task capture & management (Telegram-based, LLM-powered, single user)
**Researched:** 2026-02-27
**Confidence:** MEDIUM — Feature landscape is well-understood from competitor analysis; Cortex-specific differentiation judgments are opinion-informed-by-evidence.

## Feature Landscape

### Table Stakes (Users Expect These)

Features the user (single operator) will expect from day one. Missing any of these and the system feels broken or incomplete relative to the promise of "zero-friction intelligent capture."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Text message capture** | Core input channel. Every task app accepts text. | LOW | Telegram webhook receives text, routes to LLM or direct task creation. |
| **Voice message capture + transcription** | Promised as a core value. Todoist Ramble, BrainDump app, and Taskmelt all offer voice-to-task. The user expects "speak and forget." | MEDIUM | Whisper API transcription. OGG download from Telegram, send to Whisper, return text. Latency budget: <8s total. |
| **LLM decomposition of brain dumps** | The entire value proposition. Without this, it is just another todo app with more friction (Telegram vs native app). | HIGH | Opus 4.6 parses unstructured input into parent + sub-tasks. Prompt engineering is the hard part. Must handle edge cases: single task, mixed actionable/non-actionable, ambiguous input. |
| **Task CRUD (create, read, update, delete)** | Fundamental. Every task system has this. | LOW | Standard Prisma/Postgres CRUD. Status transitions enforce workflow. |
| **Task status lifecycle** | Users expect to mark tasks done, start them, defer them. Todoist, TickTick, Things all have status management. | LOW | Enum states: captured, active, in_progress, done, blocked, deferred. State machine validation. |
| **Sub-tasks (one level)** | Brain dump decomposition produces hierarchies. Without sub-tasks, decomposition output has no home. Todoist and TickTick both support sub-tasks. | MEDIUM | Parent-child self-referential FK. Parent status auto-derives from children. Must handle edge cases: completing parent with incomplete children, re-opening completed parent. |
| **Inline keyboard task management** | Telegram-native UX. Without buttons, every action requires typing commands. Telegram bots without inline keyboards feel primitive. | MEDIUM | Callback queries for Done/Start/Defer/Edit. Must handle stale keyboards (task already updated by another path). Edit message markup on state change. |
| **Workspace separation (Personal / Work)** | The user explicitly manages both domains. Without hard boundaries, work tasks leak into personal context and vice versa. | MEDIUM | Workspace-scoped queries, routing logic, prefix overrides (@work / @personal). Static default in Phase 1. |
| **Basic Telegram commands** | `/tasks`, `/workspace`, `/help` are minimum viable bot interface. Users try commands first; empty responses feel broken. | LOW | NestJS command handlers. `/tasks` lists active tasks in current workspace with inline keyboards. |
| **Transcription display before processing** | User needs confidence the system heard them correctly. Todoist Ramble shows transcription in real-time. Without this, voice input feels like a black box. | LOW | Send transcribed text as message, then process. User can correct by replying. |

### Differentiators (Competitive Advantage)

Features that set Cortex apart from Todoist, TickTick, Taskmelt, and generic Telegram bots. These are what justify building a custom system instead of using an existing app.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Conversational follow-up after capture** | No competitor does contextual multi-turn enrichment after brain dump capture. Todoist Ramble captures but does not ask follow-up questions. Taskmelt organizes but does not converse. This is Cortex's core differentiator: the system asks "When is this due? Should I block calendar time? Which sub-task first?" | HIGH | Requires session context management (Redis, 30-min TTL), LLM prompt chaining, and state tracking of what questions have been asked vs answered. The LLM must generate contextually relevant questions, not templates. |
| **Incremental enrichment (merge, not duplicate)** | When the user says "Actually, for the marketing funnel, target end of March and involve Sarah," the system updates the existing task instead of creating a new one. No consumer task app handles this. It is the difference between a chat interface and a true assistant. | HIGH | LLM must determine intent: new task vs update to existing vs additional brain dump. Requires session awareness of active task IDs and fuzzy matching of task references. |
| **Context continuity across messages** | 30-minute session window where the LLM remembers what was discussed. Most Telegram bots are stateless. Most task apps treat each interaction as isolated. | MEDIUM | Redis session storage with conversation history as JSONB. Session includes workspace, active task IDs, pending questions. Must handle session expiry gracefully (new context, but can still reference tasks by name/ID). |
| **LLM-powered comment action-item extraction** | User replies to a task message with an update; LLM extracts new action items and suggests sub-tasks. No consumer task app does this. | MEDIUM | Sonnet 4.6 classifies reply intent and extracts actionable items. Suggest new sub-tasks via inline keyboard confirmation. |
| **Google Calendar integration with stakeholder resolution** | Not just "create event" but full flow: parse time intent, resolve stakeholder names to emails via contacts directory, create event with attendees. Reclaim.ai and Motion do auto-scheduling, but they are standalone products, not embedded in a capture flow. | HIGH | OAuth 2.0 setup, GCal API, contact directory with learning (ask once, remember forever). Phase 2 feature. |
| **Time blocking suggestions** | After capture, suggest specific calendar blocks based on deadline and estimated effort. Reclaim.ai does this but requires its own app. Cortex embeds it in the conversational flow: "This is due March 31. Want me to block 2 hours next Tuesday?" | HIGH | Requires calendar free/busy query, effort estimation (LLM-suggested or user-provided), and natural language time parsing. Phase 2 feature. Depends on Google Calendar integration. |
| **Proactive check-in prompts** | System notices a task has been in_progress for 3+ days with no updates and asks "How's [task] going?" No consumer Telegram bot does this. It closes the follow-through gap that plagues every task system. | MEDIUM | BullMQ scheduled jobs. Query tasks by status + updated_at. Send Telegram message with quick-action buttons. Must not be annoying (configurable frequency, snooze option). |
| **Deferred task resurfacing** | User defers a task with a resume date; system resurfaces it on that date: "You deferred [task] until today. Ready to pick it up?" | LOW | BullMQ delayed job scheduled at deferred_until timestamp. Simple message with inline keyboard to re-activate or re-defer. |
| **Deadline reminders with context** | Not just "Task X is due tomorrow" but reminders that include task context, sub-task progress, and quick-action buttons. | LOW | BullMQ scheduled jobs at reminder_at timestamps. Include sub-task completion status in the message. |
| **Tiered LLM routing (cost optimization)** | Opus for brain dump decomposition, Sonnet for structured ops. Keeps monthly cost under $20. No competitor in the personal Telegram bot space optimizes this way because they do not need to — they charge subscription fees. | MEDIUM | Router module that classifies message type and dispatches to appropriate model. Must be reliable: misrouting a brain dump to Sonnet degrades quality; misrouting a status change to Opus wastes money. |

### Anti-Features (Commonly Requested, Often Problematic)

Features to deliberately NOT build. Each one seems valuable on the surface but would either bloat scope, degrade the core experience, or create maintenance burden disproportionate to value.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Multi-user / team collaboration** | "What if my partner wants to use it too?" | Destroys the single-user simplicity that enables chat_id auth, no permissions, no sharing UX, no conflict resolution. Multi-user is a different product category entirely. | Stay single-user. If needed later, deploy a second bot instance. |
| **Recurring tasks** | "I do laundry every Sunday." | Recurring task engines are deceptively complex: exception handling, skip/complete-one-instance, timezone edge cases, "completed this week but not next." Adds significant data model and scheduler complexity for a niche use case. | Use Google Calendar recurring events (Phase 2). Calendar is the right tool for recurring time-based things. |
| **File attachments on tasks** | "I want to attach a photo of the whiteboard." | Telegram file storage is temporary (files expire). Would need external storage (S3/R2), upload handling, display logic. Adds cost and complexity for rare use. | User can reference Telegram message by replying. For persistent files, use Google Drive links in task description. |
| **Natural language search across all tasks** | "Find that task I created last month about the marketing thing." | Requires full-text search indexing, LLM-powered semantic search, or both. Significant infrastructure for a single user with <1000 active tasks. | Simple keyword search via Postgres `ILIKE`. `/tasks` with filters (workspace, status, date range) covers 90% of retrieval needs. |
| **Integration ecosystem (Slack, Jira, Notion, etc.)** | "Can it sync with my work tools?" | Each integration is a maintenance surface: auth flows, webhook handling, data mapping, API changes. For a single user, the ROI is near zero. | Google Calendar is the one integration worth building. Everything else adds complexity without proportional value. |
| **Mobile native app** | "The Telegram UI is limiting." | Native app development (even cross-platform) is a separate full project. Doubles the front-end surface area. | PWA dashboard (Phase 3) covers visual task management. Telegram covers quick capture. Two interfaces, zero native app code. |
| **AI auto-scheduling / auto-prioritization** | "Just tell me what to work on next." | Reclaim.ai and Motion have entire companies built around this. Auto-scheduling requires deep calendar integration, effort estimation, priority ML, and constant rescheduling. Massive scope for uncertain value. | Suggest time blocks (Phase 2) but let the user decide. LLM suggests priorities during decomposition but does not auto-sort the backlog. Human agency over schedule is a feature, not a limitation. |
| **Elaborate priority/label/tag system** | "I need P1-P4, labels, contexts, areas, goals." | Research shows users spend more time organizing than doing. Complex taxonomies become abandoned metadata. GTD-style contexts rarely survive first contact with real usage. | P1-P4 priority (LLM-suggested, user-adjustable). Two workspaces (Personal/Work). That is enough. Resist the urge to add labels. |
| **Habit tracking** | "TickTick has habit tracking built in." | Different domain with different data model (streaks, frequency, completion rate). Adds visual complexity and feature surface without serving the core capture-and-manage flow. | Suggest a dedicated habit app. Cortex is for tasks with completion, not ongoing habits. |
| **Real-time sync / collaborative editing** | "I want changes to appear instantly on the dashboard." | WebSocket infrastructure, conflict resolution, optimistic updates — all for a single user. Polling every 30s achieves the same result for one person. | Dashboard polls API on focus/interval. Telegram is the real-time channel already. |
| **Email notifications** | "Send me a daily digest." | The user already has Telegram as the notification channel. Adding email means managing email templates, delivery infrastructure, and a second notification preference system. | Telegram is the notification channel. Period. |

## Feature Dependencies

```
[Text capture] ──foundation──> [LLM decomposition]
    └──requires──> [Telegram webhook setup]

[Voice capture]
    └──requires──> [Telegram webhook setup]
    └──requires──> [Whisper transcription]
        └──feeds──> [LLM decomposition]

[LLM decomposition]
    └──requires──> [Task CRUD]
    └──requires──> [Sub-tasks]
    └──enables──> [Conversational follow-up]

[Conversational follow-up]
    └──requires──> [Session context (Redis)]
    └──requires──> [LLM decomposition]
    └──enables──> [Incremental enrichment]

[Incremental enrichment]
    └──requires──> [Session context (Redis)]
    └──requires──> [Conversational follow-up]

[Inline keyboard management]
    └──requires──> [Task CRUD]
    └──requires──> [Task status lifecycle]

[Workspace separation]
    └──requires──> [Task CRUD]
    └──enhances──> [LLM decomposition] (workspace-aware prompts)

[Deadline reminders]
    └──requires──> [Task CRUD]
    └──requires──> [BullMQ scheduler]

[Check-in prompts]
    └──requires──> [Task status lifecycle]
    └──requires──> [BullMQ scheduler]

[Deferred task resurfacing]
    └──requires──> [Task status lifecycle (deferred state)]
    └──requires──> [BullMQ scheduler]

[Google Calendar integration]
    └──requires──> [OAuth 2.0 setup]
    └──requires──> [Contact directory]
    └──enhances──> [Conversational follow-up] (calendar questions)

[Time blocking suggestions]
    └──requires──> [Google Calendar integration]
    └──requires──> [Conversational follow-up]

[Comment action-item extraction]
    └──requires──> [Task CRUD]
    └──requires──> [Sub-tasks]
    └──enhances──> [Conversational follow-up]

[Web dashboard PWA]
    └──requires──> [Task CRUD API endpoints]
    └──independent of──> [Telegram bot] (shares database, separate frontend)
```

### Dependency Notes

- **LLM decomposition requires Task CRUD + Sub-tasks:** Decomposition output needs a place to land. Task and sub-task creation must work before decomposition can be meaningful.
- **Conversational follow-up requires Session context:** Without Redis session storage, each message is stateless and follow-up questions lose context.
- **Incremental enrichment requires Conversational follow-up:** Enrichment is a specialization of follow-up — the system must already be in a conversational session to merge updates into existing tasks.
- **All reminders require BullMQ scheduler:** Deadline reminders, check-in prompts, and deferred resurfacing all depend on the scheduled job infrastructure.
- **Google Calendar and Time blocking are Phase 2 because they require OAuth setup:** One-time browser-based OAuth flow is a separate setup concern that should not block Phase 1 capture.
- **Web dashboard is independent of Telegram:** Shares the same Postgres database and API, but can be built in parallel with Phase 2 features.

## MVP Definition

### Launch With (v1 — Phase 1)

Minimum viable product: validate that LLM-powered brain dump capture via Telegram is genuinely better than opening Todoist.

- [ ] **Text capture via Telegram** — core input channel, must work flawlessly
- [ ] **Voice capture + Whisper transcription** — second core input channel, show transcription and auto-proceed
- [ ] **LLM brain dump decomposition** — the core differentiator. Opus 4.6 turns messy input into structured tasks
- [ ] **Task CRUD + status lifecycle** — create, list, update status, delete tasks
- [ ] **Sub-tasks (one level)** — decomposition output needs hierarchy
- [ ] **Inline keyboard management** — tap to Done/Start/Defer/Edit without typing
- [ ] **Workspace separation** — Personal/Work with static default and @prefix override
- [ ] **Conversational follow-up** — system asks contextual questions after capture
- [ ] **Session context (30-min Redis)** — multi-turn conversation memory
- [ ] **Incremental enrichment** — follow-up info merges into existing tasks
- [ ] **Basic commands** — /tasks, /workspace, /help

### Add After Validation (v1.x — Phase 2)

Features to add once core capture loop is validated and the user relies on the system daily.

- [ ] **Deadline reminders** — trigger: user starts setting deadlines on tasks
- [ ] **Check-in prompts for stale tasks** — trigger: tasks sit in_progress for days without updates
- [ ] **Deferred task resurfacing** — trigger: user starts using the deferred status
- [ ] **Google Calendar integration** — trigger: user wants time blocking and calendar events from within Cortex
- [ ] **Stakeholder/contact directory** — trigger: Google Calendar integration needs attendee resolution
- [ ] **Time blocking suggestions** — trigger: Google Calendar integration is working
- [ ] **Time-based workspace auto-switching** — trigger: user tires of manually switching or using @prefix
- [ ] **Comment action-item extraction** — trigger: user starts replying to task messages with updates

### Future Consideration (v2+ — Phase 3)

Features to defer until the system is daily-driver stable.

- [ ] **Web dashboard PWA** — defer until API is stable and task volume warrants a visual overview
- [ ] **Kanban/list/filter views** — defer because Telegram inline keyboards handle simple task management adequately
- [ ] **Offline-first (IndexedDB + service worker)** — defer because it only matters after the dashboard exists

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Text capture | HIGH | LOW | P1 |
| Voice capture + transcription | HIGH | MEDIUM | P1 |
| LLM brain dump decomposition | HIGH | HIGH | P1 |
| Task CRUD + status lifecycle | HIGH | LOW | P1 |
| Sub-tasks (one level) | HIGH | MEDIUM | P1 |
| Inline keyboard management | HIGH | MEDIUM | P1 |
| Workspace separation | MEDIUM | MEDIUM | P1 |
| Conversational follow-up | HIGH | HIGH | P1 |
| Session context (Redis) | HIGH | MEDIUM | P1 |
| Incremental enrichment | MEDIUM | HIGH | P1 |
| Basic commands (/tasks, etc.) | MEDIUM | LOW | P1 |
| Deadline reminders | MEDIUM | LOW | P2 |
| Check-in prompts | MEDIUM | MEDIUM | P2 |
| Deferred resurfacing | LOW | LOW | P2 |
| Google Calendar integration | MEDIUM | HIGH | P2 |
| Contact directory | LOW | LOW | P2 |
| Time blocking suggestions | MEDIUM | HIGH | P2 |
| Time-based workspace rules | LOW | MEDIUM | P2 |
| Comment action-item extraction | MEDIUM | MEDIUM | P2 |
| Web dashboard PWA | MEDIUM | HIGH | P3 |
| Kanban/list/filter views | MEDIUM | MEDIUM | P3 |
| Offline-first PWA | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch — validates the core "zero-friction intelligent capture" thesis
- P2: Should have — transforms Cortex from capture tool into daily task management system
- P3: Nice to have — visual management layer for when Telegram is not enough

## Competitor Feature Analysis

| Feature | Todoist (+ Ramble) | TickTick | Taskmelt | Motion / Reclaim | Cortex Approach |
|---------|-------------------|----------|----------|-----------------|-----------------|
| Text task creation | Natural language parsing (best in class) | Standard input | Brain dump text field | Standard input | Telegram message, LLM parses intent |
| Voice capture | Ramble: real-time voice-to-tasks (Gemini 2.5 Flash) | No native voice | Voice input supported | No native voice | Whisper transcription + LLM decomposition |
| Brain dump decomposition | Ramble parses voice into multiple tasks | No decomposition | AI extracts tasks from dumps | No decomposition | Opus 4.6 decomposes into parent + sub-tasks |
| Conversational follow-up | None — capture only, no follow-up | None | None | None | Core differentiator: multi-turn contextual enrichment |
| Incremental enrichment | None — new input = new task | None | None | None | LLM merges follow-up info into existing tasks |
| Calendar integration | Google Calendar sync (basic) | Google Calendar sync | Calendar sync, time blocking | Full auto-scheduling engine | GCal event creation with stakeholder resolution (Phase 2) |
| Auto-scheduling | No | No | AI scheduling | Yes (core product) | No. Suggest time blocks, user decides. |
| Reminders | Due date reminders | Reminders + Pomodoro | Smart reminders | Calendar-based | Telegram push: deadline, check-in, deferred resurfacing |
| Sub-tasks | Yes (multi-level) | Yes (multi-level) | Yes | Yes | One level deep (deliberate simplicity) |
| Habit tracking | No | Yes (built-in) | Yes (streaks) | No | Anti-feature: not building this |
| Interface | Native apps + web | Native apps + web | Native apps | Native apps + web | Telegram bot (primary) + PWA dashboard (Phase 3) |
| Pricing | Free / $5-8/mo | Free / $36/yr | Free / Premium | $19-34/mo | Self-hosted, ~$15/mo LLM costs |
| Multi-user | Yes | Yes | No | Yes | Anti-feature: single user only |

### Key Competitive Insight

Todoist Ramble (launched January 2026) is the closest competitor to Cortex's capture flow. It uses Gemini 2.5 Flash to convert voice into structured tasks in real-time. However, Ramble is capture-only: it does not ask follow-up questions, does not offer incremental enrichment, and does not converse. The gap between "capture" and "capture + converse + enrich" is Cortex's primary differentiation surface.

No competitor in the personal task space offers multi-turn conversational follow-up after initial capture. This is the feature that justifies building a custom system.

## Sources

- [Todoist Ramble announcement (TechCrunch, Jan 2026)](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/)
- [Todoist Ramble official launch (PR Newswire)](https://www.prnewswire.com/news-releases/introducing-todoist-ramble-ai-that-turns-natural-speech-into-structured-tasks-302666143.html)
- [Todoist Assist documentation](https://www.todoist.com/todoist-assist)
- [Taskmelt — AI brain dump task manager](https://www.taskmelt.app/)
- [BrainDump: Voice Tasks & Focus (App Store)](https://apps.apple.com/us/app/braindump-voice-tasks-focus/id6759401305)
- [ClickUp brain dump apps overview](https://clickup.com/blog/brain-dump-apps/)
- [Reclaim.ai — AI calendar scheduling](https://reclaim.ai/)
- [Motion vs Reclaim comparison (Morgen)](https://www.morgen.so/blog-posts/motion-vs-reclaim)
- [TickTick vs Todoist comparison (Toolfinder)](https://toolfinder.co/comparisons/todoist-vs-ticktick)
- [Zapier best todo list apps 2026](https://zapier.com/blog/best-todo-list-apps/)
- [Telegram Bot API — inline keyboards](https://core.telegram.org/bots/api)
- [Telegram Bot Features documentation](https://core.telegram.org/bots/features)
- [n8n Telegram + Todoist AI workflow](https://n8n.io/workflows/3052-effortless-task-management-create-todoist-tasks-directly-from-telegram-with-ai/)

---
*Feature research for: Intelligent task capture & management (Telegram-based, LLM-powered)*
*Researched: 2026-02-27*
