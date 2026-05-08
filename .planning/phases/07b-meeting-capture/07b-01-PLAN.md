---
phase: 07b-meeting-capture
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - prisma/schema.prisma
  - prisma/migrations
  - src/main.ts
  - src/auth/shared-secret.guard.ts
  - src/auth/shared-secret.guard.spec.ts
  - src/meetings/meetings.module.ts
  - src/meetings/meetings.controller.ts
  - src/meetings/meetings.controller.spec.ts
  - src/meetings/meetings.service.ts
  - src/meetings/meetings.service.spec.ts
  - src/meetings/meetings.types.ts
  - src/heartbeat/heartbeat.module.ts
  - src/heartbeat/heartbeat.controller.ts
  - src/heartbeat/heartbeat.controller.spec.ts
  - src/heartbeat/heartbeat.service.ts
  - src/heartbeat/heartbeat.service.spec.ts
  - src/heartbeat/heartbeat.types.ts
  - src/heartbeat/heartbeat-staleness.service.ts
  - src/heartbeat/heartbeat-staleness.service.spec.ts
  - src/scheduler/notification.service.ts
  - src/scheduler/notification.service.spec.ts
  - src/scheduler/scheduler.module.ts
  - src/app.module.ts
  - .env.example
autonomous: true
requirements:
  - MEET-03
  - MEET-04
  - MEET-05
  - MEET-06
  - MEET-07
  - MEET-08
  - MEET-09
  - VAULT-06

user_setup:
  - service: cortex-local-shared-secret
    why: "MeetingsController + HeartbeatController authenticate the cortex-local daemon via this Bearer token. Plan 07b-02 stores the same value in macOS Keychain on the Mac mini."
    env_vars:
      - name: CORTEX_LOCAL_SHARED_SECRET
        source: "Generate locally: `openssl rand -hex 32`. Then set on Fly: `fly secrets set CORTEX_LOCAL_SHARED_SECRET=<value> -a cortex-hindole`. The same value is later stored in macOS Keychain on the Mac mini during plan 07b-02 install."

must_haves:
  truths:
    - "POST /api/meetings/ingest with a valid Bearer token persists a Meeting row, writes a verbatim transcript to nirvana-wiki/raw/meetings/YYYY-MM-DD-{title-slug}.md, and returns the meeting_id + vault_path + commit_sha"
    - "POST /api/meetings/ingest without a Bearer token (or with the wrong token) returns 401 — NOT silently dropped"
    - "Every Meeting row is created in the Work workspace by default (no attendee-domain heuristic, no fallback to Personal)"
    - "Audio is never accepted on /api/meetings/ingest — the Zod payload schema only allows text fields and rejects any base64-audio-shaped payload"
    - "After successful ingest, the bot DMs the owner: `Meeting captured: \"<title>\" (<duration>, <N> attendees) → <vault path>` with duration formatted as \"47 min\" if <60 or \"1h 12m\" if ≥60"
    - "POST /api/heartbeat upserts a Heartbeat row keyed by host with last_seen_at = now()"
    - "Once per day at Settings.notificationHourUtc, a pg-boss-scheduled job DMs the owner if any Heartbeat.last_seen_at is older than 26 hours"
    - "MEET-06 escalation chain (server side): when the daemon reports a non-null `last_error` for the first time (or with a value different from the previously stored `lastError`), HeartbeatService.upsert fires NotificationService.sendUploadFailed exactly once — fire-and-forget, must not fail the heartbeat upsert. Repeated heartbeats with the same `last_error` string do NOT re-notify (de-dupe by string equality)."
    - "Express body parser accepts JSON payloads up to 5 MB (so 1h transcripts ~50-200KB do not 413)"
    - "/vault recent on Telegram returns the meeting alongside any prior notes (already polymorphic via VaultWrite kind from 7a — confirmed by integration test)"
  artifacts:
    - path: "prisma/schema.prisma"
      provides: "Meeting + Heartbeat Prisma models, MeetingSource enum"
      contains: "model Meeting"
    - path: "src/auth/shared-secret.guard.ts"
      provides: "SharedSecretGuard — CanActivate, reads CORTEX_LOCAL_SHARED_SECRET, constant-time compare via node:crypto.timingSafeEqual, throws UnauthorizedException on mismatch"
      min_lines: 30
    - path: "src/meetings/meetings.controller.ts"
      provides: "POST /api/meetings/ingest behind @UseGuards(SharedSecretGuard); Zod-validates IngestPayloadSchema; delegates to MeetingsService.ingest()"
      contains: "@Post('ingest')"
    - path: "src/meetings/meetings.service.ts"
      provides: "ingest() — slug via slug npm lib (no LLM), build header, call vault.writeFile with kind='meeting', persist Meeting row, fire-and-forget NotificationService.sendMeetingCaptured"
      min_lines: 80
    - path: "src/meetings/meetings.types.ts"
      provides: "IngestPayloadSchema (Zod) — title, started_at, ended_at, attendees, transcript, source='meetily', external_id?"
      contains: "IngestPayloadSchema"
    - path: "src/heartbeat/heartbeat.controller.ts"
      provides: "POST /api/heartbeat behind @UseGuards(SharedSecretGuard); upserts Heartbeat row"
      contains: "@Post()"
    - path: "src/heartbeat/heartbeat.service.ts"
      provides: "upsert() reads existing row, computes lastError change (was null/different → now non-null and changed), fires NotificationService.sendUploadFailed fire-and-forget on transition. findStale(cutoff) returns rows with lastSeenAt < cutoff."
      min_lines: 60
      contains: "sendUploadFailed"
    - path: "src/heartbeat/heartbeat-staleness.service.ts"
      provides: "OnModuleInit registers pg-boss daily cron at Settings.notificationHourUtc; queries stale heartbeats (>26h) and DMs owner via NotificationService.sendHeartbeatStale"
      min_lines: 40
    - path: "src/scheduler/notification.service.ts"
      provides: "sendMeetingCaptured() + sendHeartbeatStale() + sendUploadFailed() — extends existing service. sendUploadFailed is the MEET-06 server-side escalation channel: HTML-formatted Telegram DM with host + escapeHtml(error)."
      contains: "sendUploadFailed"
    - path: "src/scheduler/notification.service.spec.ts"
      provides: "Unit tests for sendMeetingCaptured, sendHeartbeatStale, sendUploadFailed (HTML escape, ownerChatId, parse_mode), and the formatDuration static helper. Mocks the Telegraf bot."
      min_lines: 40
    - path: "src/heartbeat/heartbeat.service.spec.ts"
      provides: "Tests for upsert (fresh insert, update without change, lastError-transition triggers sendUploadFailed exactly once, repeated same-error does NOT re-notify, sendUploadFailed rejection does NOT fail the upsert) + findStale shape."
      min_lines: 50
      contains: "sendUploadFailed"
    - path: "src/main.ts"
      provides: "app.use(json({ limit: '5mb' })) so 1h transcripts do not 413"
      contains: "limit: '5mb'"
  key_links:
    - from: "src/meetings/meetings.controller.ts"
      to: "src/auth/shared-secret.guard.ts"
      via: "@UseGuards(SharedSecretGuard) at controller level"
      pattern: "@UseGuards\\(SharedSecretGuard\\)"
    - from: "src/auth/shared-secret.guard.ts"
      to: "node:crypto.timingSafeEqual"
      via: "Buffer comparison; throws UnauthorizedException on length mismatch or bytes mismatch"
      pattern: "timingSafeEqual"
    - from: "src/meetings/meetings.service.ts"
      to: "src/vault/vault.service.ts"
      via: "this.vault.writeFile({ vaultPath, body, commitMessage, kind: 'meeting', sourceId: meetingId })"
      pattern: "vault\\.writeFile.*kind:\\s*['\"]meeting['\"]"
    - from: "src/meetings/meetings.service.ts"
      to: "src/scheduler/notification.service.ts"
      via: "this.notifications.sendMeetingCaptured({...}).catch(log) — fire-and-forget, must not fail the ingest"
      pattern: "sendMeetingCaptured"
    - from: "src/meetings/meetings.service.ts"
      to: "src/workspace/workspace.service.ts"
      via: "this.workspace.findByName('work') — locked default per MEET-08"
      pattern: "findByName\\(['\"]work['\"]\\)"
    - from: "src/heartbeat/heartbeat.service.ts"
      to: "src/scheduler/notification.service.ts"
      via: "MEET-06 escalation: when incoming payload.last_error is non-null AND differs from existing row's lastError (including null→string), call this.notifications.sendUploadFailed({ host, error }).catch(log) — fire-and-forget, must not fail the upsert"
      pattern: "sendUploadFailed"
    - from: "src/heartbeat/heartbeat-staleness.service.ts"
      to: "src/scheduler/scheduler.service.ts"
      via: "this.scheduler.boss.schedule('heartbeat-staleness-check', cron) at OnModuleInit"
      pattern: "boss\\.schedule"
    - from: "src/heartbeat/heartbeat-staleness.service.ts"
      to: "src/settings/settings.service.ts"
      via: "settings.get() to derive cron hour from notificationHourUtc"
      pattern: "settings\\.get\\(\\)"
    - from: "src/main.ts"
      to: "express.json"
      via: "app.use(json({ limit: '5mb' })) BEFORE the webhook callback"
      pattern: "json\\(\\{\\s*limit:\\s*['\"]5mb['\"]"
