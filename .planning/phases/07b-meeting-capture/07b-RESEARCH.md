# Phase 7b: Meeting Capture - Research

**Researched:** 2026-04-26
**Domain:** Standalone macOS launchd daemon (chokidar + retry + heartbeat) feeding a NestJS ingestion endpoint that reuses the Phase 7a VaultModule
**Confidence:** HIGH (server-side stack, NestJS guard pattern, daemon stack, launchd) / MEDIUM (Meetily output format — official docs are sparse; needs hands-on confirmation by the user once Meetily is installed) / HIGH (pg-boss schedule API for daily heartbeat-staleness job)

## Summary

Phase 7b is two distinct deliverables glued by a single HTTP contract. **Server-side (plan 07b-01)**: a `Meeting` Prisma model, a `Heartbeat` Prisma model, a `MeetingsController` exposing `POST /api/meetings/ingest` and `POST /api/heartbeat` (both behind a new `SharedSecretGuard`), and a `pg-boss` *cron-scheduled* daily job that DMs the owner if no heartbeat in >26h. The ingest handler does the same `Sonnet-free, verbatim-body` flow as notes — derive a kebab-case slug from the meeting title (pure transform via the `slug` library; **no LLM call** because the title is already concrete), build the Source/Date/Started/Ended/Attendees header, and call `vaultService.writeFile()` from Phase 7a. **Daemon-side (plan 07b-02)**: a brand-new TypeScript subproject at `cortex-local/` with its own package.json that watches Meetily's output, posts transcripts to cortex with bearer-token auth and exponential-backoff retry, persists pending uploads to a small JSON queue file (so crashes don't lose data), pings `/api/heartbeat` daily, and is supervised by a launchd user agent.

The most important up-front discovery is that **Meetily's primary storage is a SQLite database (`meeting_minutes.db`), not a directory of files** — official docs (Meetily README, architecture doc, DeepWiki) confirm this but are sparse on schema and macOS path. The existing third-party `meetily-exporter` CLI tool already writes per-meeting markdown files from that SQLite DB on a schedule (and supports a `watch` polling mode), and is the de-facto established adapter pattern. The cleanest architecture is therefore: (a) the user runs `meetily-exporter` on a schedule (or in `watch` mode) which produces markdown files in a directory, then (b) `cortex-local` watches *that* directory with chokidar, not Meetily's database directly. This decouples cortex-local from Meetily's internal schema, keeps cortex-local single-purpose, and matches the HLD's stated contract ("Meetily's configured output directory" + "transcript file (.md) + sidecar metadata (.json)"). However, since meetily-exporter doesn't produce JSON sidecars, the daemon will need to parse the YAML frontmatter that meetily-exporter does produce (it includes `meeting-id`, title, and timestamp). Confirm exact format with the user during plan execution. If the user decides to skip meetily-exporter and write a tiny custom SQLite-poller, the plan accommodates that variant.

The key technical risks are: (1) Meetily output format ambiguity — the planner should treat this as a configurable contract and have cortex-local accept both shapes (markdown with YAML frontmatter, plus optional JSON sidecar) so the user can plug in whatever they end up running; (2) bare `setTimeout`-based heartbeat in a launchd-supervised daemon will lose state on crash, so heartbeat state must be persisted to a small file alongside the queue file; (3) Phase 7a's VaultService already enforces `assertAllowedPath` for `raw/meetings/`, so no VaultService changes are needed.

**Primary recommendation:** Build cortex-local as a watcher over a directory (not over Meetily's SQLite DB), use native Node 20+ `fetch` for HTTP (no axios/undici dep), `chokidar 4.x` with `awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 }` for stable-write detection, `p-retry 6.x` for exponential backoff, `node-cron 3.x` for the daily heartbeat, atomic file-move into `_ingested/` as the dedupe marker (NOT a sidecar), persist pending-upload state in a JSON file at `~/Library/Application Support/cortex-local/queue.json`, install as a launchd User Agent at `~/Library/LaunchAgents/com.cortex.local.plist` via a small bash install script, store the shared secret in macOS Keychain via `security add-generic-password` and read via `security find-generic-password -w` in the install script (which then writes it to the same `cortex-local.config.json`). On the server side, build a minimal `SharedSecretGuard` (mirrors `ChatIdGuard`'s shape) reading `CORTEX_LOCAL_SHARED_SECRET` env, increase NestJS json body limit to 5 MB to accommodate long transcripts, schedule the heartbeat-staleness check via `pg-boss.schedule()` with cron `0 H * * *` where `H` is `Settings.notificationHourUtc`, and reuse the Phase 7a `VaultModule` + `NotificationService` + `WorkspaceService` directly with no modifications.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEET-01 | `cortex-local` daemon runs on Mac mini under launchd watching Meetily's output directory | New `cortex-local/` subproject in cortex repo; `chokidar 4.x` watcher on `~/Library/Application Support/Meetily/exports/` (or wherever meetily-exporter writes); `launchd` User Agent plist at `~/Library/LaunchAgents/com.cortex.local.plist` with `RunAtLoad=true` + `KeepAlive=true`; install script handles `launchctl load -w` |
| MEET-02 | Watcher waits for stable file (5s) and POSTs to cortex API | `chokidar.watch(dir, { awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 }, ignored: '**/_ingested/**' })`; on `add` event, parse markdown frontmatter, build payload, native `fetch()` POST |
| MEET-03 | Cortex authenticates watcher via shared-secret Bearer token on `/api/meetings/ingest` | New `SharedSecretGuard` injectable mirroring `ChatIdGuard` shape — reads `CORTEX_LOCAL_SHARED_SECRET` from ConfigService, compares against `Authorization: Bearer <secret>` header in constant time (use `node:crypto.timingSafeEqual`); attached to `MeetingsController` via `@UseGuards(SharedSecretGuard)`; returns 401 on missing/invalid (NOT silent drop — the daemon needs to know to alert the user) |
| MEET-04 | Cortex persists Meeting row and writes transcript verbatim to `raw/meetings/YYYY-MM-DD-{title-slug}.md` | New `Meeting` Prisma model (already declared in HLD §7); new `MeetingsService.ingest()` calls `slugifyMeetingTitle(title)` (pure transform), builds vault path + body, calls `vaultService.writeFile({ vaultPath, body, commitMessage: \`meeting: ${slug}\`, kind: 'meeting', sourceId: meeting.id })`; same VaultService from Phase 7a — no changes needed; `assertAllowedPath` already permits `raw/meetings/` |
| MEET-05 | Bot DMs owner with title, duration, attendee count, vault path | `NotificationService.sendMeetingCaptured()` new method; format duration via small helper (`formatDuration(startedAt, endedAt)` → "47 min" or "1h 12m"); reuses `@InjectBot()` pattern from Phase 4 |
| MEET-06 | On ingest failure, watcher retries with exponential backoff up to 1h, then notifies via Telegram | `p-retry 6.x` (current major) with `retries: 5, factor: 2, minTimeout: 60_000, maxTimeout: 1_800_000` (1m → 5m → 15m → 30m → 30m caps at 1h total ≈ 6 attempts); pending uploads persisted to `~/Library/Application Support/cortex-local/queue.json` so crashes don't lose them; on terminal failure, daemon POSTs a special `/api/heartbeat` error event OR (simpler) calls a Telegram bot API URL directly using a fallback Telegram bot token also stored as a daemon-side secret. Recommendation: use the existing cortex `/api/heartbeat` endpoint and surface the error in `last_error` field — cortex's heartbeat-staleness scheduler then DMs based on that field. This avoids giving the daemon a Telegram bot token. |
| MEET-07 | Audio never leaves the Mac (Meetily transcribes locally; cortex receives only text) | Architectural — guaranteed by NOT making cortex-local read or transmit audio. Document in cortex-local's README and as a smoke-test verification step. Add a defensive check: if a payload field looks like base64 audio (length > 1MB, suspicious entropy), reject before sending. Belt-and-suspenders. |
| MEET-08 | All Meeting rows default to Work workspace (no attendee-domain heuristic in v1) | `MeetingsService.ingest()` calls `workspaceService.findByName('work')` and uses that ID. Hard-coded — no logic, no config flag. Locked decision. |
| MEET-09 | `cortex-local` sends daily heartbeat (`POST /api/heartbeat`); cortex DMs owner if last heartbeat is >26h | New `Heartbeat` Prisma model (single row per host, upserted on each ping); new `HeartbeatController` with `POST /api/heartbeat` behind `SharedSecretGuard`; new `HeartbeatStalenessService` registered as `pg-boss.schedule()` daily cron at the user's `notificationHourUtc` (existing `Settings` model from Phase 4) — checks `Heartbeat` rows older than 26h and DMs via `NotificationService.sendHeartbeatStale()`. On daemon side, `node-cron 3.x` schedules the daily ping at boot, persists `lastHeartbeatAt` to disk so launchd-restart doesn't reset the schedule. |
| VAULT-06 | User can run `/vault recent` on Telegram to list the last 10 vault writes with status | Phase 7a Plan 02 ALREADY built `handleVaultRecentCommand` and `formatVaultRecent` (visible in `07a-02-PLAN.md` task 2). The implementation queries `prisma.vaultWrite.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })` — already polymorphic over note/meeting kinds because it queries VaultWrite directly and the formatter already prints `vaultPath` (which encodes kind via `raw/inbox/` vs `raw/meetings/`). VAULT-06 is **observably satisfied** the moment the first meeting writes a VaultWrite row — no code changes needed in 7b. Verify via smoke test only. |
</phase_requirements>

