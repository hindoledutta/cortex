# Cortex

Intelligent task capture and management system for a single power user.

Cortex turns unstructured voice and text brain dumps — sent via Telegram — into structured, trackable task hierarchies using LLM-powered decomposition. It then proactively manages timelines, calendar commitments, and follow-through, with a React PWA dashboard as the secondary view.

> **Status:** active development. Solo-built, not intended for multi-user deployment.

---

## What it does

**Zero-friction capture.** Talk or type to a Telegram bot. Voice is transcribed by Whisper; text is processed as-is. Within seconds you get back a parent task with sub-tasks, priorities, and contextual follow-up questions — no manual organizing.

**Conversational enrichment.** The bot asks one question at a time to fill in deadlines, stakeholders, and whether to block time on your calendar. Session context is held in Redis for 30 minutes so follow-ups merge into existing tasks instead of creating duplicates.

**Workspace separation.** Personal and Work are hard boundaries. A static default applies; `@work` or `@personal` overrides it for a single message.

**Proactive management.** Deadline reminders fire via Telegram at configurable lead times. Stale `in_progress` tasks get a check-in. Deferred tasks resurface on their resume date.

**Google Calendar integration.** Tasks with deadlines can spawn calendar events with resolved stakeholder attendees (via a contacts directory) and suggested time blocks based on effort.

**Dashboard (PWA).** Kanban + list views, filters by workspace/status/deadline, offline-first with IndexedDB + service worker. Supplementary — Telegram is the primary surface.

---

## Core flow

```
Telegram voice/text
  → Whisper (voice only)
  → Claude Sonnet classifies (simple task | brain dump | update | command)
  → Claude Opus decomposes brain dumps into parent + sub-tasks
  → Persist to Postgres (Prisma)
  → Generate follow-up question + inline keyboard (Done / Start / Defer / Edit)
  → Session kept in Redis for 30 min
  → BullMQ schedules reminders / check-ins / Calendar events
```

---

## Architecture

Event-driven modular monolith on NestJS. Modules aligned to business domains, not technical layers.

| Module | Responsibility |
|---|---|
| `telegram/` | Webhook intake, message sending, inline-keyboard callbacks, voice download |
| `llm/` | Claude (Opus + Sonnet) orchestration, Whisper transcription, prompts, response parsing |
| `task/` | Task lifecycle, sub-tasks, comments, status transitions |
| `calendar/` | Google OAuth, event creation, attendee resolution, time-blocking |
| `scheduler/` | BullMQ job processors for reminders, check-ins, resurfacing |
| `workspace/` | Personal/Work scoping |
| `session/` | Redis-backed 30-min conversation context |
| `settings/` | Per-user preferences (reminder lead times, defaults) |

**Tiered LLM routing** balances quality and cost: Claude Opus for free-flowing decomposition, Claude Sonnet for well-defined structured operations (classification, follow-up generation, comment extraction).

---

## Tech stack

- **Backend:** NestJS 11, TypeScript, Prisma ORM
- **Database:** PostgreSQL (Neon)
- **Queue + Sessions:** Redis via Upstash (BullMQ + session store)
- **LLM:** Anthropic Claude (Opus + Sonnet) via `@anthropic-ai/sdk`; OpenAI Whisper for voice
- **Bot:** Telegraf (webhook mode)
- **Frontend:** React + Vite + TanStack Router + TanStack Query + Tailwind + shadcn/ui
- **Hosting:** Fly.io (backend), Cloudflare Pages (dashboard)

---

## Project layout

```
src/                Backend NestJS source
  telegram/         Webhook + message orchestration
  llm/              Claude + Whisper services, prompts
  task/             Task domain + controller (REST)
  calendar/         Google Calendar integration
  scheduler/        BullMQ job processors
  workspace/        Workspace scoping
  session/          Redis session store
  settings/         User settings
prisma/             Schema, migrations, seed
dashboard/          React PWA (Vite)
scripts/            One-off utilities (e.g. google-oauth-setup)
docs/hld.md         High-level design
.planning/          Phase-based planning artifacts (GSD)
```

---

## Local development

Prereqs: Node 20+, pnpm or npm, Postgres, Redis, a Telegram bot token (from @BotFather), Anthropic API key, OpenAI API key, Google OAuth credentials.

```bash
# 1. Install
npm install
cd dashboard && npm install && cd ..

# 2. Configure
cp .env.example .env
# fill in DATABASE_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY,
# TELEGRAM_BOT_TOKEN, OWNER_CHAT_ID, GOOGLE_CLIENT_ID/SECRET, REDIS_URL

# 3. Database
npx prisma migrate dev
npx prisma db seed

# 4. Google Calendar OAuth (one-time, produces refresh token for .env)
npx ts-node scripts/google-oauth-setup.ts

# 5. Run
npm run start:dev                  # backend at :3000
cd dashboard && npm run dev        # dashboard at :5173
```

Telegram webhook is set on boot from `TELEGRAM_WEBHOOK_URL`. For local testing, use `ngrok` or run Telegraf in long-polling mode (set `TELEGRAM_MODE=polling`).

---

## Deployment

- **Backend** → Fly.io via [`fly.toml`](fly.toml) and [`Dockerfile`](Dockerfile). `fly deploy`.
- **Dashboard** → Cloudflare Pages / Vercel. See [`dashboard/wrangler.toml`](dashboard/wrangler.toml).
- **Database** → Neon Postgres (free tier).
- **Redis** → Upstash (free tier).

Target monthly cost: ~$20 (LLM inference dominates; infra is free-tier).

---

## Scope boundaries

**In scope**
- Solo use, Telegram-first, Google Calendar, PWA dashboard

**Explicitly out of scope**
- Multi-user / teams
- File attachments
- Recurring tasks
- Integrations beyond Google Calendar (no Slack, Jira, etc.)
- Native mobile apps
- Email notifications

---

## License

[MIT](LICENSE) © 2026 Hindole Dutta

See [`docs/hld.md`](docs/hld.md) for the full design document and [`.planning/`](.planning/) for phase-by-phase build artifacts.
