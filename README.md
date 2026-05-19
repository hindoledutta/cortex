# Cortex

Personal intelligence layer. Captures tasks, notes, and meetings via Telegram and commits them to a git-backed knowledge vault (nirvana-wiki). Proactively manages deadlines, calendar blocks, and follow-through.

> **Status:** Active development. Solo-built for a single power user.

---

## Interfaces

| Surface | URL / Access | Primary use |
|---|---|---|
| **Telegram bot** | Your bot via `@BotFather` | Everything — capture, action, query |
| **Dashboard (PWA)** | Deployed Cloudflare Pages URL | Browse, filter, kanban task management |
| **nirvana-wiki** | GitHub repo | Notes and meeting transcripts (git-backed) |
| **Fly.io logs** | `fly logs` | Debug and monitor |

---

## Telegram — Commands

| Command | What it does |
|---|---|
| `/start` | Greeting and quick-start prompt |
| `/help` | List all commands |
| `/tasks` | Show up to 10 open parent tasks with action buttons |
| `/workspace` | Show current default workspace (Work or Personal) |
| `/workspace work` | Switch default workspace to Work |
| `/workspace personal` | Switch default workspace to Personal |
| `/settings` | Show current config (workspace, session timeout, AI model) |
| `/note <text>` | Capture an inline text note → commits to `raw/inbox/` in nirvana-wiki |
| `/note` | Arm voice note capture — send a voice message within 5 min |
| `/vault` | Show the last 10 items committed to nirvana-wiki |

### Workspace prefix override

Prefix any message with `@work` or `@personal` to override your default workspace for that message only:

```
@work Prep slides for investor call Thursday
@personal Book dentist appointment
```

---

## Telegram — Message types

### Text brain dump

Send any text and Cortex classifies it:

- **Brain dump** → Claude decomposes into a parent task + sub-tasks. You get back the task tree, priorities, and one follow-up question if gaps were detected.
- **Follow-up answer** → Enriches the last task in session (fills deadline, stakeholders, etc.). Session lasts 30 min.
- **Comment** (reply to a bot task message) → Adds a comment to that task and extracts action items as sub-tasks.
- **Direct calendar booking** → "Schedule call with Sarah on Tuesday at 2pm" → extraction + [Confirm] / [Cancel].
- **Unclear** → Cortex asks for clarification.

### Voice message

Send a voice note (up to 10 min). Cortex transcribes via Whisper, shows "🎤 I heard: …", then routes identically to a text message.

If a bare `/note` session is active, the voice is saved as a note instead.

---

## Telegram — Inline buttons

### Task buttons

After a task is created you get action buttons. Each edits the message in place.

| Button | Result |
|---|---|
| ✅ Done | Status → `done` |
| ▶️ Start | Status → `in_progress` |
| ⏸️ Defer | Status → `deferred` |
| ✏️ Edit | Prompts "Reply with changes for this task" |
| 📅 Calendar | Extracts effort, resolves attendees, creates Google Calendar event |
| ⏰ Suggest Time | Queries your calendar, shows up to 5 free time blocks before the deadline |

### Calendar / time-block buttons

| Button | Result |
|---|---|
| Accept #N | Creates calendar event at suggested slot |
| Dismiss All | Closes the suggestion message |
| Confirm / Cancel | Confirm or cancel a direct booking |

### Note button

| Button | Window | Result |
|---|---|---|
| [Undo] | 60 sec | Reverts git commit, soft-deletes the note |

### Workspace prompt

When Cortex can't determine workspace from context it asks:

| Button | Result |
|---|---|
| 💼 Work | Creates tasks in Work workspace |
| 🏠 Personal | Creates tasks in Personal workspace |

---

## Notes — capture and vault

Every note lands in nirvana-wiki at `raw/inbox/YYYY-MM-DD-{slug}.md` with this format:

```markdown
Source: Telegram (text|voice)
Captured: 2026-05-08T11:30:00Z
Workspace: Work

---

{your note body}
```

The vault write is mutex-serialized: fetch → reset to origin/main → write → commit → push (one rebase retry on conflict). Every write (success or failure) is recorded in the `VaultWrite` audit table.