## Standard Stack

### Core (Server-side, plan 07b-01)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `slug` | already installed (Phase 7a) | Pure deterministic kebab-case from meeting title (NO LLM) | Title is already a concrete string; no LLM intelligence needed. `slug` handles unicode, diacritics, length capping. Same library as 7a's slug normalization. |
| `pg-boss` | already installed (^12.13.0) | Daily cron job for heartbeat-staleness check | `pg-boss.schedule(name, cron, data?, options?)` — first-class cron support. Already used in Phase 4 for deadline reminders. |
| `@nestjs/common` | already installed (^11) | `SharedSecretGuard` via `CanActivate` interface | Existing guard pattern (`ChatIdGuard`) — copy shape exactly. |
| `zod` | already installed (^4.3.6) | Validate `/api/meetings/ingest` and `/api/heartbeat` payloads | Same Zod patterns used everywhere in cortex (LLM result schemas, etc.). |
| `node:crypto` | Node 20+ built-in | `timingSafeEqual()` for constant-time secret comparison in `SharedSecretGuard` | Built-in; protects against timing-attack secret enumeration. Trivial. |

### Core (Daemon-side, plan 07b-02 — new `cortex-local/` subproject)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `chokidar` | ^4.0.3 | File watching with `awaitWriteFinish` stable-write detection | THE standard Node file watcher; 50M+ weekly downloads; v4 (Nov 2025) is ESM-only and requires Node ≥ 20 |
| `p-retry` | ^6.2.0 | Exponential backoff for failed ingest POSTs | Sindre Sorhus's promise retry lib; well-maintained (last release March 2026); supports `factor`, `minTimeout`, `maxTimeout`, `onFailedAttempt` for logging |
| `node-cron` | ^3.0.3 | Daily heartbeat schedule | Framework-agnostic cron; correct choice for non-NestJS standalone Node apps (`@nestjs/schedule` requires the NestJS DI container) |
| `gray-matter` | ^4.0.3 | Parse YAML frontmatter from meetily-exporter markdown files | Standard YAML-frontmatter parser; reads `meeting-id`, title, timestamps from the meetily-exporter output format |
| `zod` | ^4.x | Validate the daemon's config file + parsed frontmatter shape | Match server side; bonus: shared types if we ever want a shared package |
| `dotenv` | ^16 | Load `.env` config (alternative: JSON config file — see Architecture Patterns) | Standard. Optional — could go pure-JSON-config-file route. |

**Native fetch** (Node 20+ built-in): Use this instead of axios/undici/node-fetch. Node 20+ ships fetch as stable, backed by undici internally. Zero deps. Set per-request `AbortSignal.timeout(30_000)` for the 30s hard timeout on ingest POSTs.

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nestjs-telegraf` | already installed | `NotificationService.sendMeetingCaptured` reuses `@InjectBot()` | Reuse pattern from Phase 4's `NotificationService` |
| `@prisma/client` | already installed | Persist `Meeting` and `Heartbeat` rows | Add two models to schema.prisma |

### Alternatives Considered (Daemon)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `chokidar` | `node:fs.watch` (built-in) | `fs.watch` is OS-event-driven and unreliable on macOS for atomic-replace patterns (editors, exporters); also no `awaitWriteFinish` equivalent. chokidar wraps it correctly. |
| `chokidar` | Polling Meetily's SQLite DB directly | Tighter coupling to Meetily's schema (which can change); requires SQLite Node binding (`better-sqlite3`); means cortex-local has to dedupe via meeting-id state-of-the-world rather than file-presence. **Worse.** Stick with file watcher over meetily-exporter's output. |
| `p-retry` | `async-retry` (Vercel) | async-retry hasn't released in 5+ years; p-retry is actively maintained (last release March 2026). p-retry has identical ergonomics. |
| `p-retry` | Hand-rolled `setTimeout` loop | Loses jitter, AbortSignal support, type-safe error handling. 4kb dep — not worth hand-rolling. |
| `node-cron` | Plain `setInterval(24h)` | setInterval doesn't survive crashes (relative to wall clock); doesn't drift back to scheduled time after restart. node-cron's cron-expression scheduling is correct for "ping at 9am every day regardless of when daemon last started". |
| `node-cron` | `@nestjs/schedule` | NestJS-specific. cortex-local is intentionally NOT a NestJS app (it's a 200-line single-purpose daemon). |
| `gray-matter` | Manual YAML parse with `js-yaml` | gray-matter wraps js-yaml, handles frontmatter delimiter detection, returns clean `data` + `content`. Battle-tested in markdown ecosystems (Hexo, Gatsby, etc.). |
| `node-fetch` | Native `fetch` | node-fetch is now ESM-only and adds a dep. Native fetch is Node 20+. Use native. |
| `axios` | Native `fetch` | Heavy dep, interceptor sprawl, redundant given native fetch. Avoid for a single-purpose daemon. |
| Config via `dotenv` | JSON config file at `~/Library/Application Support/cortex-local/config.json` | JSON config is more discoverable for the user, easier to edit, and validates with Zod cleanly. Recommend JSON. `.env` only if the user wants 12-factor parity. |
| macOS Keychain for secret | Plain `chmod 600` config file | Keychain via `security` CLI is more secure; install script reads on first launch and writes to config file (or to a memfd-style runtime-only env). Recommend: store in Keychain, install script copies to a `chmod 600` runtime file at install time, daemon reads from runtime file (avoids `security` invocation per request). |
| `dotenv` (in daemon) | Built-in `process.env` reading | `dotenv` is overkill if config lives in JSON; remove if config-file route chosen. |

### Alternatives Considered (Daemon — Meetily input source)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Watch `meetily-exporter` output dir | Read Meetily SQLite directly via `better-sqlite3` | Tighter coupling to Meetily's internal schema (which their docs confirm exists but don't fully publish); requires schema-discovery + change-detection logic; harder to test. The exporter-as-adapter pattern is cleaner. |
| Watch `meetily-exporter` output dir | Wait for upstream Meetily to add a webhook | Indefinite — Meetily doesn't expose webhooks today. Don't block on it. |
| Watch `meetily-exporter` output dir | Build a custom Meetily-DB-poller in cortex-local | Replicates `meetily-exporter`'s job. Don't reinvent. |

**Installation (server side, plan 07b-01):**
```bash
# All deps already installed in Phase 7a (slug, pg-boss, zod, etc.)
# No npm install needed — server side reuses existing deps.
```

**Installation (daemon side, plan 07b-02 — runs in `cortex-local/` subproject):**
```bash
cd cortex-local
npm init -y
npm install chokidar@^4.0.3 p-retry@^6.2.0 node-cron@^3.0.3 gray-matter@^4.0.3 zod@^4
npm install --save-dev typescript @types/node@^20 @types/node-cron tsx vitest
```

## Architecture Patterns

### Recommended Project Structure

**Server side additions:**
```
src/
├── meetings/                       # NEW — Meeting domain + ingest controller
│   ├── meetings.module.ts
│   ├── meetings.controller.ts      # @UseGuards(SharedSecretGuard) on POST /api/meetings/ingest
│   ├── meetings.service.ts         # ingest() — slug → vault.writeFile → DB row → NotificationService
│   ├── meetings.types.ts           # Zod schemas: IngestPayloadSchema, IngestResponseSchema
│   ├── meetings.controller.spec.ts
│   └── meetings.service.spec.ts
├── heartbeat/                      # NEW — heartbeat ingest + staleness scheduler
│   ├── heartbeat.module.ts
│   ├── heartbeat.controller.ts     # @UseGuards(SharedSecretGuard) on POST /api/heartbeat
│   ├── heartbeat.service.ts        # upsertHeartbeat() + getStaleHosts()
│   ├── heartbeat-staleness.service.ts  # OnModuleInit registers pg-boss daily cron
│   └── heartbeat.service.spec.ts
├── auth/                           # NEW (or co-located with meetings) — shared guard
│   ├── shared-secret.guard.ts      # CanActivate; reads CORTEX_LOCAL_SHARED_SECRET; timingSafeEqual
│   └── shared-secret.guard.spec.ts
├── scheduler/
│   └── notification.service.ts     # MODIFIED — add sendMeetingCaptured() + sendHeartbeatStale()
└── app.module.ts                   # MODIFIED — register MeetingsModule, HeartbeatModule