---

<objective>
Build the cortex-side server surface for meeting capture: schema + bearer-token-authenticated `POST /api/meetings/ingest` that writes verbatim transcripts to `raw/meetings/` via the Phase 7a VaultService, plus `POST /api/heartbeat` and a daily pg-boss cron that DMs the owner when the cortex-local watcher goes silent for >26h. Also raise the Express JSON body limit to 5 MB so a 1h transcript does not 413, extend NotificationService with three new message types (`sendMeetingCaptured`, `sendHeartbeatStale`, `sendUploadFailed`), wire MEET-06's server-side escalation chain (HeartbeatService detects when the daemon reports a fresh `last_error` and DMs the owner via `sendUploadFailed`), and verify (via integration test) that VAULT-06's `/vault recent` already polymorphically lists meeting writes (no new code needed there — Phase 7a built it polymorphic).

Purpose: Plan 07b-02 (the cortex-local daemon on the Mac mini) cannot ship without the receiving end. This plan delivers every server-side requirement (MEET-03, MEET-04, MEET-05, MEET-06 server-side escalation, MEET-08, server side of MEET-07 + MEET-09, VAULT-06) so the daemon plan is pure client work.

Output:
- Two new Prisma models (Meeting, Heartbeat) + MeetingSource enum + migration
- New `src/auth/` containing `SharedSecretGuard` (constant-time compare via `node:crypto.timingSafeEqual`, throws `UnauthorizedException` — NOT silent drop)
- New `src/meetings/` module: controller (`@UseGuards(SharedSecretGuard)`), service (`slug` lib for title slug, no LLM), Zod payload schema
- New `src/heartbeat/` module: controller, upsert service with MEET-06 lastError change-detection, daily-staleness pg-boss cron registered at `Settings.notificationHourUtc`
- Extended `NotificationService` with `sendMeetingCaptured()`, `sendHeartbeatStale()`, and `sendUploadFailed()` (MEET-06 escalation channel)
- `src/main.ts` raised to `5mb` JSON body limit
- `.env.example` documents `CORTEX_LOCAL_SHARED_SECRET`
- Tests: SharedSecretGuard (401 on missing/wrong/length-mismatch tokens; 200 on valid), MeetingsService (slug + workspace=Work + vault.writeFile shape + duplicate external_id idempotency), HeartbeatService (lastError-transition detection: fires sendUploadFailed once on null→string transition, does NOT re-notify on repeated same-error), HeartbeatStalenessService (queries stale rows, fires notification per host), formatDuration helper
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@docs/hld.md
@.planning/phases/07b-meeting-capture/07b-RESEARCH.md
@.planning/phases/07a-note-capture/07a-01-SUMMARY.md
@.planning/phases/07a-note-capture/07a-02-SUMMARY.md

@prisma/schema.prisma
@src/main.ts
@src/app.module.ts
@src/telegram/guards/chat-id.guard.ts
@src/scheduler/scheduler.service.ts
@src/scheduler/scheduler.module.ts
@src/scheduler/notification.service.ts
@src/scheduler/reminder.service.ts
@src/settings/settings.service.ts
@src/workspace/workspace.service.ts

<interfaces>
<!-- Existing exports the new code consumes. Use these directly — do not re-explore the codebase. -->

From src/vault/vault.service.ts (Phase 7a):
```typescript
export interface WriteFileInput {
  vaultPath: string;     // MUST start with raw/inbox/ or raw/meetings/ (assertAllowedPath enforces)
  body: string;
  commitMessage: string;
  kind: 'note' | 'meeting';   // VaultWriteKind — both already declared in 7a's enum
  sourceId: string;            // Meeting.id for this plan; polymorphic
}
export interface WriteFileResult {
  commitSha: string;
  vaultPath: string;     // post-collision-resolution
}
export class VaultService implements OnModuleInit {
  async writeFile(input: WriteFileInput): Promise<WriteFileResult>;
  async revertLastCommit(expectedSha: string): Promise<{ commitSha: string }>;
}
```

VaultModule is exported by src/vault/vault.module.ts. Import it in MeetingsModule. NO changes to VaultService — `assertAllowedPath` already permits `raw/meetings/` (verified in 7a-01-PLAN must_haves).

From src/workspace/workspace.service.ts:
```typescript
export class WorkspaceService {
  async getDefault(): Promise<Workspace>;
  async findByName(name: 'personal' | 'work'): Promise<Workspace | null>;  // returns null if missing
  async findAll(): Promise<Workspace[]>;
}
```

From src/scheduler/scheduler.service.ts:
```typescript
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  readonly boss: PgBoss;  // already started in onModuleInit; createQueue('deadline-reminder') already done
  // We add createQueue + work + schedule for 'heartbeat-staleness-check' in HeartbeatStalenessService.onModuleInit
}
```

From src/scheduler/notification.service.ts (we EXTEND it):
```typescript
@Injectable()
export class NotificationService {
  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly config: ConfigService,
  ) { this.ownerChatId = parseInt(config.getOrThrow('OWNER_CHAT_ID'), 10); }
  async sendDeadlineReminder(...): Promise<void>;
  async sendCheckInPrompt(...): Promise<void>;
  async sendDeferredResurface(...): Promise<void>;
  // NEW (this plan):
  async sendMeetingCaptured(input: { title; startedAt; endedAt; attendeeCount; vaultPath }): Promise<void>;
  async sendHeartbeatStale(input: { host; hoursAgo; lastError? }): Promise<void>;
  async sendUploadFailed(input: { host; error }): Promise<void>;   // MEET-06 escalation
  private escapeHtml(text: string): string;  // already exists — reuse
}
```

From src/settings/settings.service.ts:
```typescript
export class SettingsService {
  async get(): Promise<{ id; reminderLeadMinutes; checkInAfterDays; notificationHourUtc; createdAt; updatedAt }>;
  async update(data): Promise<...>;
}
```

From src/telegram/guards/chat-id.guard.ts (mirror the SHAPE — but SharedSecretGuard MUST throw, not silently return false):
```typescript
@Injectable()
export class ChatIdGuard implements CanActivate {
  constructor(private readonly config: ConfigService) { ... }
  canActivate(context: ExecutionContext): boolean {
    const ctx = TelegrafExecutionContext.create(context).getContext<Context>();
    return ctx.chat?.id === this.ownerChatId;  // silent drop is correct for Telegram noise
  }
}
```

From src/main.ts (current — we ADD the body-parser config):
```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({...});
  // <-- INSERT: app.use(json({ limit: '5mb' })); app.use(urlencoded({ limit: '5mb', extended: true }));
  const bot = app.get<Telegraf>(getBotToken());
  app.use(bot.webhookCallback(`/bot/${process.env.TELEGRAM_BOT_TOKEN}`));
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
```

`express` and `body-parser` are already transitive deps of `@nestjs/platform-express`. Import `json` and `urlencoded` from `express` directly — no new install.

