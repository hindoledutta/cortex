# Cortex

## What This Is

Cortex is a personal intelligent task capture and management system. It turns unstructured voice and text brain dumps — sent via Telegram — into structured, actionable task hierarchies using LLM-powered decomposition. It then proactively helps manage timelines, calendar commitments, and follow-through. Built for a single user (solo operator) managing both personal and work responsibilities.

## Core Value

Zero-friction capture: the user speaks or types a messy brain dump into Telegram, and the system turns it into organized, trackable tasks with structure, timelines, and calendar commitments — without the user having to manually decompose or organize anything.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Telegram bot captures text and voice messages with 2-tap friction
- [ ] Voice messages transcribed via OpenAI Whisper, shown to user, then auto-processed
- [ ] LLM decomposes brain dumps into parent task + sub-tasks with priority suggestions
- [ ] Conversational follow-up asks contextual questions to enrich tasks (deadlines, calendar, stakeholders)
- [ ] Session context persists for 30 minutes of inactivity (stored in Redis)
- [ ] Incremental enrichment — follow-up info merges into existing tasks, not duplicated
- [ ] Task lifecycle: captured → active → in_progress → done (+ blocked, deferred)
- [ ] Sub-tasks one level deep, parent status auto-derives from children
- [ ] Comments on tasks via reply-to or task ID, with LLM action-item extraction
- [ ] Inline keyboard task management (Done, Start, Defer, Edit buttons)
- [ ] Telegram commands: /tasks, /workspace, /help, /settings
- [ ] Workspace separation (Personal / Work) with hard boundaries
- [ ] Static default workspace (time-based rules in Phase 2)
- [ ] @work / @personal prefix for one-off workspace override
- [ ] Deadline reminders via Telegram (configurable lead time)
- [ ] Check-in prompts for stale in_progress tasks
- [ ] Deferred task resurfacing on resume date
- [ ] Google Calendar event creation with task context
- [ ] Stakeholder resolution via contacts directory (name → email)
- [ ] Time blocking suggestions based on deadline and effort
- [ ] Time-based workspace auto-switching rules
- [ ] Web dashboard PWA (React on Cloudflare Pages)
- [ ] Kanban view, list view, filters
- [ ] Offline-first with IndexedDB + service worker

### Out of Scope

- Multi-user / team features — solo use only
- File attachments on tasks — unnecessary complexity
- Recurring tasks — not in current vision
- Integrations beyond Google Calendar — no Slack, Jira, etc.
- Mobile native app — PWA only
- Email notifications — Telegram is the notification channel
- Natural language search across historical tasks — possible future addition

## Context

- **User profile:** Busy professional, iPhone primary capture device, laptop + Mac mini for dashboard
- **Pain point:** Existing todo apps require too many taps, don't understand context, don't help decompose goals
- **Existing design:** Comprehensive HLD exists at `docs/hld.md` covering behaviors, data model, architecture, user flows, and integration points
- **Codebase state:** Design phase only — HLD document exists, no implementation code yet
- **Infra ready:** Anthropic API key and OpenAI API key available. Telegram bot token needs to be created via @BotFather.
- **LLM routing:** Claude Opus 4.6 for brain dump decomposition (free-flowing → structured). Claude Sonnet 4.6 for well-defined operations (classification, status parsing, follow-ups).
- **Voice flow:** Transcription shown to user and auto-processed immediately. User can correct if wrong via reply.

## Constraints

- **Budget**: ~$20/month total for LLM and infrastructure — tiered Opus/Sonnet routing to optimize cost
- **Hosting**: Free tiers only — Fly.io (compute), Neon (Postgres), Upstash (Redis), Cloudflare Pages (dashboard)
- **Tech stack**: NestJS 11 + TypeScript, Prisma ORM, PostgreSQL, Redis (BullMQ + sessions)
- **Single user**: chat_id auth only — no multi-tenancy, no user management
- **Telegram-first**: Primary interface is Telegram bot; dashboard is supplementary (Phase 3)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tiered LLM routing (Opus + Sonnet) | Opus for complex decomposition, Sonnet for structured ops — balances quality and cost | — Pending |
| Redis for session storage | Sessions are ephemeral (30-min TTL), Redis matches nature. Already using Upstash for BullMQ. | — Pending |
| Static workspace default (Phase 1) | Time-based rules add complexity. Static default sufficient for launch. | — Pending |
| Voice: show and auto-proceed | Lower friction than explicit approval. User can correct by replying. | — Pending |
| Sub-tasks one level deep | Prevents infinite nesting complexity. Sufficient for brain dump decomposition. | — Pending |
| Webhook mode for Telegram | Fly.io serves HTTPS. More efficient than polling for always-on deployment. | — Pending |

---
*Last updated: 2026-02-27 after initialization*