prisma/
└── schema.prisma                   # MODIFIED — add Meeting + Heartbeat models, MeetingSource enum

src/main.ts                          # MODIFIED — increase JSON body limit to 5MB for transcripts
```

**Daemon side (NEW subproject):**
```
cortex-local/
├── package.json                    # standalone npm package, type: "module"
├── tsconfig.json                   # ESM + Node20 target
├── README.md
├── src/
│   ├── index.ts                    # Entry point — load config, start watcher + heartbeat
│   ├── config.ts                   # Load + Zod-validate config from JSON file
│   ├── watcher.ts                  # chokidar setup + frontmatter parsing
│   ├── client.ts                   # native fetch + Bearer + p-retry
│   ├── queue.ts                    # JSON-file-backed pending-upload queue (survives crashes)
│   ├── heartbeat.ts                # node-cron daily ping + last-heartbeat persistence
│   ├── ingest-marker.ts            # mv {file} {dir}/_ingested/{file} atomically
│   └── types.ts                    # Shared types — payload shape, config shape (mirrors server Zod)
├── tests/
│   └── *.test.ts
├── scripts/
│   ├── install.sh                  # bash install script — see Pattern 5
│   └── com.cortex.local.plist.tmpl # launchd plist template
└── tsup.config.ts (or esbuild)     # bundle to single .js for distribution
```

### Pattern 1: SharedSecretGuard (server side)

**What:** A NestJS `CanActivate` guard that validates `Authorization: Bearer <secret>` against a server-side env var using constant-time comparison.
**When to use:** Apply via `@UseGuards(SharedSecretGuard)` on `MeetingsController` and `HeartbeatController`. Mirrors `ChatIdGuard`'s shape exactly.

**Example:**
```typescript
// src/auth/shared-secret.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class SharedSecretGuard implements CanActivate {
  private readonly expectedSecret: Buffer;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.getOrThrow<string>('CORTEX_LOCAL_SHARED_SECRET');
    if (secret.length < 32) {
      throw new Error('CORTEX_LOCAL_SHARED_SECRET must be ≥32 chars');
    }
    this.expectedSecret = Buffer.from(secret, 'utf8');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m) throw new UnauthorizedException('Missing bearer token');
    const provided = Buffer.from(m[1], 'utf8');
    if (provided.length !== this.expectedSecret.length) {
      throw new UnauthorizedException('Invalid token');
    }
    if (!timingSafeEqual(provided, this.expectedSecret)) {
      throw new UnauthorizedException('Invalid token');
    }
    return true;
  }
}
```

**Why 401 not silent drop (per HLD §10 risk row "Deploy key compromise"):** The HLD lists deploy-key/secret compromise as a known risk. A failed-auth log line + 401 is more useful for debugging than silent rejection. The daemon's retry logic surfaces 401 immediately as a terminal failure (no point retrying), and the daemon's stuck-pending-upload state would eventually surface via the heartbeat staleness signal. NOT silent drop. (`ChatIdGuard`'s silent-drop is correct because random Telegram users may message the bot — there's no analogous "noise" on `/api/meetings/ingest`.)

### Pattern 2: MeetingsController + Service (server side)

**What:** A standard NestJS controller that delegates to a service. The service does slug → vault.writeFile → DB persist → notify. **No LLM call** (meeting title is already concrete).
**When to use:** This IS the implementation of MEET-04, MEET-05, MEET-08.

**Example:**
```typescript
// src/meetings/meetings.types.ts
import { z } from 'zod';

export const IngestPayloadSchema = z.object({
  title: z.string().min(1).max(500),
  started_at: z.string().datetime(),  // ISO 8601
  ended_at: z.string().datetime(),
  attendees: z.array(z.string()).max(50),  // names or emails — verbatim from Meetily
  transcript: z.string().min(1).max(5_000_000),  // 5MB hard cap (≈ 1.5M words)
  source: z.literal('meetily'),
  // Optional: meetily-exporter's meeting-id for idempotency
  external_id: z.string().optional(),
});
export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

export const IngestResponseSchema = z.object({
  meeting_id: z.string(),
  vault_path: z.string(),
  commit_sha: z.string(),
});
```

```typescript
// src/meetings/meetings.controller.ts
import { Body, Controller, Post, UseGuards, Logger, BadRequestException } from '@nestjs/common';
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
      this.logger.warn(`Invalid ingest payload: ${parsed.error.message}`);
      throw new BadRequestException({ errors: parsed.error.flatten() });
    }
    return this.meetings.ingest(parsed.data);
  }
}
```

```typescript
// src/meetings/meetings.service.ts (skeleton)
import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VaultService } from '../vault/vault.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { NotificationService } from '../scheduler/notification.service';
import slugify from 'slug';
import type { IngestPayload } from './meetings.types';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly workspace: WorkspaceService,
    private readonly notifications: NotificationService,
  ) {}

  async ingest(p: IngestPayload) {
    // Idempotency (optional but recommended): skip if external_id already ingested.
    if (p.external_id) {
      const existing = await this.prisma.meeting.findFirst({
        where: { externalId: p.external_id },
      });
      if (existing) {
        this.logger.log(`Duplicate ingest for external_id=${p.external_id}; returning existing`);
        return {
          meeting_id: existing.id,
          vault_path: existing.vaultPath,
          commit_sha: existing.vaultCommitSha,
        };
      }
    }

    // Workspace assignment — locked to Work per MEET-08.
    const workspace = await this.workspace.findByName('work');
    if (!workspace) throw new Error('Work workspace not found — seed missing');

    // Slug from title — pure transform, no LLM.
    const slug = slugify(p.title, { lower: true }).slice(0, 80) || 'untitled-meeting';

    // Date prefix: use started_at in user's timezone (configurable, defaults to UTC).
    // For v1, simplify to UTC to match note flow. Revisit if timezone semantics matter later.
    const dateStr = new Date(p.started_at).toISOString().slice(0, 10);
    const vaultPath = `raw/meetings/${dateStr}-${slug}.md`;

    // Build verbatim body per HLD §3.8 B-MEET-4.
    const startedFmt = new Date(p.started_at).toISOString().slice(11, 16);
    const endedFmt = new Date(p.ended_at).toISOString().slice(11, 16);
    const body = [
      `Source: Meetily (Google Meet)`,
      `Date: ${dateStr}`,
      `Started: ${startedFmt}`,
      `Ended: ${endedFmt}`,
      `Attendees: ${p.attendees.join(', ') || '(unknown)'}`,
      ``,
      `---`,
      ``,
      p.transcript,
    ].join('\n');

    const meetingId = randomUUID();

    // VaultService.writeFile already audit-logs in try/finally (Phase 7a).
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
        startedAt: new Date(p.started_at),
        endedAt: new Date(p.ended_at),
        attendeeEmails: p.attendees,
        transcript: p.transcript,
        source: 'meetily',
        externalId: p.external_id ?? null,
        vaultPath: writeResult.vaultPath,
        vaultCommitSha: writeResult.commitSha,
      },
    });

    // Telegram notification — async, fire and forget on failure.
    this.notifications
      .sendMeetingCaptured({
        title: p.title,
        startedAt: new Date(p.started_at),
        endedAt: new Date(p.ended_at),
        attendeeCount: p.attendees.length,
        vaultPath: writeResult.vaultPath,
      })
      .catch((err) => this.logger.warn(`Meeting notification failed: ${err}`));

    return {
      meeting_id: meeting.id,
      vault_path: writeResult.vaultPath,
      commit_sha: writeResult.commitSha,
    };
  }
}
```

### Pattern 3: Heartbeat-Staleness pg-boss Cron (server side)

**What:** A daily pg-boss-scheduled job that runs at the user's configured notification hour and DMs the owner if the latest heartbeat from any host is older than 26 hours.
**When to use:** Implementation of MEET-09's server side. Reuses Phase 4's `Settings.notificationHourUtc` for the cron hour.

**Example:**
```typescript
// src/heartbeat/heartbeat-staleness.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationService } from '../scheduler/notification.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HeartbeatStalenessService implements OnModuleInit {
  private readonly logger = new Logger(HeartbeatStalenessService.name);
  private static readonly QUEUE_NAME = 'heartbeat-staleness-check';
  private static readonly STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000; // 26h

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const settings = await this.settings.get();
    const hour = settings.notificationHourUtc; // 0..23
    const cron = `0 ${hour} * * *`; // every day at H:00 UTC

    // Register the queue + worker
    await this.scheduler.boss.createQueue(HeartbeatStalenessService.QUEUE_NAME);
    await this.scheduler.boss.work(HeartbeatStalenessService.QUEUE_NAME, async () => {
      await this.checkStale();
    });

    // Schedule daily — pg-boss .schedule(name, cronExpression, data?, options?)
    await this.scheduler.boss.schedule(HeartbeatStalenessService.QUEUE_NAME, cron);
    this.logger.log(`Heartbeat staleness check scheduled at cron "${cron}"`);
  }

  private async checkStale() {
    const cutoff = new Date(Date.now() - HeartbeatStalenessService.STALE_THRESHOLD_MS);
    const stale = await this.prisma.heartbeat.findMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
    for (const hb of stale) {
      const hoursAgo = Math.floor((Date.now() - hb.lastSeenAt.getTime()) / 3_600_000);
      await this.notifications.sendHeartbeatStale({
        host: hb.host,
        hoursAgo,
        lastError: hb.lastError,
      });
    }
  }
}
```

**pg-boss schedule API confirmation:** `boss.schedule(queueName, cronExpression, data?, options?)` — registers a recurring job. `boss.unschedule(queueName)` removes it. Cancel-and-recreate on settings change is the simplest way to handle the user updating `notificationHourUtc` (out of scope for this phase — accept the requirement that the user restarts the app after changing the setting). Source: pg-boss README on GitHub (timgit/pg-boss); confirmed used in this project's Phase 4 reminder service.

### Pattern 4: cortex-local Daemon Skeleton

**What:** Standalone Node 20+ ESM TypeScript daemon, single-purpose: watch directory → POST → mark ingested → repeat. Plus a parallel cron for daily heartbeat.

**Example (entry point):**
```typescript
// cortex-local/src/index.ts
import { loadConfig } from './config.js';
import { startWatcher } from './watcher.js';
import { startHeartbeat } from './heartbeat.js';