VaultWriteKind enum (already declared in Phase 7a's schema with values `note` and `meeting` — reuse; do NOT redeclare):
```prisma
enum VaultWriteKind {
  note
  meeting
  @@map("vault_write_kind")
}
```

WorkspaceName enum (already declared in original schema):
```prisma
enum WorkspaceName {
  personal
  work
}
```

Migration generation pattern (from STATE.md "Migration SQL generated offline via prisma migrate diff" + Phase 03 STATE decision on Prisma 7 flag names):
```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_add_meeting_and_heartbeat
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<new-dir>/migration.sql
```

Test runner: vitest (`npm test` runs `vitest run`). Spec files live next to source as *.spec.ts. Pattern from src/llm/classification.service.spec.ts and src/scheduler/notification.service.spec.ts.

`pg-boss.schedule()` API confirmation (from RESEARCH.md):
```typescript
await boss.createQueue('heartbeat-staleness-check');
await boss.work('heartbeat-staleness-check', async () => { /* checkStale() */ });
await boss.schedule('heartbeat-staleness-check', '0 9 * * *');  // daily at 9 UTC
// schedule() is idempotent — safe to call again with same name to update cron expression.
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Meeting + Heartbeat Prisma models, MeetingSource enum, migration, and raise body-parser to 5mb</name>
  <files>prisma/schema.prisma, prisma/migrations/&lt;new&gt;/migration.sql, src/main.ts, .env.example</files>
  <action>
**Update `prisma/schema.prisma`:**

Add ONE enum and TWO models. Place the enum next to the existing enums (after `CommentSource`) and the models after the existing `Settings` model. Mirror the exact camelCase + `@map("snake_case")` + `@@map("snake_case_table")` conventions used by every existing model.

1. Add enum `MeetingSource` with a single value `meetily` (extensibility — fathom, manual added later without migration). Map to `meeting_source`.

   ```prisma
   enum MeetingSource {
     meetily

     @@map("meeting_source")
   }
   ```

2. Add `model Meeting`:
   - id              String  @id @default(uuid())
   - workspaceId     String  @map("workspace_id")
   - workspace       Workspace @relation(fields: [workspaceId], references: [id])
   - title           String
   - startedAt       DateTime @map("started_at")
   - endedAt         DateTime @map("ended_at")
   - attendeeEmails  String[] @map("attendee_emails")  // verbatim from Meetily — names or emails
   - transcript      String   @db.Text                 // explicit Text type (long body)
   - source          MeetingSource
   - externalId      String?  @map("external_id")      // meetily-exporter meeting-id for idempotency
   - vaultPath       String   @map("vault_path")
   - vaultCommitSha  String   @map("vault_commit_sha")
   - createdAt       DateTime @default(now()) @map("created_at")
   - @@unique([source, externalId], map: "meeting_external_id_unique")  // composite unique — null externalIds do not conflict
   - @@index([workspaceId, createdAt])
   - @@index([startedAt])
   - @@map("meetings")

3. Add `model Heartbeat` (single row per host — upsert pattern):
   - id           String   @id @default(uuid())
   - host         String   @unique                       // e.g. "mac-mini-home" — daemon's `host` config field
   - version      String?                                // npm_package_version from daemon, optional
   - lastSeenAt   DateTime @map("last_seen_at")
   - lastIngestAt DateTime? @map("last_ingest_at")       // optional — daemon may report most-recent successful ingest
   - queueDepth   Int?     @map("queue_depth")           // optional — pending uploads in daemon's JSON queue
   - lastError    String?  @map("last_error")            // optional — surfaces daemon-side terminal upload failures (RESEARCH.md MEET-06 design — daemon escalates via this field, not direct Telegram)
   - createdAt    DateTime @default(now()) @map("created_at")
   - updatedAt    DateTime @updatedAt @map("updated_at")
   - @@index([lastSeenAt])
   - @@map("heartbeats")

4. Add the inverse relation on `model Workspace`: append `meetings Meeting[]` to the relations block (alongside existing `tasks Task[]`, `contacts Contact[]`, and `notes Note[]` from 7a).

5. Do NOT redeclare `VaultWriteKind` — Phase 7a already has values `note` and `meeting`. Verify with `grep "enum VaultWriteKind" prisma/schema.prisma` — if `meeting` is missing for any reason, add it.

**Generate migration** (offline-diff per STATE.md decision — no local Postgres):

```bash
MIGDIR="prisma/migrations/$(date +%Y%m%d%H%M%S)_add_meeting_and_heartbeat"
mkdir -p "$MIGDIR"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$MIGDIR/migration.sql"
```

Use Prisma 7 flag names per Phase 03 STATE decision: `--from-migrations` / `--to-schema-datamodel`. If those flag names changed, run `npx prisma migrate diff --help` to confirm.

Inspect the generated SQL to confirm:
- `CREATE TYPE "meeting_source" AS ENUM ('meetily');`
- `CREATE TABLE "meetings"` with the columns listed above
- `CREATE TABLE "heartbeats"` with `host TEXT UNIQUE NOT NULL`
- `CREATE INDEX` statements for the indexes declared in Prisma

Then regenerate the Prisma client:
```bash
npx prisma generate
```

Do NOT run `prisma migrate deploy` locally — `release_command` in fly.toml runs it on deploy.

**Update `src/main.ts` — raise JSON body limit to 5 MB:**

The default Express body limit is 100KB; a 1h transcript can be 100-200KB and would 413 (RESEARCH.md Pitfall 2). Add the body-parser config BEFORE the Telegraf webhook callback (the webhook handler installs its own body parser, but our `/api/*` routes use Nest's default).

```typescript
// src/main.ts — INSERT lines marked NEW
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getBotToken } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { json, urlencoded } from 'express';   // NEW

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
    methods: ['GET', 'PATCH', 'POST', 'DELETE'],
    credentials: true,
  });

  // Raise body-parser limit to 5MB so 1h meeting transcripts (50-200KB typical, up to ~1.5MB) do not 413.
  // MUST come BEFORE bot.webhookCallback so Telegraf installs its own parser AFTER ours for the webhook path.
  app.use(json({ limit: '5mb' }));                          // NEW
  app.use(urlencoded({ limit: '5mb', extended: true }));    // NEW

  const bot = app.get<Telegraf>(getBotToken());
  app.use(bot.webhookCallback(`/bot/${process.env.TELEGRAM_BOT_TOKEN}`));

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
```

`express` is a transitive dep of `@nestjs/platform-express` (already installed) — no `npm install` needed.

**Update `.env.example`:**

Append (do NOT remove existing lines):
```
# --- Phase 7b: Meeting Capture ---
# Bearer token shared between cortex (this server) and the cortex-local daemon on the Mac mini.
# Generate: `openssl rand -hex 32` then `fly secrets set CORTEX_LOCAL_SHARED_SECRET=<value>`.
# The same value is stored in macOS Keychain on the Mac mini (cortex-local install script).
CORTEX_LOCAL_SHARED_SECRET=
```
  </action>
  <verify>
    <automated>npx prisma format && npx prisma generate && grep -q "model Meeting" prisma/schema.prisma && grep -q "model Heartbeat" prisma/schema.prisma && grep -q "MeetingSource" prisma/schema.prisma && ls prisma/migrations/*add_meeting_and_heartbeat*/migration.sql && grep -q "limit: '5mb'" src/main.ts && grep -q "CORTEX_LOCAL_SHARED_SECRET" .env.example</automated>
  </verify>
  <done>schema.prisma contains Meeting + Heartbeat models and MeetingSource enum; Workspace.meetings back-relation present; one new migration directory exists with non-empty migration.sql containing CREATE TABLE meetings + CREATE TABLE heartbeats; `npx prisma generate` succeeds and emits Meeting + Heartbeat types; src/main.ts has `app.use(json({ limit: '5mb' }))` BEFORE the Telegraf webhook setup; .env.example documents CORTEX_LOCAL_SHARED_SECRET.</done>
</task>

<task type="auto">
  <name>Task 2: Build SharedSecretGuard + MeetingsModule (controller, service, types) + extend NotificationService with sendMeetingCaptured + sendHeartbeatStale + sendUploadFailed (+ spec)</name>
  <files>src/auth/shared-secret.guard.ts, src/auth/shared-secret.guard.spec.ts, src/meetings/meetings.module.ts, src/meetings/meetings.controller.ts, src/meetings/meetings.controller.spec.ts, src/meetings/meetings.service.ts, src/meetings/meetings.service.spec.ts, src/meetings/meetings.types.ts, src/scheduler/notification.service.ts, src/scheduler/notification.service.spec.ts, src/app.module.ts</files>
  <action>
**Create `src/auth/shared-secret.guard.ts`:**

Mirror the shape of `src/telegram/guards/chat-id.guard.ts` but use HTTP `ExecutionContext` (not TelegrafExecutionContext) and THROW `UnauthorizedException` rather than silently returning false. Per RESEARCH.md MEET-03: silent drop is correct for ChatIdGuard (random Telegram users may DM the bot — noise) but WRONG here (the daemon needs to know its auth failed so the user can correct the secret).

```typescript
import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class SharedSecretGuard implements CanActivate {
  private readonly logger = new Logger(SharedSecretGuard.name);
  private readonly expectedSecret: Buffer;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.getOrThrow<string>('CORTEX_LOCAL_SHARED_SECRET');
    if (secret.length < 32) {
      throw new Error('CORTEX_LOCAL_SHARED_SECRET must be at least 32 characters (use `openssl rand -hex 32`)');
    }
    this.expectedSecret = Buffer.from(secret, 'utf8');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = (req.headers.authorization as string | undefined) ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m) {
      this.logger.warn(`SharedSecretGuard: missing Bearer header (path=${req.path})`);
      throw new UnauthorizedException('Missing bearer token');
    }
    const provided = Buffer.from(m[1], 'utf8');
    if (provided.length !== this.expectedSecret.length) {
      this.logger.warn(`SharedSecretGuard: token length mismatch (path=${req.path})`);
      throw new UnauthorizedException('Invalid token');
    }
    if (!timingSafeEqual(provided, this.expectedSecret)) {
      this.logger.warn(`SharedSecretGuard: token mismatch (path=${req.path})`);
      throw new UnauthorizedException('Invalid token');
    }
    return true;
  }
}
```

**Create `src/auth/shared-secret.guard.spec.ts`:**

vitest tests using the existing test pattern (Test.createTestingModule). Do NOT spin up a real Express request — construct a minimal `ExecutionContext` mock that returns `{ switchToHttp: () => ({ getRequest: () => ({ headers, path }) }) }` shape.

Tests:
1. Constructor throws if `CORTEX_LOCAL_SHARED_SECRET` is missing (use a ConfigService mock whose `getOrThrow` throws).
2. Constructor throws if secret is shorter than 32 chars.
3. `canActivate` throws `UnauthorizedException('Missing bearer token')` when `Authorization` header is absent.
4. `canActivate` throws `UnauthorizedException('Invalid token')` when header is present but lacks `Bearer ` prefix.
5. `canActivate` throws `UnauthorizedException('Invalid token')` when the bearer token has wrong length.
6. `canActivate` throws `UnauthorizedException('Invalid token')` when the bearer token is the same length but different bytes (verifies timingSafeEqual is wired — without length-equal-but-bytes-different, timingSafeEqual would throw RangeError).
7. `canActivate` returns `true` when the bearer token exactly matches `CORTEX_LOCAL_SHARED_SECRET`.

**Create `src/meetings/meetings.types.ts`:**

```typescript
import { z } from 'zod';

export const IngestPayloadSchema = z.object({
  title: z.string().min(1).max(500),
  started_at: z.string().datetime(),       // ISO 8601 UTC
  ended_at: z.string().datetime(),
  attendees: z.array(z.string().min(1)).max(50),  // names or emails — verbatim from Meetily
  transcript: z.string().min(1).max(5_000_000),    // 5MB hard cap (≈ 1.5M words; matches main.ts body limit)
  source: z.literal('meetily'),
  external_id: z.string().min(1).max(200).optional(),  // meetily-exporter meeting-id for idempotency
});
export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

export const IngestResponseSchema = z.object({
  meeting_id: z.string(),
  vault_path: z.string(),
  commit_sha: z.string(),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;
```

Note: schema does NOT accept any binary/base64 audio fields. MEET-07 invariant — even if a future Meetily version sneaks audio into the JSON, this schema rejects it.

**Create `src/meetings/meetings.controller.ts`:**

```typescript
import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { SharedSecretGuard } from '../auth/shared-secret.guard';
import { MeetingsService } from './meetings.service';
import { IngestPayloadSchema } from './meetings.types';

@Controller('api/meetings')
@UseGuards(SharedSecretGuard)
export class MeetingsController {
  private readonly logger = new Logger(MeetingsController.name);
  constructor(private readonly meetings: MeetingsService) {}

  @Post('ingest')
  async ingest(@Body() body: unknown) {
    const parsed = IngestPayloadSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`Invalid ingest payload: ${JSON.stringify(parsed.error.flatten())}`);
      throw new BadRequestException({ errors: parsed.error.flatten() });
    }
    return this.meetings.ingest(parsed.data);
  }
}
```

**Create `src/meetings/meetings.service.ts`:**

Implementation per RESEARCH.md Pattern 2. Key invariants:
- Workspace ALWAYS Work (MEET-08 — locked, no heuristic).
- Slug from title via `slug` library (no LLM — title is concrete; saves Sonnet cost + latency per RESEARCH.md anti-pattern).
- Date prefix uses `started_at` in UTC (matches the note flow's `new Date().toISOString().slice(0,10)` convention).
- Body shape per HLD §3.8 B-MEET-4 exactly.
- Idempotency: if `external_id` provided AND a Meeting with `(source='meetily', externalId)` already exists, return the existing record (do NOT re-write the vault; do NOT re-notify). This prevents duplicate ingest if the user accidentally moves a file out of `_ingested/`.
- Notification fires-and-forgets — Telegram failures must NOT fail the ingest (RESEARCH.md Pitfall 9).

```typescript
import { Injectable, Logger } from '@nestjs/common';
import slugify from 'slug';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { NotificationService } from '../scheduler/notification.service';
import type { IngestPayload, IngestResponse } from './meetings.types';

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly workspace: WorkspaceService,
    private readonly notifications: NotificationService,
  ) {}

  async ingest(p: IngestPayload): Promise<IngestResponse> {
    // Idempotency check (RESEARCH.md Pitfall 8) — skip if external_id already ingested.
    if (p.external_id) {
      const existing = await this.prisma.meeting.findFirst({
        where: { source: 'meetily', externalId: p.external_id },
      });
      if (existing) {
        this.logger.log(`Duplicate ingest external_id=${p.external_id}; returning existing meeting=${existing.id}`);
        return {
          meeting_id: existing.id,
          vault_path: existing.vaultPath,
          commit_sha: existing.vaultCommitSha,
        };
      }
    }

    // Workspace — locked to Work per MEET-08.
    const workspace = await this.workspace.findByName('work');
    if (!workspace) {
      throw new Error('Work workspace not found in DB — seed missing or migrated incorrectly');
    }

    // Slug from title — pure transform, no LLM. Cap at 80 chars (RESEARCH.md anti-pattern: long titles).
    const baseSlug = slugify(p.title, { lower: true }).slice(0, 80);
    const slug = baseSlug.length > 0 ? baseSlug : 'untitled-meeting';

    // Date prefix — started_at, UTC date.
    const startedAt = new Date(p.started_at);
    const endedAt = new Date(p.ended_at);
    const dateStr = startedAt.toISOString().slice(0, 10);
    const vaultPath = `raw/meetings/${dateStr}-${slug}.md`;

    // Verbatim body per HLD §3.8 B-MEET-4 (Source / Date / Started / Ended / Attendees + --- + transcript).
    const startedFmt = startedAt.toISOString().slice(11, 16);   // HH:MM UTC
    const endedFmt = endedAt.toISOString().slice(11, 16);
    const attendeesLine = p.attendees.length > 0 ? p.attendees.join(', ') : '(unknown)';
    const body = [
      `Source: Meetily (Google Meet)`,
      `Date: ${dateStr}`,
      `Started: ${startedFmt}`,
      `Ended: ${endedFmt}`,
      `Attendees: ${attendeesLine}`,
      ``,
      `---`,
      ``,
      p.transcript,
    ].join('\n');

    const meetingId = randomUUID();

    // Vault write — Phase 7a's VaultService records the VaultWrite audit row in try/finally.
    const writeResult = await this.vault.writeFile({
      vaultPath,
      body,
      commitMessage: `meeting: ${slug}`,
      kind: 'meeting',
      sourceId: meetingId,
    });

    const meeting = await this.prisma.meeting.create({
      data: {
        id: meetingId,
        workspaceId: workspace.id,
        title: p.title,
        startedAt,
        endedAt,
        attendeeEmails: p.attendees,
        transcript: p.transcript,
        source: 'meetily',
        externalId: p.external_id ?? null,
        vaultPath: writeResult.vaultPath,
        vaultCommitSha: writeResult.commitSha,
      },
    });

    // Telegram notification — fire-and-forget. Failure must NOT fail the ingest (Pitfall 9).
    this.notifications
      .sendMeetingCaptured({
        title: p.title,
        startedAt,
        endedAt,
        attendeeCount: p.attendees.length,
        vaultPath: writeResult.vaultPath,
      })
      .catch((err) => this.logger.warn(`Meeting notification failed (meetingId=${meetingId}): ${String(err)}`));

    return {
      meeting_id: meeting.id,
      vault_path: writeResult.vaultPath,
      commit_sha: writeResult.commitSha,
    };
  }
}
```

`slug` (npm) was installed in 7a-01. `import slugify from 'slug';` works because the package's default export is the slugify function.

**Create `src/meetings/meetings.module.ts`:**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultModule } from '../vault/vault.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { SharedSecretGuard } from '../auth/shared-secret.guard';

@Module({
  imports: [ConfigModule, PrismaModule, VaultModule, WorkspaceModule, SchedulerModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, SharedSecretGuard],
  exports: [MeetingsService],
})
export class MeetingsModule {}
```

(SharedSecretGuard is provided here so Nest can resolve it for `@UseGuards`. If Plan 07b-01 had a separate AuthModule we'd put it there — but a single guard doesn't justify a module.)

**Extend `src/scheduler/notification.service.ts`:**

Add THREE new methods + a small `formatDuration` helper. Keep escapeHtml usage consistent. The HTML format matches existing patterns (`<b>`, `<code>`).

```typescript
// Add near the bottom of the class, before the private escapeHtml() method:

/**
 * Notify owner that a meeting has been captured to the vault.
 * Format per HLD §3.8 B-MEET-5 + RESEARCH.md MEET-05:
 *   `Meeting captured: "<title>" (<duration>, <N> attendees) → <vault path>`
 * No interactive buttons — informational.
 */
async sendMeetingCaptured(input: {
  title: string;
  startedAt: Date;
  endedAt: Date;
  attendeeCount: number;
  vaultPath: string;
}): Promise<void> {
  const duration = NotificationService.formatDuration(input.startedAt, input.endedAt);
  const attendeesLabel = input.attendeeCount === 1 ? '1 attendee' : `${input.attendeeCount} attendees`;
  const text = [
    `<b>📝 Meeting captured</b>`,
    ``,
    `"${this.escapeHtml(input.title)}" (${duration}, ${attendeesLabel})`,
    `→ <code>${this.escapeHtml(input.vaultPath)}</code>`,
  ].join('\n');
  await this.bot.telegram.sendMessage(this.ownerChatId, text, { parse_mode: 'HTML' });
  this.logger.log(`Meeting captured notification sent: ${input.vaultPath}`);
}

/**
 * Notify owner that a cortex-local heartbeat is overdue.
 * Per HLD §3.8 B-MEET-7: includes hours-since-last-seen + (if available) the daemon's last reported error.
 */
async sendHeartbeatStale(input: {
  host: string;
  hoursAgo: number;
  lastError?: string | null;
}): Promise<void> {
  const lines = [
    `<b>⚠️ cortex-local silent</b>`,
    ``,
    `<code>${this.escapeHtml(input.host)}</code> hasn't checked in for <b>${input.hoursAgo}</b> hours.`,
    `Meetily may not be capturing meetings.`,
  ];
  if (input.lastError) {
    lines.push(``);
    lines.push(`Last reported error: <code>${this.escapeHtml(input.lastError.slice(0, 200))}</code>`);
  }
  await this.bot.telegram.sendMessage(this.ownerChatId, lines.join('\n'), { parse_mode: 'HTML' });
  this.logger.log(`Heartbeat-stale notification sent: host=${input.host} hoursAgo=${input.hoursAgo}`);
}

/**
 * MEET-06 server-side escalation channel. Fired by HeartbeatService.upsert when the daemon
 * reports a fresh `last_error` (transition from null/different value → new non-null value).
 * The daemon itself has NO Telegram bot token; it surfaces failures through this field
 * (RESEARCH.md MEET-06: "the daemon's only escalation channel is the `last_error` field on its heartbeat ping").
 *
 * Format (HTML, parse_mode: HTML):
 *   ⚠ <b>cortex-local upload failed</b>
 *
 *   Host: <code>{host}</code>
 *   Last error: <code>{escapeHtml(error)}</code>
 *
 *   Meeting capture is paused. Investigate the daemon log on the Mac mini.
 */
async sendUploadFailed(input: {
  host: string;
  error: string;
}): Promise<void> {
  const text = [
    `⚠ <b>cortex-local upload failed</b>`,
    ``,
    `Host: <code>${this.escapeHtml(input.host)}</code>`,
    `Last error: <code>${this.escapeHtml(input.error.slice(0, 500))}</code>`,
    ``,
    `Meeting capture is paused. Investigate the daemon log on the Mac mini.`,
  ].join('\n');
  await this.bot.telegram.sendMessage(this.ownerChatId, text, { parse_mode: 'HTML' });
  this.logger.log(`Upload-failed notification sent: host=${input.host} error="${input.error.slice(0, 80)}"`);
}

/** "47 min" if <60, "1h 12m" if ≥60. Public-static for unit testing. */
static formatDuration(startedAt: Date, endedAt: Date): string {
  const totalMinutes = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
```

**Create `src/scheduler/notification.service.spec.ts`:**

vitest. Mock `@InjectBot()` Telegraf instance with `{ telegram: { sendMessage: vi.fn() } }` and `ConfigService` with `getOrThrow('OWNER_CHAT_ID') -> '123456'`. Tests:

1. `sendMeetingCaptured`: calls `bot.telegram.sendMessage` once with `(123456, <text containing "📝 Meeting captured" and the HTML-escaped title and the vault path inside <code>...</code>), { parse_mode: 'HTML' })`; duration is "47 min" for 47-minute window.
2. `sendMeetingCaptured`: HTML-escapes the title (e.g. title `<b>Bad</b>` becomes `&lt;b&gt;Bad&lt;/b&gt;` in the sent text).
3. `sendMeetingCaptured`: 1 attendee renders "1 attendee"; 3 attendees renders "3 attendees".
4. `sendHeartbeatStale`: calls sendMessage with text containing the host (HTML-escaped) and the hoursAgo number; if `lastError` present, includes "Last reported error:" line; if `lastError` is null/undefined/empty, no error line is appended.
5. `sendUploadFailed`: calls sendMessage exactly once with `parse_mode: 'HTML'`; text contains `⚠ <b>cortex-local upload failed</b>`, the HTML-escaped host inside `<code>`, the HTML-escaped error inside `<code>`, and the trailing "Meeting capture is paused" line.
6. `sendUploadFailed`: long error strings (>500 chars) are truncated to 500 chars before HTML-escape.
7. `sendUploadFailed`: error containing HTML-injection like `<script>alert(1)</script>` is rendered as `&lt;script&gt;alert(1)&lt;/script&gt;` (escapeHtml correctness; defense-in-depth even though Telegram strips most HTML).
8. `formatDuration`: 47 min input → "47 min"; 60 min → "1h 0m"; 72 min → "1h 12m"; 1 min → "1 min"; 0 min (start==end) → "0 min"; negative duration (end before start) → "0 min" (Math.max).

**Create `src/meetings/meetings.controller.spec.ts`:**

Vitest tests with mocked MeetingsService.
1. Valid payload → controller returns whatever MeetingsService.ingest returns.
2. Invalid payload (missing title) → throws BadRequestException with `errors` field.
3. Invalid payload (transcript > 5MB) → throws BadRequestException.
4. Invalid payload (started_at not ISO 8601) → throws BadRequestException.

(The `@UseGuards(SharedSecretGuard)` is verified by guard-level tests above; controller tests focus on Zod validation + delegation.)

**Create `src/meetings/meetings.service.spec.ts`:**

Vitest tests with mocked PrismaService, VaultService, WorkspaceService, NotificationService.

1. Happy path: valid payload → `vault.writeFile` called once with `{ vaultPath: 'raw/meetings/2026-04-26-q2-roadmap-review.md', kind: 'meeting', sourceId: <generated UUID>, body: <verbatim>, commitMessage: 'meeting: q2-roadmap-review' }`; `prisma.meeting.create` called with workspaceId from `findByName('work')`; `notifications.sendMeetingCaptured` called once; returns `{ meeting_id, vault_path, commit_sha }`.
2. Workspace=Work always (MEET-08): even if input contains attendees that look "personal", workspace ID resolves via `findByName('work')` exclusively.
3. Body format (HLD §3.8 B-MEET-4): the body string passed to `vault.writeFile` contains exactly `Source: Meetily (Google Meet)\nDate: ...\nStarted: HH:MM\nEnded: HH:MM\nAttendees: ...\n\n---\n\n<transcript>`.
4. Slug correctness: title `"Q2 2026 Roadmap Review!"` → slug `"q2-2026-roadmap-review"` (slug lib lowercases + replaces spaces + strips punctuation); long titles capped at 80 chars; empty/all-punctuation title falls back to `"untitled-meeting"`.
5. Idempotency (RESEARCH.md Pitfall 8): if `prisma.meeting.findFirst` returns existing for `(source: 'meetily', externalId: '<id>')`, vault.writeFile is NEVER called and the existing record is returned.
6. Notification fire-and-forget (RESEARCH.md Pitfall 9): when `notifications.sendMeetingCaptured` rejects, `meetings.service.ingest` STILL resolves successfully and the Meeting row is still created.

**Wire into `src/app.module.ts`:**

Add `import { MeetingsModule } from './meetings/meetings.module';` and add `MeetingsModule` to the `imports: [...]` array.
  </action>
  <verify>
    <automated>npm test -- src/auth src/meetings src/scheduler/notification.service 2>&amp;1 | tail -30 &amp;&amp; npm run build 2>&amp;1 | tail -10 &amp;&amp; grep -q "MeetingsModule" src/app.module.ts</automated>
  </verify>
  <done>SharedSecretGuard tests pass (constructor validation; throws on missing/wrong/length-mismatch tokens; allows valid); MeetingsService tests pass (slug correctness, workspace=Work always, body format, idempotency on external_id, notification fire-and-forget); MeetingsController tests pass (Zod validation + delegation); NotificationService tests pass (sendMeetingCaptured + sendHeartbeatStale + sendUploadFailed HTML format + escape; formatDuration covers all branches); `npm run build` succeeds with zero type errors; AppModule imports MeetingsModule.</done>
</task>

<task type="auto">
  <name>Task 3: Build HeartbeatModule (controller, service basic upsert, types) + HeartbeatStalenessService daily cron + wire AppModule + verify VAULT-06 polymorphism</name>
  <files>src/heartbeat/heartbeat.module.ts, src/heartbeat/heartbeat.controller.ts, src/heartbeat/heartbeat.controller.spec.ts, src/heartbeat/heartbeat.service.ts, src/heartbeat/heartbeat.types.ts, src/heartbeat/heartbeat-staleness.service.ts, src/heartbeat/heartbeat-staleness.service.spec.ts, src/app.module.ts</files>
  <action>
**Note:** This task creates the basic HeartbeatService.upsert (lastSeenAt + optional fields). Task 4 EXTENDS that same upsert with the MEET-06 lastError change-detection + sendUploadFailed escalation. Keeping them split because escalation is a logically distinct concern (it crosses module boundaries: HeartbeatService → NotificationService) and warrants its own dedicated test surface. The two tasks share the heartbeat.service.ts file — Task 4 must run AFTER Task 3 (sequential within plan; both still wave 1).

**Create `src/heartbeat/heartbeat.types.ts`:**

```typescript
import { z } from 'zod';

export const HeartbeatPayloadSchema = z.object({
  host: z.string().min(1).max(100),                     // e.g. "mac-mini-home"
  version: z.string().min(1).max(50).optional(),
  last_ingest_at: z.string().datetime().nullable().optional(),
  queue_depth: z.number().int().min(0).max(10_000).optional(),
  last_error: z.string().max(2000).nullable().optional(),
});
export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

export const HeartbeatResponseSchema = z.object({
  ok: z.literal(true),
  last_seen_at: z.string().datetime(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;
```

**Create `src/heartbeat/heartbeat.service.ts`:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { HeartbeatPayload } from './heartbeat.types';

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert a heartbeat keyed by host. Always sets lastSeenAt = now().
   * Optional fields (version, lastIngestAt, queueDepth, lastError) overwrite if present.
   *
   * NOTE: Task 4 of this plan EXTENDS this method with MEET-06 lastError change-detection
   * + NotificationService.sendUploadFailed fire-and-forget. Do not duplicate that work here —
   * just implement the basic upsert so HeartbeatStalenessService and the controller wire up.
   */
  async upsert(p: HeartbeatPayload): Promise<{ host: string; lastSeenAt: Date }> {
    const now = new Date();
    const data = {
      host: p.host,
      version: p.version ?? null,
      lastSeenAt: now,
      lastIngestAt: p.last_ingest_at ? new Date(p.last_ingest_at) : null,
      queueDepth: p.queue_depth ?? null,
      lastError: p.last_error ?? null,
    };
    const row = await this.prisma.heartbeat.upsert({
      where: { host: p.host },
      create: data,
      update: data,
    });
    this.logger.log(`Heartbeat upserted host=${p.host} lastSeenAt=${now.toISOString()}`);
    return { host: row.host, lastSeenAt: row.lastSeenAt };
  }

  /** Find heartbeats whose lastSeenAt is older than `cutoff`. */
  async findStale(cutoff: Date) {
    return this.prisma.heartbeat.findMany({ where: { lastSeenAt: { lt: cutoff } } });
  }
}
```

**Create `src/heartbeat/heartbeat.controller.ts`:**

```typescript
import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { SharedSecretGuard } from '../auth/shared-secret.guard';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatPayloadSchema } from './heartbeat.types';

@Controller('api/heartbeat')
@UseGuards(SharedSecretGuard)
export class HeartbeatController {
  private readonly logger = new Logger(HeartbeatController.name);
  constructor(private readonly heartbeat: HeartbeatService) {}

  @Post()
  async ingest(@Body() body: unknown) {
    const parsed = HeartbeatPayloadSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn(`Invalid heartbeat payload: ${JSON.stringify(parsed.error.flatten())}`);
      throw new BadRequestException({ errors: parsed.error.flatten() });
    }
    const result = await this.heartbeat.upsert(parsed.data);
    return { ok: true as const, last_seen_at: result.lastSeenAt.toISOString() };
  }
}
```

**Create `src/heartbeat/heartbeat-staleness.service.ts`:**

Per RESEARCH.md Pattern 3. Daily pg-boss cron at `Settings.notificationHourUtc`. Uses the existing `SchedulerService.boss` instance.

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationService } from '../scheduler/notification.service';
import { HeartbeatService } from './heartbeat.service';

@Injectable()
export class HeartbeatStalenessService implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatStalenessService.name);
  static readonly QUEUE_NAME = 'heartbeat-staleness-check';
  static readonly STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000; // 26h per HLD §3.8 B-MEET-7

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly heartbeat: HeartbeatService,
  ) {}

  async onModuleInit(): Promise<void> {
    const settings = await this.settings.get();
    const hour = settings.notificationHourUtc;          // 0..23
    const cron = `0 ${hour} * * *`;                     // every day at H:00 UTC

    await this.scheduler.boss.createQueue(HeartbeatStalenessService.QUEUE_NAME);
    await this.scheduler.boss.work(HeartbeatStalenessService.QUEUE_NAME, async () => {
      await this.checkStale();
    });
    // schedule() is idempotent on (queueName) — safe to re-run.
    await this.scheduler.boss.schedule(HeartbeatStalenessService.QUEUE_NAME, cron);

    this.logger.log(`Heartbeat staleness check scheduled at cron "${cron}" (UTC)`);
  }

  /** Public for testability — invoked by the pg-boss worker callback. */
  async checkStale(): Promise<void> {
    const cutoff = new Date(Date.now() - HeartbeatStalenessService.STALE_THRESHOLD_MS);
    const stale = await this.heartbeat.findStale(cutoff);
    if (stale.length === 0) {
      this.logger.log('Heartbeat staleness check: all hosts healthy');
      return;
    }
    for (const hb of stale) {
      const hoursAgo = Math.floor((Date.now() - hb.lastSeenAt.getTime()) / 3_600_000);
      try {
        await this.notifications.sendHeartbeatStale({
          host: hb.host,
          hoursAgo,
          lastError: hb.lastError,
        });
      } catch (err) {
        this.logger.error(`Failed to notify stale heartbeat host=${hb.host}: ${String(err)}`);
      }
    }
  }
}
```

**Create `src/heartbeat/heartbeat.module.ts`:**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { SettingsModule } from '../settings/settings.module';
import { HeartbeatController } from './heartbeat.controller';
import { HeartbeatService } from './heartbeat.service';
import { HeartbeatStalenessService } from './heartbeat-staleness.service';
import { SharedSecretGuard } from '../auth/shared-secret.guard';

@Module({
  imports: [ConfigModule, PrismaModule, SchedulerModule, SettingsModule],
  controllers: [HeartbeatController],
  providers: [HeartbeatService, HeartbeatStalenessService, SharedSecretGuard],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
```