---

## Meetings — Fathom

Fathom pushes a webhook to Cortex when a recording is processed. Cortex writes to `raw/meetings/YYYY-MM-DD-{slug}.md`:

```markdown
Source: Fathom
Date: 2026-05-08
Started: 09:00
Ended: 09:47
Attendees: alice@example.com, bob@example.com

---

## Summary

{Fathom AI summary}

## Action Items

- Item one
- Item two

## Transcript

[00:00:05] Alice: ...
[00:00:10] Bob: ...
```

You get a Telegram notification: `📝 Meeting captured — "Title" (47 min, 2 attendees) → raw/meetings/...`

### Backfill existing recordings

```bash
# Dry-run (no writes)
FATHOM_API_KEY=... npm run fathom-backfill

# Ingest all
FATHOM_API_KEY=... CORTEX_PUBLIC_URL=https://cortex-hindole.fly.dev \
CORTEX_LOCAL_SHARED_SECRET=... npm run fathom-backfill -- --ingest

# Single recording by recording_id
... npm run fathom-backfill -- --ingest --id 144682304
```

---

## Meetings — Fathom (cloud)

Meeting transcripts come from Fathom and land in the vault automatically — no daemon, no Mac-side software.

### Webhook (live capture)

Fathom posts each completed recording to `POST /api/meetings/fathom-webhook`, signed with HMAC-SHA256. Cortex verifies the signature, writes the transcript to `nirvana-wiki/raw/meetings/YYYY-MM-DD-{slug}.md`, and DMs you a confirmation.

Webhook is registered once via:

```bash
npm run register-fathom-webhook
```

### Backfill (historical recordings)

```bash
npm run fathom-backfill              # dry-run: list what would be ingested
npm run fathom-backfill -- --ingest  # actually POST to /api/meetings/ingest
```

The backfill script uses the shared-secret-guarded `/api/meetings/ingest` endpoint. Requires `FATHOM_API_KEY`, `CORTEX_PUBLIC_URL`, and `CORTEX_LOCAL_SHARED_SECRET` in your env.

---

## Dashboard (PWA)

Secondary surface for browsing and managing tasks.

### Views

**Kanban** (default) — columns: captured / active / in_progress / done / blocked / deferred. Drag cards to change status. Click a card to open the detail dialog.

**List view** — sortable table with title, status, priority, deadline, last updated.

**Task detail dialog** — edit all fields, view sub-tasks, comments, calendar events, delete.

**Filters (top bar)** — workspace, status (multi-select), deadline (overdue / this week / this month / none). Applied client-side.

Offline-first: IndexedDB caches task data; service worker serves cached views without connectivity.

---

## Proactive notifications

Cortex sends these automatically — no user action needed.

| Notification | Trigger | Format |
|---|---|---|
| ⏰ Deadline reminder | Task deadline − lead time (default 24h) | Task title, deadline, [Done] [Start] [Defer] buttons |
| 📋 Check-in | Task `in_progress` for N days without update | "How's {title} going?" + status buttons |
| 🔄 Resurfaced | Deferred task's resume date reached | "Ready to pick up?" + [Start] [Done] [Defer] |
| 📝 Meeting captured | After successful vault write | Title, duration, attendee count, vault path |

---

## Google Calendar

Tasks support two calendar flows:

**Block time (📅 button):** Cortex extracts estimated effort from the task, resolves attendee names to emails via the contacts directory (prompts for unknowns), and creates an event at deadline − effort, clamped to working hours (09:30–20:00 in your timezone).

**Suggest time (⏰ button):** Queries freeBusy across all configured calendars, returns up to 5 free slots before the deadline. Each slot is a button — tap to accept.

**Direct booking (text message):** "Schedule 30 min with Sarah next Tuesday at 10am" → Cortex extracts details, shows a confirmation message, checks for conflicts, then books.

---

## Deployment

### Backend (Fly.io)

```bash
fly deploy
```

Release command (`fly.toml`) runs `npx prisma migrate deploy` automatically.

Secrets (set via `fly secrets set KEY=VALUE`):