async function main() {
  const config = await loadConfig();
  console.log(`[cortex-local] starting; watching ${config.meetilyOutputDir}`);
  await startWatcher(config);
  startHeartbeat(config);
  // Process stays alive via chokidar watcher and node-cron timers
}
main().catch((err) => {
  console.error('[cortex-local] FATAL:', err);
  process.exit(1);
});
```

**Watcher with awaitWriteFinish:**
```typescript
// cortex-local/src/watcher.ts
import chokidar from 'chokidar';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import matter from 'gray-matter';
import type { Config } from './config.js';
import { uploadWithRetry } from './client.js';
import { markIngested } from './ingest-marker.js';
import { enqueue, drain } from './queue.js';

export async function startWatcher(config: Config) {
  // Drain the persisted queue first (recovery from crashes/restarts)
  await drain(config);

  const watcher = chokidar.watch(config.meetilyOutputDir, {
    ignored: (p) => p.includes('/_ingested/') || p.startsWith('.'),
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 5000, // 5s stable = file complete (per HLD §3.8 B-MEET-2)
      pollInterval: 200,
    },
    ignoreInitial: false, // process pre-existing files on startup
  });

  watcher.on('add', async (filePath) => {
    if (!filePath.endsWith('.md')) return;
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const { data, content } = matter(raw);
      const payload = {
        title: String(data.title ?? path.basename(filePath, '.md')),
        started_at: new Date(data.started_at ?? data.date ?? Date.now()).toISOString(),
        ended_at: new Date(data.ended_at ?? Date.now()).toISOString(),
        attendees: Array.isArray(data.attendees) ? data.attendees : [],
        transcript: content.trim(),
        source: 'meetily' as const,
        external_id: data['meeting-id'] ?? data.meeting_id ?? undefined,
      };
      await enqueue(config, { filePath, payload });
      await uploadWithRetry(config, payload);
      await markIngested(filePath);
    } catch (err) {
      console.error(`[watcher] error processing ${filePath}:`, err);
      // err already escalated via uploadWithRetry's terminal-failure heartbeat update
    }
  });

  watcher.on('error', (err) => {
    console.error('[chokidar]', err);
  });
}
```

**Anti-pattern to avoid:** `awaitWriteFinish: true` (no options object) — uses defaults that may not match Meetily's write cadence. Always specify `stabilityThreshold` explicitly.

### Pattern 5: launchd User Agent + Install Script

**What:** A user-scoped launchd agent (`~/Library/LaunchAgents/com.cortex.local.plist`) that runs cortex-local at login and restarts it on crash.
**When to use:** Implementation of MEET-01.

**Plist template (`scripts/com.cortex.local.plist.tmpl`):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cortex.local</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>__INSTALL_DIR__/dist/index.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>__INSTALL_DIR__</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>CORTEX_LOCAL_CONFIG</key>
    <string>__CONFIG_PATH__</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <!-- Throttle restart frequency to avoid crash loops eating CPU -->
  <key>ThrottleInterval</key>
  <integer>30</integer>

  <key>StandardOutPath</key>
  <string>__HOME__/Library/Logs/cortex-local.out.log</string>

  <key>StandardErrorPath</key>
  <string>__HOME__/Library/Logs/cortex-local.err.log</string>
</dict>
</plist>
```

**Install script (`scripts/install.sh`):**
```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$HOME/.cortex-local"
CONFIG_DIR="$HOME/Library/Application Support/cortex-local"
PLIST_DST="$HOME/Library/LaunchAgents/com.cortex.local.plist"
LOG_DIR="$HOME/Library/Logs"
NODE_BIN="$(which node)"

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR"

# Copy bundled daemon
cp -r ./dist "$INSTALL_DIR/"
cp -r ./node_modules "$INSTALL_DIR/"

# Prompt for config (or read from existing)
CONFIG_FILE="$CONFIG_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  read -p "Cortex API URL (e.g. https://cortex-hindole.fly.dev): " API_URL
  read -p "Meetily output directory (e.g. ~/Documents/Meetily/exports): " MEETILY_DIR
  read -p "Hostname label (e.g. mac-mini-home): " HOST

  # Read shared secret from macOS Keychain (or prompt + store)
  if ! security find-generic-password -s 'cortex-local' -a 'shared-secret' -w 2>/dev/null; then
    read -s -p "Cortex shared secret: " SECRET
    echo
    security add-generic-password -s 'cortex-local' -a 'shared-secret' -w "$SECRET"
    echo "Stored in Keychain."
  fi
  SECRET="$(security find-generic-password -s 'cortex-local' -a 'shared-secret' -w)"

  cat > "$CONFIG_FILE" <<EOF
{
  "cortexApiUrl": "$API_URL",
  "sharedSecret": "$SECRET",
  "meetilyOutputDir": "$MEETILY_DIR",
  "host": "$HOST",
  "stateDir": "$CONFIG_DIR/state"
}
EOF
  chmod 600 "$CONFIG_FILE"
fi

# Render plist with absolute paths
sed -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    -e "s|__CONFIG_PATH__|$CONFIG_FILE|g" \
    -e "s|__HOME__|$HOME|g" \
    scripts/com.cortex.local.plist.tmpl > "$PLIST_DST"

# Load (or reload) the agent
launchctl unload -w "$PLIST_DST" 2>/dev/null || true
launchctl load -w "$PLIST_DST"

echo "✅ cortex-local installed and running."
echo "   Logs: $LOG_DIR/cortex-local.{out,err}.log"
echo "   Config: $CONFIG_FILE"
echo "   Status: launchctl list | grep com.cortex.local"
```