**Create `src/heartbeat/heartbeat.controller.spec.ts`:**

Mocked HeartbeatService.
1. Valid payload → returns `{ ok: true, last_seen_at: <iso> }`.
2. Missing `host` → BadRequestException.
3. `last_error` longer than 2000 chars → BadRequestException.

**Create `src/heartbeat/heartbeat-staleness.service.spec.ts`:**

Mocked SchedulerService (with `boss` having `createQueue`, `work`, `schedule` as `vi.fn`), SettingsService, NotificationService, HeartbeatService.

1. `onModuleInit`: reads `settings.get()` returning `{ notificationHourUtc: 14 }` → calls `boss.createQueue('heartbeat-staleness-check')` then `boss.work('heartbeat-staleness-check', ...)` then `boss.schedule('heartbeat-staleness-check', '0 14 * * *')`.
2. `checkStale`: when `heartbeat.findStale` returns `[]`, `notifications.sendHeartbeatStale` is NOT called.
3. `checkStale`: when `heartbeat.findStale` returns 1 row with `lastSeenAt = (now - 30h)`, `notifications.sendHeartbeatStale` is called once with `{ host, hoursAgo: 30, lastError }`.
4. `checkStale`: when `notifications.sendHeartbeatStale` throws for one host, the loop continues to the next (use 2 stale rows; reject first, ensure second is still notified).