```
DATABASE_URL
REDIS_URL
ANTHROPIC_API_KEY
OPENAI_API_KEY
TELEGRAM_BOT_TOKEN
OWNER_CHAT_ID
WEBHOOK_DOMAIN
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_CALENDAR_IDS
USER_TIMEZONE
NIRVANA_WIKI_REPO_URL
NIRVANA_WIKI_LOCAL_DIR
NIRVANA_WIKI_SSH_KEY_PATH
NIRVANA_WIKI_DEPLOY_KEY_B64
CORTEX_LOCAL_SHARED_SECRET
FATHOM_WEBHOOK_SECRET
```

### Dashboard (Cloudflare Pages)

```bash
cd dashboard
npm run build
# deploy via wrangler or Cloudflare Pages CI
```

### Database (Neon)

```bash
npx prisma migrate deploy   # applies pending migrations
npx prisma db seed          # seeds workspaces
```

---

## Local development

```bash
# 1. Install
npm install
cd dashboard && npm install && cd ..

# 2. Configure
cp .env.example .env
# fill in DATABASE_URL, REDIS_URL, ANTHROPIC_API_KEY, OPENAI_API_KEY,
# TELEGRAM_BOT_TOKEN, OWNER_CHAT_ID, WEBHOOK_DOMAIN, GOOGLE_*, NIRVANA_WIKI_*

# 3. Database
npx prisma migrate dev
npx prisma db seed

# 4. Google Calendar OAuth (one-time)
npx tsx scripts/google-oauth-setup.ts

# 5. Run
npm run start:dev            # backend at :3000
cd dashboard && npm run dev  # dashboard at :5173
```

For local Telegram testing: use ngrok for a public URL, or set `TELEGRAM_MODE=polling` in `.env`.

---

## Scripts reference

| Script | When to use |
|---|---|
| `npm run register-fathom-webhook` | One-time: register Cortex's URL with Fathom. Outputs the webhook secret. |
| `npm run fathom-backfill` | Dry-run list of all Fathom recordings. |
| `npm run fathom-backfill -- --ingest` | Ingest all Fathom recordings into nirvana-wiki. |
| `npm run fathom-backfill -- --ingest --id <n>` | Ingest a single recording by `recording_id`. |
| `npx tsx scripts/google-oauth-setup.ts` | One-time: Google Calendar OAuth flow (produces refresh token). |
| `scripts/entrypoint.sh` | Fly.io startup: materializes SSH key, runs migrations, starts server. |

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | NestJS 11, TypeScript, Prisma |
| Database | PostgreSQL (Neon) |
| Queue / sessions | Redis via Upstash (pg-boss + session store) |
| LLM | Claude Opus (decomposition) + Sonnet (classification, extraction) |
| Voice | OpenAI Whisper |
| Bot | Telegraf (webhook mode) |
| Frontend | React + Vite + TanStack Router/Query + Tailwind + shadcn/ui |
| Hosting | Fly.io (backend) + Cloudflare Pages (dashboard) |
| Vault | Git (nirvana-wiki, SSH push) |

---

## Project layout

```
src/                  NestJS backend
  telegram/           Webhook intake, message routing, inline keyboards
  llm/                Claude + Whisper, prompts, response parsing
  task/               Task lifecycle + REST controller
  meetings/           Ingest endpoint + Fathom webhook controller
  note/               Note capture service
  calendar/           Google Calendar integration
  scheduler/          pg-boss job processors (reminders, check-ins, resurfacing)
  vault/              Git-backed file writer (mutex-serialized)
  workspace/          Work/Personal scoping
  session/            Redis-backed 30-min conversation context
  settings/           Per-user preferences
  auth/               SharedSecretGuard, FathomWebhookGuard
prisma/               Schema, migrations, seed
dashboard/            React PWA
scripts/              One-off utilities (fathom backfill, OAuth setup, etc.)
docs/hld.md           Full high-level design
.planning/            GSD phase-based planning artifacts
```

---

See [`docs/hld.md`](docs/hld.md) for the full design document and [`.planning/`](.planning/) for phase-by-phase build history.