**Why config-file + chmod 600 over reading from Keychain on every boot:** Keychain unlock prompts can interrupt unattended runs after macOS updates. Read once at install time, write to `chmod 600` config, daemon reads from disk. Keychain is the *source of truth* and used to recover the secret if the config is lost.

### Pattern 6: Persisted Pending-Upload Queue (daemon)

**What:** A simple JSON file at `~/Library/Application Support/cortex-local/state/queue.json` that tracks files in-flight or awaiting retry. On boot, drain this file before starting fresh chokidar events.
**When to use:** Required to avoid losing meetings if the daemon crashes mid-upload (MEET-06's "exponential backoff up to 1h" implies persistence across the retry window).

**Example:**
```typescript
// cortex-local/src/queue.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface QueuedItem {
  filePath: string;
  payload: unknown;
  enqueuedAt: string;
  attempts: number;
}

async function readQueue(stateDir: string): Promise<QueuedItem[]> {
  try {
    const raw = await fs.readFile(path.join(stateDir, 'queue.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeQueue(stateDir: string, items: QueuedItem[]) {
  await fs.mkdir(stateDir, { recursive: true });
  // Atomic write: write to .tmp, rename
  const target = path.join(stateDir, 'queue.json');
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2));
  await fs.rename(tmp, target);
}

export async function enqueue(config: { stateDir: string }, item: Omit<QueuedItem, 'enqueuedAt' | 'attempts'>) {
  const items = await readQueue(config.stateDir);
  items.push({ ...item, enqueuedAt: new Date().toISOString(), attempts: 0 });
  await writeQueue(config.stateDir, items);
}

export async function dequeue(config: { stateDir: string }, filePath: string) {
  const items = await readQueue(config.stateDir);
  await writeQueue(config.stateDir, items.filter((i) => i.filePath !== filePath));
}

/** On daemon boot, retry everything still in the queue. */
export async function drain(config: { stateDir: string }, retry: (item: QueuedItem) => Promise<void>) {
  const items = await readQueue(config.stateDir);
  for (const item of items) {
    try {
      await retry(item);
      await dequeue(config, item.filePath);
    } catch (err) {
      console.error(`[queue] drain failed for ${item.filePath}:`, err);
    }
  }
}
```

### Pattern 7: Atomic Ingest Marker (move into _ingested/)

**What:** After successful upload, atomically move the source file to `<dir>/_ingested/<filename>`. This is preferable to a sidecar because:
1. File move is atomic on the same filesystem (no partial-state race).
2. The chokidar `ignored` filter naturally excludes the `_ingested/` subdir, so the watcher won't re-detect.
3. The user can re-trigger ingestion by moving the file back, no special tooling.

```typescript
// cortex-local/src/ingest-marker.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function markIngested(filePath: string) {
  const dir = path.dirname(filePath);
  const ingestedDir = path.join(dir, '_ingested');
  await fs.mkdir(ingestedDir, { recursive: true });
  const dst = path.join(ingestedDir, path.basename(filePath));
  await fs.rename(filePath, dst); // atomic on same FS
}
```

### Pattern 8: Daily Heartbeat with Crash-Survivable Schedule

**What:** Use `node-cron` for the wall-clock daily ping AND persist `lastHeartbeatAt` to disk. On startup, if the persisted timestamp is stale (>24h), fire one immediately to "catch up" before the next cron tick.
**When to use:** Implementation of daemon side of MEET-09.

```typescript
// cortex-local/src/heartbeat.ts
import cron from 'node-cron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from './config.js';

const STATE_FILE = 'heartbeat.json';

interface HeartbeatState {
  lastHeartbeatAt: string;
}

async function readState(stateDir: string): Promise<HeartbeatState | null> {
  try {
    const raw = await fs.readFile(path.join(stateDir, STATE_FILE), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(stateDir: string, state: HeartbeatState) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, STATE_FILE), JSON.stringify(state, null, 2));
}

async function pingHeartbeat(config: Config) {
  const res = await fetch(`${config.cortexApiUrl}/api/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.sharedSecret}`,
    },
    body: JSON.stringify({
      host: config.host,
      version: process.env.npm_package_version ?? 'unknown',
      last_ingest_at: null, // wire if ingest-side maintains this in state
      queue_depth: 0, // wire if queue.ts exposes count
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`heartbeat ${res.status}`);
  await writeState(config.stateDir, { lastHeartbeatAt: new Date().toISOString() });
}

export function startHeartbeat(config: Config) {
  // Catch-up ping on boot if the last one is >24h old
  (async () => {
    const state = await readState(config.stateDir);
    const last = state ? new Date(state.lastHeartbeatAt).getTime() : 0;
    if (Date.now() - last > 24 * 60 * 60 * 1000) {
      try {
        await pingHeartbeat(config);
        console.log('[heartbeat] catch-up ping sent');
      } catch (err) {
        console.error('[heartbeat] catch-up failed:', err);
      }
    }
  })();

  // Schedule daily — at the same hour cortex's notification cron runs
  // (Use a fixed hour here; the cortex-side pg-boss cron handles user-configurable offset.)
  cron.schedule('0 9 * * *', async () => {
    try {
      await pingHeartbeat(config);
    } catch (err) {
      console.error('[heartbeat] scheduled ping failed:', err);
    }
  });
}
```

### Anti-Patterns to Avoid

- **Watching Meetily's SQLite DB directly:** Tightly couples cortex-local to Meetily's internal schema. Use the meetily-exporter (or equivalent) markdown directory as the contract.
- **`awaitWriteFinish: true` (no options):** Defaults may not match Meetily's write pattern. Always specify `stabilityThreshold` and `pollInterval`.
- **Trusting upstream IDs without idempotency:** If meetily-exporter writes the same `meeting-id` twice (e.g., user re-runs export), and cortex doesn't dedupe, you get two vault entries. Persist `external_id` on the Meeting row + check before writing.
- **Storing the shared secret in plain `.env` next to the daemon binary:** Use macOS Keychain (via `security` CLI) as source-of-truth, materialize to chmod-600 config at install.
- **Silent-drop in `SharedSecretGuard`:** Different from `ChatIdGuard`. The daemon needs to know its auth failed. Return 401.
- **Not persisting pending uploads:** If the daemon crashes during the 1h retry window, in-flight uploads are lost. Persist to JSON on disk before the first POST attempt.
- **Hand-rolling Telegram bot calls in the daemon:** The daemon should NOT have a Telegram bot token. All user-facing notifications go through cortex (server side). The daemon's only escalation channel is the `last_error` field on its heartbeat ping.
- **Skipping the `slug` library length cap:** Meeting titles can be very long ("Q2 2026 Planning + Marketing + Engineering Sync — REVISED — Final Final Final"). Cap at ~80 chars to keep filenames sane.
- **Calling LLM for slug generation:** The HLD does not require Sonnet for meetings (only notes). Title is concrete. Use `slug` library directly. Saves cost and latency.
- **Forgetting `awaitWriteFinish` and treating partial files as complete:** Without stable-write detection, you'll POST a half-written transcript. Always use `awaitWriteFinish` with chokidar for files written by other processes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File watcher | `fs.watch` polling loop | `chokidar` 4.x | OS-event reliability differs by platform; `awaitWriteFinish` handles atomic-replace patterns; `ignored` filters out `_ingested/`; battle-tested. |
| Exponential backoff | `setTimeout` chains with `Math.pow(2, n)` | `p-retry` 6.x | Jitter, AbortSignal support, typed errors, `onFailedAttempt` for logging. |
| Cron scheduling (daemon) | `setInterval(86400000)` | `node-cron` 3.x | setInterval drifts, doesn't survive restarts cleanly. node-cron uses wall-clock cron expressions. |
| Cron scheduling (server) | Custom timer in NestJS | `pg-boss.schedule()` (already in project) | Already present; survives restarts (DB-backed); single source of truth for scheduled work. |
| Constant-time string compare | `secret === provided` | `node:crypto.timingSafeEqual` | Avoid timing attacks. Built-in. Trivial. |
| Markdown frontmatter parse | Regex-grep for `---` blocks | `gray-matter` | Handles edge cases, escapes, multi-document YAML. |
| HTTP client | `axios`, `node-fetch`, `undici` | Native `fetch` (Node 20+) | Zero deps; identical API. Use `AbortSignal.timeout()` for hard limits. |
| Slug from title | Manual lowercase + replace | `slug` (already installed in 7a) | Unicode/diacritic handling. |
| Atomic file move | `fs.copy + fs.unlink` | `fs.rename` | Atomic on same FS. |
| Atomic JSON-file update | `fs.writeFile(path, ...)` directly | Write to `path.tmp` then `fs.rename` | Avoids partial-write corruption if process dies mid-write. |
| launchd plist authoring | Hand-write plist XML each install | Template + `sed` substitution in install.sh | Dynamic paths (`__HOME__`, `__INSTALL_DIR__`); reproducible. |
| Bearer-token auth in NestJS | Skip the guard, check in controller | `SharedSecretGuard` mirroring `ChatIdGuard` | Centralizes auth; declarative `@UseGuards` makes the boundary obvious. |