**Wire into `src/app.module.ts`:**

Add `import { HeartbeatModule } from './heartbeat/heartbeat.module';` and append `HeartbeatModule` to `imports: [...]`. Order does not matter.

**VAULT-06 confirmation (no code change — verification step):**

Phase 7a's plan 07a-02 task 2 implemented `formatVaultRecent(rows)` and `handleVaultRecentCommand` querying `prisma.vaultWrite.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })`. The formatter prints `vaultPath` for each row regardless of `kind` (`note` vs `meeting`) — polymorphic by construction. VAULT-06 is observably satisfied as soon as a Meeting write inserts a VaultWrite row (which Phase 7a's VaultService already does in its try/finally for any kind, including `'meeting'`).

The MeetingsService spec in Task 2 already asserts `vault.writeFile` is called with `kind: 'meeting'` — that's the contract that makes VAULT-06 polymorphic. Document this explicitly in the SUMMARY: real end-to-end VAULT-06 verification happens in plan 07b-02's smoke test, which captures one meeting and runs `/vault recent` from the bot.
  </action>
  <verify>
    <automated>npm test -- src/heartbeat src/meetings 2>&amp;1 | tail -30 &amp;&amp; npm run build 2>&amp;1 | tail -10 &amp;&amp; grep -q "HeartbeatModule" src/app.module.ts</automated>
  </verify>
  <done>HeartbeatService basic upsert + findStale exist (Task 4 will extend upsert); HeartbeatController tests pass (Zod validation, success response shape); HeartbeatStalenessService tests pass (cron registration with notificationHourUtc; no-op on no-stale; notification per stale host; loop continues on per-host notification failure); `npm run build` succeeds; AppModule imports HeartbeatModule; VAULT-06 polymorphism contract documented (real verification deferred to 07b-02 smoke test).</done>
