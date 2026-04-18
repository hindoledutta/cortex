# External Integrations

**Analysis Date:** 2026-02-27

## APIs & External Services

**LLM & AI:**
- Claude API (Anthropic) - Brain dump decomposition, conversational follow-up, structured task classification
  - SDK/Client: `@anthropic-ai/sdk`
  - Auth: `ANTHROPIC_API_KEY` env var
  - Models: `claude-opus-4-6` (decomposition, complex context mapping), `claude-sonnet-4-6` (single-task classification, status parsing, follow-up generation)
  - Usage: Session-scoped conversation history passed as message array with system prompt

- Whisper API (OpenAI) - Audio transcription
  - SDK/Client: `openai`
  - Auth: `OPENAI_API_KEY` env var
  - Endpoint: `POST /v1/audio/transcriptions`
  - Input: OGG audio files from Telegram voice messages
  - Output: Transcribed text string

**Messaging:**
- Telegram Bot API - Text/voice capture, inline keyboards, notifications
  - SDK/Client: `node-telegram-bot-api` or `telegram`
  - Auth: `TELEGRAM_BOT_TOKEN` env var
  - Mode: Webhook (not polling) — Fly.io serves HTTPS endpoint
  - Key methods: `sendMessage`, `editMessageReplyMarkup`, `answerCallbackQuery`, `getFile`
  - Bot commands: `/start`, `/tasks`, `/workspace`, `/help`, `/settings`
  - Auth mechanism: `TELEGRAM_CHAT_ID` — bot only responds to owner's chat ID; other messages silently ignored
  - Voice handling: Downloads OGG files via `getFile`, sends to Whisper for transcription

## Data Storage

**Databases:**
- PostgreSQL (Neon free tier)
  - Connection: `DATABASE_URL` env var
  - Client/ORM: Prisma
  - Tables: `Task`, `Comment`, `Contact`, `Workspace`, `CalendarEvent`, `ConversationSession`
  - Features: Connection pooling, auto-suspend/wake, automated backups
  - Free tier capacity: 0.5 GB (~50K+ tasks)

**Cache & Session Storage:**
- Redis (Upstash free tier)
  - Connection: `REDIS_URL` env var
  - Purpose: Session context cache, BullMQ job queue, rate limiting
  - Free tier: 10K commands/day
  - Session TTL: 30 minutes of inactivity (configurable)
  - Job queue: Scheduled reminders (deadline, check-in, deferred task resurfacing)

**File Storage:**
- Local filesystem only — Voice files downloaded from Telegram are processed in-memory or temporarily cached

## Authentication & Identity

**Auth Provider:**
- Custom chat_id authentication (Telegram)
  - Implementation: Sole auth mechanism is validating incoming message's `chat_id` against `TELEGRAM_CHAT_ID`
  - All non-owner messages silently ignored

**OAuth Integration:**
- Google OAuth 2.0 (Phase 2)
  - Implementation: One-time browser-based setup for Google Calendar access
  - Flow: Obtain refresh token, store in database or secure env var
  - Scopes: `calendar.events` (read/write)

## Monitoring & Observability

**Error Tracking:**
- Not configured in Phase 1. Recommended: Sentry or Axiom for error tracking (Phase 2)

**Logs:**
- Structured logging via Winston or Pino to stdout (Fly.io captures)
- Log level: DEBUG in development, INFO in production
- Security: No PII in logs, no API keys logged

## CI/CD & Deployment

**Hosting:**
- Fly.io (free tier)
  - 3 shared VMs
  - Docker-based deployment
  - Always-on with webhook traffic support
  - Alternative: Hetzner ($4/mo) or Railway ($5/mo) in hours if Fly.io free tier changes

**CI Pipeline:**
- Not configured in Phase 1. Recommended: GitHub Actions for automated tests on PR (Phase 2)

## Environment Configuration

**Required env vars:**

Phase 1 (MVP):
- `TELEGRAM_BOT_TOKEN` - Telegram Bot API token
- `TELEGRAM_CHAT_ID` - User's chat ID for auth
- `ANTHROPIC_API_KEY` - Claude API key
- `OPENAI_API_KEY` - OpenAI Whisper API key
- `DATABASE_URL` - PostgreSQL connection string (Neon)
- `REDIS_URL` - Redis connection string (Upstash)
- `NODE_ENV` - `development` or `production`

Phase 2 (Calendar & Reminders):
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_REDIRECT_URI` - OAuth callback URL (e.g., `https://cortex.fly.dev/auth/google/callback`)

**Secrets location:**
- Development: `.env` file (git-ignored)
- Production: Fly.io secrets (via `fly secrets set`)
- Never commit credentials, API keys, or tokens to git

## Webhooks & Callbacks

**Incoming Webhooks:**
- Telegram Bot Webhook - `POST /webhook/telegram`
  - Receives: Text messages, voice messages, button callbacks
  - Triggered by: User messages to bot, button taps
  - Authentication: Telegram verifies message signature via webhook secret

**Outgoing Webhooks:**
- None in Phase 1
- Future (Phase 2): Telegram notifications for reminders, calendar invites

**OAuth Callbacks:**
- Google OAuth Callback - `GET /auth/google/callback` (Phase 2)
  - Receives: Authorization code from Google
  - Returns: Refresh token stored in database

## API Response Patterns

**Message Processing Flow:**
1. Telegram webhook receives message → validates `chat_id`
2. NestJS controller passes to Telegram service
3. Telegram service determines message type (text/voice, brain dump/single task/follow-up)
4. Appropriate handler called:
   - Voice: Download → Whisper transcription → classify
   - Text: Classify directly
5. Classification result → LLM service
   - Single task: Sonnet for quick classification
   - Brain dump: Opus for decomposition with session context
6. Task service creates/updates tasks in Postgres
7. Redis stores session context (conversation history, active task IDs)
8. BullMQ schedules reminder jobs if deadline/reminder_at set
9. Telegram service sends response message with inline keyboards
10. LLM service generates follow-up question (if decomposition)
11. Repeat: User answer → Redis session lookup → incremental enrichment → update tasks

---

*Integration audit: 2026-02-27*