**Key insight:** Phase 7b is mostly *gluing* well-known building blocks. The mental energy should go into **(a) the Meetily output contract** (verify with the user once Meetily is installed) and **(b) crash-survivability** (queue persistence, heartbeat catch-up, atomic writes). Everything else is library composition.

## Common Pitfalls

### Pitfall 1: Meetily Output Format is Under-Documented
**What goes wrong:** The HLD describes "transcript file (.md) + sidecar metadata (.json)" but Meetily's primary storage is SQLite. The user will likely run `meetily-exporter` (or similar) which produces *markdown only* with YAML frontmatter — no separate JSON sidecar.
**Why it happens:** Meetily docs mention SQLite + advanced markdown export, but don't document file-system output paths/schemas publicly. Different exporter tools produce different shapes.
**How to avoid:**
1. Plan the daemon to consume **markdown with YAML frontmatter** as the primary contract (most likely shape).
2. Make the frontmatter field names configurable in `cortex-local`'s config (e.g., `frontmatterFields: { title: "title", started: "started_at", ended: "ended_at", attendees: "attendees" }`).
3. Add a `--dry-run` mode to cortex-local that prints what it would POST without sending — lets the user validate against their actual Meetily setup before going live.
4. Confirm the actual format with the user during plan execution (Plan 07b-02's first task should be a smoke test against a real Meetily output file).

**Warning signs:** Daemon parses files but POST fails Zod validation on the server (missing fields, wrong types). Logs show "could not parse frontmatter" or 400 from cortex.

### Pitfall 2: Body Size Exceeds NestJS Default Limit
**What goes wrong:** A 1-hour meeting transcript can be 100KB+ markdown. NestJS/Express default JSON body limit is **100KB**. Ingest fails with `PayloadTooLargeError`.
**Why it happens:** Express defaults; NestJS doesn't override.
**How to avoid:** In `src/main.ts`, configure body parser limit explicitly:
```typescript
import * as bodyParser from 'body-parser';
// after NestFactory.create(...):
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ limit: '5mb', extended: true }));
```
5MB caps the worst case (≈ 1.5M words; a marathon multi-hour meeting). Cortex's NFR §9 Phase 4b says <30s for 1h transcript; size budget is reasonable.
**Warning signs:** Daemon logs `413 Payload Too Large`. Surfaces during smoke test if it exists.

### Pitfall 3: chokidar Fires `add` Mid-Write
**What goes wrong:** Without `awaitWriteFinish`, chokidar emits `add` the moment a file appears, before Meetily/exporter is done writing. Daemon reads a partial file → invalid frontmatter or truncated transcript.
**Why it happens:** OS-level file events fire on file-create, not file-close.
**How to avoid:** Always specify `awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 }`. Per HLD §3.8 B-MEET-2: "Wait for Meetily to finish writing (file size stable for 5 seconds)."
**Warning signs:** Frontmatter parse failures on the daemon for files that look correct when manually opened later.

### Pitfall 4: launchd Throttle Crash-Loops
**What goes wrong:** Daemon crashes immediately on boot (bad config, missing dep). launchd KeepAlive restarts it. It crashes again. CPU pegged.
**Why it happens:** `KeepAlive: true` + no `ThrottleInterval` (default 10s) + sub-second crash time.
**How to avoid:** Set `<key>ThrottleInterval</key><integer>30</integer>` in plist. macOS will refuse to restart more than once per 30s. Combine with conditional KeepAlive (`SuccessfulExit: false`) so launchd only restarts on actual crashes, not graceful shutdowns.
**Warning signs:** `launchctl list | grep cortex` shows constantly-incrementing PID. CPU at 100%.

### Pitfall 5: launchd Doesn't Inherit User PATH
**What goes wrong:** `node` isn't found because launchd runs with a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). Daemon exits immediately.
**Why it happens:** launchd does NOT source `.bashrc`, `.zshrc`, `/etc/paths`, or any user shell config.
**How to avoid:** Either (a) hardcode absolute path to node in plist's `ProgramArguments`, OR (b) set `PATH` in `EnvironmentVariables` block: `<key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>`. Both shown in Pattern 5.
**Warning signs:** stderr log says `node: command not found` or `spawn ENOENT`.

### Pitfall 6: Heartbeat Cron Ticks at Daemon Local Time, Cortex Cron at UTC
**What goes wrong:** Daemon pings at 9am Mac local time (Asia/Kolkata = 03:30 UTC). Cortex staleness-check cron fires at user's `notificationHourUtc` (let's say 09:00 UTC = 14:30 Asia/Kolkata). The check happens 11h after the ping. If the next ping doesn't arrive on time tomorrow, the staleness window can fire spuriously.
**Why it happens:** Two independent crons in different timezones with overlapping responsibilities.
**How to avoid:** Daemon's daily cron should be set to UTC explicitly via `cron.schedule(..., { timezone: 'UTC' })`, OR pin both to the same time (e.g., daemon pings every 24h since boot — using `setInterval(24h)` is acceptable IF combined with disk-state catch-up on restart). Recommendation: use `cron.schedule(spec, fn, { timezone: 'UTC' })` and pick `0 9 * * *` UTC for the daemon, matching cortex's default `notificationHourUtc=9`.
**Warning signs:** Heartbeat-staleness alerts fire spuriously after timezone changes or daylight-saving boundaries.

### Pitfall 7: Sliding Heartbeat Stale Window vs Single-Shot Cron
**What goes wrong:** The cortex staleness cron only runs once per day (e.g., 9am UTC). If the daemon goes down at 11am, the staleness alert won't fire until 9am the next day — that's 22h, not 26h. If the daemon recovers at 8:59am, the alert never fires.
**Why it happens:** Single-shot daily cron + exact 26h threshold.
**How to avoid:**
- Option A (simpler): Accept the 1-day-resolution alerting. The HLD says "DMs the owner if last heartbeat is older than 26h" — implies once-daily-check is fine. Document the latency.
- Option B: Run the staleness check hourly (mirroring `PollingService` pattern from Phase 4) — small DB query, cheap. Use `notificationHourUtc` as a no-op gate so alerts only fire at 9am even if the cron runs every hour.
**Recommendation:** Option A for v1 simplicity. Revisit if real outages prove the latency is intolerable.
**Warning signs:** User reports "Meetily was off for 14h yesterday but I never got an alert." Inspect timing of crash vs cron fire.

### Pitfall 8: Idempotency Hole on Re-Ingest of the Same File
**What goes wrong:** User accidentally moves a file from `_ingested/` back to the watch dir. Daemon re-ingests. Cortex creates a duplicate Meeting row + duplicate vault commit.
**Why it happens:** No idempotency check on the server.
**How to avoid:** Use the meetily-exporter `meeting-id` field as `external_id` in the ingest payload. Server checks `prisma.meeting.findFirst({ where: { externalId } })` before writing; if exists, return the existing record and skip. Pattern 2 example shows this.
**Warning signs:** `git log` shows two `meeting: q2-roadmap-review` commits with identical bodies on the same day.