</task>

<task type="auto">
  <name>Task 4: MEET-06 server-side escalation — extend HeartbeatService.upsert with lastError change-detection + sendUploadFailed (+ heartbeat.service.spec.ts)</name>
  <files>src/heartbeat/heartbeat.service.ts, src/heartbeat/heartbeat.service.spec.ts, src/heartbeat/heartbeat.module.ts</files>
  <action>
**Why this task exists:** MEET-06 requires "On ingest failure, watcher retries with exponential backoff up to 1 hour, then notifies owner via Telegram." The daemon (plan 07b-02) has NO Telegram bot token of its own (RESEARCH.md anti-pattern: "the daemon should NOT have a Telegram bot token"). Its only escalation channel is the `last_error` field on its next heartbeat ping. Plan 07b-01 Task 3 stores that field but never reads it for fresh heartbeats — only for stale ones (>26h) via HeartbeatStalenessService. A daemon that successfully heartbeats daily but has terminal upload failures would silently store `lastError` in the DB and the user would NEVER be notified. This task closes that gap: on every heartbeat upsert, compare incoming `last_error` against the existing row's `lastError`. On a fresh transition (was null OR was a different string, now set to a non-null string), fire `NotificationService.sendUploadFailed` exactly once. Subsequent heartbeats with the same error string do NOT re-notify (de-dupe by exact string equality — daemon-side error messages should be deterministic for the same root cause).

**Edit `src/heartbeat/heartbeat.service.ts`:**

The Task-3 version of `upsert` does a single `prisma.heartbeat.upsert` call. Refactor to:
1. First, `findUnique({ where: { host } })` to read the EXISTING row's `lastError` (returns `null` if no row yet).
2. Then perform the upsert (same data shape as Task 3).
3. Compare `incoming.last_error` against `existing?.lastError ?? null`:
   - If `incoming.last_error` is non-null AND `incoming.last_error !== (existing?.lastError ?? null)` → fresh transition. Fire-and-forget `this.notifications.sendUploadFailed({ host: row.host, error: incoming.last_error })`.
   - Otherwise (incoming is null, OR incoming === existing.lastError, OR incoming is null while existing was set) → no notification.
4. Inject `NotificationService` via constructor (NEW dependency for HeartbeatService).
5. Update `HeartbeatModule.imports` to include `SchedulerModule` so NotificationService is resolvable. (HeartbeatStalenessService already imports SchedulerModule, but HeartbeatService now needs it too — confirm `HeartbeatModule` already declares `SchedulerModule` in imports per Task 3; if so this is a no-op, just verify.)

**Final shape of `src/heartbeat/heartbeat.service.ts`:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../scheduler/notification.service';
import type { HeartbeatPayload } from './heartbeat.types';

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Upsert a heartbeat keyed by host. Always sets lastSeenAt = now().
   * Optional fields (version, lastIngestAt, queueDepth, lastError) overwrite if present.
   *
   * MEET-06 server-side escalation: on every upsert, compare incoming last_error
   * against the previously persisted lastError. On a transition (null → string,
   * or string → different string), fire NotificationService.sendUploadFailed exactly
   * once — fire-and-forget; failure does NOT fail the upsert. De-duped by exact string
   * equality, so repeated heartbeats with the same persistent error do not spam the user.
   */
  async upsert(p: HeartbeatPayload): Promise<{ host: string; lastSeenAt: Date }> {
    // Step 1: Read existing row to capture the previous lastError BEFORE overwriting.
    const existing = await this.prisma.heartbeat.findUnique({ where: { host: p.host } });
    const previousError: string | null = existing?.lastError ?? null;

    const now = new Date();
    const data = {
      host: p.host,
      version: p.version ?? null,
      lastSeenAt: now,
      lastIngestAt: p.last_ingest_at ? new Date(p.last_ingest_at) : null,
      queueDepth: p.queue_depth ?? null,
      lastError: p.last_error ?? null,
    };

    // Step 2: Persist.
    const row = await this.prisma.heartbeat.upsert({
      where: { host: p.host },
      create: data,
      update: data,
    });
    this.logger.log(`Heartbeat upserted host=${p.host} lastSeenAt=${now.toISOString()}`);

    // Step 3: MEET-06 escalation. Fire ONLY when incoming is non-null AND different from previous.
    const incomingError: string | null = p.last_error ?? null;
    if (incomingError !== null && incomingError !== previousError) {
      this.logger.warn(
        `MEET-06 escalation: host=${p.host} lastError transitioned (previous=${previousError === null ? 'null' : '<set>'}, incoming="${incomingError.slice(0, 80)}")`,
      );
      // Fire-and-forget. Telegram failure must NOT fail the heartbeat upsert.
      this.notifications
        .sendUploadFailed({ host: row.host, error: incomingError })
        .catch((err) =>
          this.logger.error(
            `sendUploadFailed failed for host=${p.host}: ${String(err)} (heartbeat row still persisted)`,
          ),
        );
    }

    return { host: row.host, lastSeenAt: row.lastSeenAt };
  }

  /** Find heartbeats whose lastSeenAt is older than `cutoff`. */
  async findStale(cutoff: Date) {
    return this.prisma.heartbeat.findMany({ where: { lastSeenAt: { lt: cutoff } } });
  }
}
```

**Verify `src/heartbeat/heartbeat.module.ts`:**

Confirm `SchedulerModule` is already in `imports` (Task 3 added it for HeartbeatStalenessService). If so, no change needed — NotificationService is already exported by SchedulerModule and resolvable for HeartbeatService injection. If for any reason it isn't, add it. Confirm:

```bash
grep -A 5 "imports:" src/heartbeat/heartbeat.module.ts | grep SchedulerModule
```

(Expected: at least one match. SchedulerModule must export NotificationService — verify with `grep -A 3 "exports:" src/scheduler/scheduler.module.ts | grep NotificationService`. NotificationService is exported by SchedulerModule per the existing module structure used by ReminderService.)

**Create `src/heartbeat/heartbeat.service.spec.ts`:**

vitest. Mock PrismaService (`heartbeat.findUnique`, `heartbeat.upsert`, `heartbeat.findMany`) and NotificationService (`sendUploadFailed: vi.fn()`). Tests:

1. **Fresh insert with no error**: `findUnique` returns `null`; payload has `last_error: undefined` → upsert called, `sendUploadFailed` NOT called.
2. **Fresh insert WITH error** (null → string transition; this is the canonical MEET-06 case): `findUnique` returns `null`; payload has `last_error: "ENETUNREACH"` → upsert called, `sendUploadFailed` called EXACTLY once with `{ host: 'mac-mini-home', error: 'ENETUNREACH' }`.
3. **Repeated same error** (de-dupe): `findUnique` returns `{ lastError: 'ENETUNREACH', ... }`; payload has `last_error: 'ENETUNREACH'` → upsert called, `sendUploadFailed` NOT called.
4. **Changed error** (string → different string transition; daemon hits a new failure mode): `findUnique` returns `{ lastError: 'ENETUNREACH', ... }`; payload has `last_error: '413 payload too large'` → upsert called, `sendUploadFailed` called EXACTLY once with the NEW error string.
5. **Recovery** (string → null transition; daemon recovered, next ingest succeeded so it cleared its lastError): `findUnique` returns `{ lastError: 'ENETUNREACH', ... }`; payload has `last_error: null` → upsert called, `sendUploadFailed` NOT called. (We could fire a "recovered" message in a future iteration, but v1 only escalates failures, not recoveries.)
6. **lastError is undefined vs null vs ''** (Zod normalizes — payload type is `string | null | undefined`): payload omits `last_error` entirely → treated as null → no notification. Empty string `''` is non-null but falsy; for now treat empty string as a non-event by checking truthiness — adjust comparison to `incomingError !== null && incomingError !== '' && incomingError !== previousError`. Document this in the test as "empty string treated as no-error to avoid spurious notifications from misbehaving daemons that send empty strings instead of omitting the field."  *(Optional defensive hardening — apply only if executor judges it worth the extra branch; baseline passes all checker requirements without it.)*
7. **Notification rejection does not fail the upsert** (RESEARCH.md Pitfall 9 pattern): `sendUploadFailed` returns a rejected Promise; `heartbeat.service.upsert` STILL resolves successfully with the upserted row. Use `await` on the upsert result then assert it equals the expected `{ host, lastSeenAt }` shape. Use a microtask flush (`await Promise.resolve()`) to let the rejection settle, then assert `logger.error` was called.
8. **findStale shape**: calls `prisma.heartbeat.findMany({ where: { lastSeenAt: { lt: cutoff } } })`.

**Verification step (after writing the spec):**

Run only this spec to keep iteration fast:
```bash
npm test -- src/heartbeat/heartbeat.service.spec.ts
```

Then full module + build:
```bash
npm test -- src/heartbeat src/scheduler/notification.service 2>&1 | tail -30
npm run build 2>&1 | tail -10
```
  </action>
  <verify>
    <automated>npm test -- src/heartbeat/heartbeat.service.spec.ts 2>&amp;1 | tail -30 &amp;&amp; npm run build 2>&amp;1 | tail -10 &amp;&amp; grep -q "sendUploadFailed" src/heartbeat/heartbeat.service.ts &amp;&amp; grep -q "findUnique" src/heartbeat/heartbeat.service.ts</automated>
  </verify>
  <done>HeartbeatService.upsert reads existing row via findUnique BEFORE overwriting; on null→string OR string→different-string transition fires NotificationService.sendUploadFailed exactly once (fire-and-forget); on null→null, string→same-string, or string→null no notification; sendUploadFailed rejection does NOT fail the upsert; spec covers all 7 (or 8 with optional hardening) cases; npm run build passes; HeartbeatModule resolves NotificationService via the already-imported SchedulerModule.</done>
</task>

</tasks>

<verification>
- `npm test` passes for src/auth, src/meetings, src/heartbeat, src/scheduler/notification.service.
- `npm run build` produces zero TypeScript errors.
- `npx prisma format && npx prisma generate` succeeds; Meeting + Heartbeat types are exported from the generated client.
- One new migration file exists at `prisma/migrations/<ts>_add_meeting_and_heartbeat/migration.sql` with `CREATE TABLE "meetings"`, `CREATE TABLE "heartbeats"`, and `CREATE TYPE "meeting_source"`.
- `src/main.ts` has `app.use(json({ limit: '5mb' }))` BEFORE `bot.webhookCallback`.
- `.env.example` documents `CORTEX_LOCAL_SHARED_SECRET`.
- AppModule imports both MeetingsModule and HeartbeatModule.
- VaultService is NOT modified (plan re-uses it untouched per RESEARCH.md).
- MEET-06 server-side escalation chain is wired and tested: HeartbeatService.upsert detects lastError transitions and fires NotificationService.sendUploadFailed exactly once per fresh error (de-duped by string equality).
- `/vault recent` from Phase 7a is unchanged — VAULT-06 is observably satisfied via polymorphism (verified end-to-end in plan 07b-02 smoke test).
</verification>

<success_criteria>
- MEET-03 (shared-secret auth): SharedSecretGuard returns 401 on missing/wrong tokens via constant-time compare; tests prove all four failure modes ✅
- MEET-04 (vault write + Meeting row + correct header): MeetingsService.ingest calls VaultService.writeFile with kind='meeting' and the exact body format from HLD §3.8 B-MEET-4; persists Meeting row with all fields ✅
- MEET-05 (Telegram notification): `Meeting captured: "<title>" (<duration>, <N> attendees) → <vault path>` via NotificationService.sendMeetingCaptured; duration formatted "47 min" / "1h 12m" ✅
- MEET-06 (server side — escalate daemon's terminal-failure last_error to Telegram): HeartbeatService.upsert reads existing row's lastError, on null→string or string→different-string transition fires sendUploadFailed exactly once (fire-and-forget; de-dupe via string equality). Daemon-side retry/backoff is delivered in plan 07b-02 ✅
- MEET-07 (audio never crosses): IngestPayloadSchema accepts only text fields; no audio/binary path through any code path ✅
- MEET-08 (workspace = Work always): `findByName('work')`; tests assert this exclusively ✅
- MEET-09 (server side — receive heartbeat + alert if >26h): HeartbeatController.ingest upserts Heartbeat row; HeartbeatStalenessService runs daily at `Settings.notificationHourUtc` and notifies per stale host ✅
- VAULT-06 (`/vault recent` polymorphic): inherited unchanged from Phase 7a — VaultWrite kind=meeting rows surface through the existing handler. Observable end-to-end after plan 07b-02 captures the first real meeting ✅
- Body parser raised to 5 MB; 1h transcript will not 413 ✅
</success_criteria>

<output>
After completion, create `.planning/phases/07b-meeting-capture/07b-01-SUMMARY.md` summarizing:
- Schema diff: added Meeting + Heartbeat models, MeetingSource enum, Workspace.meetings back-relation
- New `src/auth/shared-secret.guard.ts` (CanActivate; constant-time via timingSafeEqual; throws UnauthorizedException — explicitly different from ChatIdGuard's silent drop, with rationale)
- New `src/meetings/` module: controller (`@UseGuards(SharedSecretGuard)`), service (slug via `slug` lib — no LLM; workspace locked Work; idempotency on external_id; fire-and-forget notification)
- New `src/heartbeat/` module: controller (upsert), service with MEET-06 lastError change-detection (Task 4), daily-staleness pg-boss cron registered at `Settings.notificationHourUtc`
- Extended `NotificationService` with sendMeetingCaptured + sendHeartbeatStale + sendUploadFailed + formatDuration helper
- MEET-06 escalation chain: HeartbeatService.upsert reads previous lastError, fires sendUploadFailed exactly once on fresh transition, de-duped by string equality. Daemon-side retry/backoff is delivered in plan 07b-02 — together they close MEET-06.
- Body parser raised to 5 MB in `src/main.ts`
- VAULT-06 status: inherited polymorphic from 7a — handler/formatter unchanged; verification deferred to plan 07b-02 smoke test
- Endpoints exposed for plan 07b-02 to consume: `POST /api/meetings/ingest`, `POST /api/heartbeat`
- Any deviations from RESEARCH.md and why
</output>
</content>