### Pitfall 9: Telegram Notification Failures Silently Swallow Vault Writes
**What goes wrong:** Vault write succeeds, Meeting row persists, but `notifications.sendMeetingCaptured()` throws (Telegram API rate limit, network blip). User has no clue the meeting was captured.
**Why it happens:** Notification failure shouldn't fail the ingest, so we catch and log. But a missed notification reduces user trust.
**How to avoid:**
- Log warning loudly with structured fields (meetingId, vaultPath) so you can grep `fly logs` and resend manually.
- Optionally: enqueue a pg-boss retry job for the notification (overkill for v1).
**Recommendation:** Log only for v1. Telegram is reliable.
**Warning signs:** Vault has commits cortex never told the user about.

### Pitfall 10: AbortSignal.timeout Doesn't Cleanly Cancel the POST
**What goes wrong:** A 1h transcript over a slow uplink times out at 30s. fetch throws `AbortError`. p-retry retries — but the next attempt also times out (network, not server). Wastes bandwidth and battery.
**Why it happens:** `AbortSignal.timeout(30_000)` is correct, but 30s may be too short for very large transcripts on slow links.
**How to avoid:** Scale timeout with payload size: `Math.max(30_000, transcript.length / 1000)` ms (1 second per KB). Or compress with `Content-Encoding: gzip` to shrink the payload; native fetch supports `Headers` for this. Recommendation: start with a 60s timeout (no scaling), revisit if a real outage proves it.
**Warning signs:** Daemon logs show `AbortError: signal timed out` for files larger than ~500KB.

## Code Examples

Verified patterns from official sources.

### NestJS body parser limit (server side)
```typescript
// src/main.ts — MODIFIED
// Source: https://docs.nestjs.com/faq/raw-body  +  https://github.com/expressjs/body-parser
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ limit: '5mb', extended: true }));
  // ... existing setup
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
```

### chokidar with awaitWriteFinish (daemon)
```typescript
// Source: https://github.com/paulmillr/chokidar (README — current v4)
import chokidar from 'chokidar';
const watcher = chokidar.watch('/path/to/dir', {
  ignored: (p) => p.includes('/_ingested/') || p.startsWith('.'),
  persistent: true,
  awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 },
  ignoreInitial: false,
});
watcher.on('add', (filePath) => { /* file is fully written; safe to read */ });
```

### p-retry with onFailedAttempt logging (daemon)
```typescript
// Source: https://github.com/sindresorhus/p-retry (README)
import pRetry, { AbortError } from 'p-retry';

const result = await pRetry(
  async () => {
    const res = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(60_000) });
    if (res.status === 401) throw new AbortError('auth failed'); // do NOT retry auth failures
    if (!res.ok) throw new Error(`status ${res.status}`);
    return res.json();
  },
  {
    retries: 5,
    factor: 2,
    minTimeout: 60_000,    // 1m
    maxTimeout: 1_800_000, // 30m cap per attempt
    onFailedAttempt: (err) => {
      console.warn(`[upload] attempt ${err.attemptNumber} failed: ${err.message} — ${err.retriesLeft} left`);
    },
  },
);
```

### node-cron with timezone (daemon)
```typescript
// Source: https://www.npmjs.com/package/node-cron
import cron from 'node-cron';
cron.schedule('0 9 * * *', () => pingHeartbeat(), { timezone: 'UTC' });
```

### pg-boss schedule (server side)
```typescript
// Source: https://github.com/timgit/pg-boss (README + this codebase's existing patterns)
await boss.createQueue('heartbeat-staleness-check');
await boss.work('heartbeat-staleness-check', async () => { /* check stale */ });
await boss.schedule('heartbeat-staleness-check', '0 9 * * *'); // daily at 9 UTC
// To stop: await boss.unschedule('heartbeat-staleness-check');
```

### macOS Keychain CLI (install script)
```bash
# Source: https://www.netmeister.org/blog/keychain-passwords.html  +  scriptingosx.com
# Store
security add-generic-password -s 'cortex-local' -a 'shared-secret' -w "$SECRET"
# Read
security find-generic-password -s 'cortex-local' -a 'shared-secret' -w
# Delete
security delete-generic-password -s 'cortex-local' -a 'shared-secret'
```

### launchd User Agent control
```bash
# Source: https://launchd.info/  +  Apple's launchd.plist(5) man page
# Load (and start)
launchctl load -w ~/Library/LaunchAgents/com.cortex.local.plist
# Unload (and stop)
launchctl unload -w ~/Library/LaunchAgents/com.cortex.local.plist
# List status
launchctl list | grep com.cortex.local
# Tail logs
tail -f ~/Library/Logs/cortex-local.{out,err}.log
```

### timingSafeEqual for shared-secret comparison
```typescript
// Source: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
import { timingSafeEqual } from 'node:crypto';
const a = Buffer.from(provided, 'utf8');
const b = Buffer.from(expected, 'utf8');
if (a.length !== b.length || !timingSafeEqual(a, b)) {
  throw new UnauthorizedException();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-fetch` for server-side HTTP | Native `fetch` (Node 18+, stable in 20+, GA in 21+) | Node 21 (Oct 2023) | Remove dep; use `AbortSignal.timeout()` for cancellation. |
| `axios` interceptors for retry | `p-retry` + native fetch | Long-standing for new code | Lighter, type-safer, single-purpose. |
| `cron` (npm) for scheduling | `node-cron` (3.x) | Roughly even split; node-cron has a cleaner API | Either is fine; `node-cron` is in line with daemon's small-deps spirit. |
| Polling SQLite for changes | File-watcher pattern | Long-standing | Decouples from internal schema; more portable. |
| `fs.watch` raw | `chokidar` 4.x | Long-standing | Cross-platform reliability; `awaitWriteFinish`; ignored patterns. |
| Reading SSH-key/secret from build-time | Runtime materialization (Phase 7a pattern) | Mid-2020s | No secrets in image layers (already established in 7a). |
| `body-parser` middleware in Express | Express 4.16+ built-in `json`/`urlencoded` | Express 4.16 (2017) | Use built-ins; no separate `body-parser` install needed (already in deps tree). |

**Deprecated/outdated:**
- `async-retry`: Not deprecated but unmaintained (last release 5+ years ago). Prefer `p-retry`.
- `node-fetch`: Now ESM-only; native fetch is the answer for new code on Node 20+.
- `axios` for new server code: Heavyweight given native fetch covers 95% of needs.

## Open Questions

1. **Exact Meetily output format the user runs**
   - **What we know:** Meetily stores meetings in SQLite (`meeting_minutes.db`); third-party `meetily-exporter` writes per-meeting markdown with YAML frontmatter to a configurable directory; advanced PRO export is "PDF/DOCX/Markdown."
   - **What's unclear:** Which exporter the user will run, the exact frontmatter field names (`meeting-id`? `id`?), whether the user's setup produces a JSON sidecar.
   - **Recommendation:** Plan 07b-02 should ship cortex-local with a `--dry-run` mode and configurable frontmatter field names. The first task in plan 07b-02 should be a smoke test against an actual Meetily output file from the user's setup, and any field-name mismatches resolved by config rather than code change.

2. **Where exactly does cortex-local live in the cortex repo?**
   - **What we know:** HLD says "lives in cortex repo at `cortex-local/` with its own minimal package."
   - **What's unclear:** Whether to introduce npm workspaces / monorepo tooling, or keep it as a sibling directory with its own `package.json` ignored by the root.
   - **Recommendation:** Sibling directory at `cortex-local/` with its own `package.json`, `tsconfig.json`, and `node_modules`. Add `cortex-local/` to root's `.dockerignore` so it doesn't bloat the Fly image. No monorepo tooling needed for two top-level packages.

3. **Is meetily-exporter a hard dependency or just one option?**
   - **What we know:** HLD describes the contract abstractly ("Meetily's configured output directory").
   - **What's unclear:** Whether to recommend the user install meetily-exporter as part of setup, or document multiple acceptable adapters.
   - **Recommendation:** Recommend `meetily-exporter` (`npm i -g meetily-exporter`) in cortex-local's README as the proven path. Document the file-format contract so any equivalent adapter works.

4. **`/vault recent` polymorphism — already handled in Phase 7a?**
   - **What we know:** Phase 7a Plan 02 (07a-02-PLAN.md, lines 392-430) already implements `formatVaultRecent` querying `prisma.vaultWrite.findMany` directly. Polymorphic by construction — the formatter just prints `vaultPath` regardless of `kind`.
   - **What's unclear:** Whether the Phase 7a SUMMARY or QA checklist verified the meeting-write case (it can't — Phase 7b hasn't shipped yet).
   - **Recommendation:** Plan 07b-01 should explicitly add a smoke test that captures one meeting then runs `/vault recent` and confirms the meeting appears alongside any notes. No code change should be needed.

5. **Heartbeat staleness — single daily cron vs hourly check?**
   - **What we know:** HLD §3.8 B-MEET-7 says check at "the configurable user notification hour."
   - **What's unclear:** Whether single daily check is enough or if hourly check (gated to alert only at notification hour) is worth the simplicity bump.
   - **Recommendation:** Single daily cron via `pg-boss.schedule()`. Matches HLD literally; simplest implementation; latency is acceptable for v1.

6. **Should the daemon ever run without launchd (e.g., `npm start` for dev)?**
   - **What we know:** Production target is launchd. Dev workflow not specified.
   - **Recommendation:** Yes — `npm run dev` (tsx watch) for local iteration without launchd. Document in cortex-local's README.

7. **Fly secret name conflicts**
   - **What we know:** Phase 7a sets `NIRVANA_WIKI_*` secrets. Phase 7b adds `CORTEX_LOCAL_SHARED_SECRET`.
   - **What's unclear:** Just naming — no real conflict. Use `CORTEX_LOCAL_SHARED_SECRET` server-side, `sharedSecret` field in daemon config — match HLD's nomenclature.
   - **Recommendation:** Use exactly `CORTEX_LOCAL_SHARED_SECRET` for the Fly secret. Generate a 64-char random hex with `openssl rand -hex 32`.

8. **What if the user has multiple Macs (work + home)?**
   - **What we know:** HLD §3.8 says "single host in v1."
   - **Recommendation:** Heartbeat upserts on `host` (config field). Schema supports multiple hosts; v1 just expects one. Document as such.

## Sources

### Primary (HIGH confidence)

- **chokidar GitHub repo** — https://github.com/paulmillr/chokidar — confirmed v4 API (Nov 2025), `awaitWriteFinish` semantics (`stabilityThreshold`, `pollInterval`), `ignored` filter, ESM-only, Node ≥ 20.
- **p-retry npm + GitHub** — https://www.npmjs.com/package/p-retry / https://github.com/sindresorhus/p-retry — confirmed `factor`, `minTimeout`, `maxTimeout`, `onFailedAttempt`, `AbortError` for non-retryable cases. v6.x current.
- **pg-boss GitHub** — https://github.com/timgit/pg-boss — `schedule(name, cron, data?, options?)` API + `unschedule()`. Already used in this project (Phase 4 reminder service).
- **Apple `launchd.plist(5)` man page** — https://keith.github.io/xcode-man-pages/launchd.plist.5.html — `KeepAlive`, `RunAtLoad`, `StandardOutPath`, `StandardErrorPath`, `EnvironmentVariables`, `ThrottleInterval` semantics.
- **launchd.info tutorial** — https://launchd.info/ — User Agent vs Daemon distinction, plist install/load workflow.
- **Apple developer "Creating Launch Daemons and Agents"** — https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html — best practices (no daemon(3), no fork, no setrusage).
- **NestJS Authentication docs** — https://docs.nestjs.com/security/authentication — `CanActivate` interface, `@UseGuards` pattern.
- **Node.js native fetch docs** — https://nodejs.org/learn/getting-started/fetch — confirmed stable in v21, undici-backed, `AbortSignal.timeout()` pattern.
- **Node.js crypto.timingSafeEqual** — https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b — constant-time buffer comparison.
- **Existing cortex codebase** — directly inspected:
  - `src/telegram/guards/chat-id.guard.ts` — guard pattern shape
  - `src/scheduler/scheduler.service.ts` + `reminder.service.ts` — pg-boss lifecycle, `singletonKey`, `expireInSeconds`
  - `src/scheduler/notification.service.ts` — `@InjectBot()` + `Markup.inlineKeyboard` + escapeHtml
  - `src/scheduler/polling.service.ts` — `@Cron('0 * * * *')` hourly polling pattern (NestJS scheduler — alternative to pg-boss schedule)
  - `src/settings/settings.service.ts` — `Settings.notificationHourUtc` field already exists from Phase 4
  - `src/workspace/workspace.service.ts` — `findByName('work')` API
  - `src/llm/llm.types.ts` — confirms slug-generation entry already added in Phase 7a
  - `src/main.ts` — current Nest bootstrap; place to inject body-parser limit
  - `prisma/schema.prisma` — Phase 7a's Meeting + VaultWrite model declarations
  - `fly.toml` — current shape (Phase 7a already adds `[[mounts]]`)
  - `.planning/phases/07a-note-capture/07a-RESEARCH.md` + plans — confirms VaultService API surface, async-mutex serialization, audit-log pattern already in place
  - `.planning/phases/07a-note-capture/07a-02-PLAN.md` task 2 — confirms `formatVaultRecent` already polymorphic over kinds; VAULT-06 will be observably satisfied as soon as first meeting writes

### Secondary (MEDIUM confidence)

- **Meetily GitHub** — https://github.com/Zackriya-Solutions/meetily — confirms SQLite (`meeting_minutes.db`), Markdown export ability (PRO feature). Macintosh paths and exact schema NOT documented publicly.
- **meetily-exporter GitHub** — https://github.com/dino-rodriguez/meetily-exporter — confirms read-only SQLite query → markdown with YAML frontmatter (`meeting-id` field), `watch` polling mode, macOS-only.
- **Meetily DeepWiki** — https://deepwiki.com/Zackriya-Solutions/meeting-minutes — confirms SQLite schema exists but doesn't publish exact tables.
- **gray-matter npm** — https://www.npmjs.com/package/gray-matter — standard YAML frontmatter parser; widely used (Hexo, Gatsby).
- **node-cron npm** — https://www.npmjs.com/package/node-cron — confirmed cron-expression scheduling, `timezone` option, framework-agnostic.
- **NestJS Express bodyParser limit** — community Q&As + official issue thread (https://github.com/nestjs/nest/issues/9427) confirming default 100KB and how to override.
- **macOS Keychain `security` CLI** — https://www.netmeister.org/blog/keychain-passwords.html + multiple corroborating sources — confirmed `add-generic-password` / `find-generic-password -w` workflow.

### Tertiary (LOW confidence — flagged for validation at implementation time)

- **Exact Meetily macOS storage path and schema** — Meetily docs reference `$HOME/.meetily/meeting_minutes.db`, `$HOME/Documents/meetily/meeting_minutes.db`, and others, with no canonical default published. Validate by inspecting the user's actual install during Plan 07b-02.
- **launchd `ThrottleInterval` minimum** — documented as "10 seconds" in some sources, "30 seconds" in others. Setting 30 explicitly is safe.
- **node-cron daylight-saving behavior** — likely correct via `timezone: 'UTC'` option but not verified end-to-end. Mitigated by using UTC.
- **pg-boss `schedule()` interaction with `singletonKey`** — schedule registers a recurring job; singleton semantics aren't relevant for the staleness-check (we want it to run every day). Validate that `await boss.schedule(...)` is idempotent (registering the same name twice updates the schedule, doesn't duplicate). Plan should call `unschedule()` on module destroy as belt-and-suspenders.

## Metadata

**Confidence breakdown:**
- Standard stack (server side): **HIGH** — all libraries already in project (slug, pg-boss, zod, NestJS guards) or built-in (node:crypto). Patterns mirror existing 7a + Phase 4 code precisely.
- Standard stack (daemon side): **HIGH** — chokidar/p-retry/node-cron/gray-matter are mature, well-documented, individually verified. Native fetch is Node 20+ standard.
- Architecture: **HIGH** — VaultModule reuse path is clean (no changes needed in 7a's VaultService). Heartbeat staleness reuses Settings.notificationHourUtc from Phase 4 unchanged. Notification flow extends existing NotificationService pattern.
- Pitfalls: **HIGH** for the well-trodden ones (chokidar awaitWriteFinish, NestJS body limit, launchd PATH/throttle, timing-safe compare). **MEDIUM** for the Meetily-specific format risk (Pitfall 1) — this is the genuine unknown; the planner should bake in flexibility there.
- Meetily output contract: **MEDIUM** — public docs are sparse; first task of plan 07b-02 should be a smoke verification against the user's actual Meetily install.

**Research date:** 2026-04-26
**Valid until:** 2026-07-26 (90 days for stable libs; revisit if chokidar publishes v5 breaking changes, p-retry/node-cron change majors, or Meetily ships a different export format)
