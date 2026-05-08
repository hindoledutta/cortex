---
phase: 07b-meeting-capture
plan: 02
type: execute
wave: 2
depends_on: ["07b-01"]
files_modified:
  - cortex-local/package.json
  - cortex-local/package-lock.json
  - cortex-local/tsconfig.json
  - cortex-local/.gitignore
  - cortex-local/README.md
  - cortex-local/tsup.config.ts
  - cortex-local/src/index.ts
  - cortex-local/src/config.ts
  - cortex-local/src/types.ts
  - cortex-local/src/watcher.ts
  - cortex-local/src/client.ts
  - cortex-local/src/queue.ts
  - cortex-local/src/heartbeat.ts
  - cortex-local/src/ingest-marker.ts
  - cortex-local/src/dry-run.ts
  - cortex-local/tests/config.test.ts
  - cortex-local/tests/queue.test.ts
  - cortex-local/tests/ingest-marker.test.ts
  - cortex-local/tests/watcher.test.ts
  - cortex-local/tests/client.test.ts
  - cortex-local/tests/heartbeat.test.ts
  - cortex-local/scripts/install.sh
  - cortex-local/scripts/uninstall.sh
  - cortex-local/scripts/com.cortex.local.plist.tmpl
  - .dockerignore
autonomous: false
requirements:
  - MEET-01
  - MEET-02
  - MEET-06
  - MEET-07
  - MEET-09

user_setup:
  - service: macos-keychain
    why: "Daemon needs the same CORTEX_LOCAL_SHARED_SECRET that the cortex server has. Stored in Keychain on the Mac mini so it never lives in plain text in the daemon repo or process env."
    dashboard_config:
      - task: "Have the value of CORTEX_LOCAL_SHARED_SECRET (set on Fly.io in plan 07b-01) ready to paste when install.sh prompts"
        location: "Run on the Mac mini: `bash cortex-local/scripts/install.sh` — it stores in Keychain via `security add-generic-password -s cortex-local -a shared-secret`"
  - service: meetily
    why: "Provides the Google Meet capture + local Whisper transcription. Without it there are no markdown files for cortex-local to watch."
    dashboard_config:
      - task: "Install Meetily on the Mac mini"
        location: "https://github.com/Zackriya-Solutions/meetily — follow their macOS install"
      - task: "Install meetily-exporter (RESEARCH.md recommended adapter)"
        location: "Run on the Mac mini: `npm i -g meetily-exporter` — then run it (or its `watch` mode) with --output pointing at the directory cortex-local will watch (e.g. ~/Documents/Meetily/exports)"
  - service: launchd
    why: "Supervises the cortex-local daemon, restarts on crash, runs at login"
    dashboard_config:
      - task: "install.sh handles bootstrap automatically — no manual launchd config needed beyond running the install script"
        location: "Mac mini terminal"

must_haves:
  truths:
    - "A new markdown file landing in the configured Meetily/exporter output directory is detected, waited on for 5 seconds of file-size stability, parsed for YAML frontmatter, and POSTed to cortex's /api/meetings/ingest within seconds"
    - "The daemon authenticates every POST with a Bearer token sourced from a chmod-600 config file populated by install.sh from macOS Keychain"
    - "On any non-2xx response other than 401/400, the daemon retries with exponential backoff up to ~1 hour total elapsed; pending uploads are persisted to ~/Library/Application Support/cortex-local/state/queue.json so a daemon crash mid-retry does not lose the meeting"
    - "On terminal upload failure (retries exhausted, or 401/400), the daemon writes lastError to runtime.json so the next heartbeat surfaces it via cortex's heartbeat-staleness alerting (the daemon has NO Telegram bot token of its own)"
    - "Audio files (.opus, .ogg, .wav, .m4a, .mp3) are NEVER read or POSTed — the daemon hard-filters by .md extension"
    - "After successful upload, the source file is atomically moved to <watch-dir>/_ingested/<filename> so the watcher's `ignored` filter excludes it from re-processing"
    - "Once per day at 9:00 UTC (cron), the daemon POSTs to /api/heartbeat with { host, version, last_ingest_at, queue_depth, last_error }; also pings on boot if the persisted lastHeartbeatAt is more than 24 hours old"
    - "The daemon runs under launchd as a User Agent at ~/Library/LaunchAgents/com.cortex.local.plist with KeepAlive=true, RunAtLoad=true, ThrottleInterval=30, explicit PATH including /usr/local/bin and /opt/homebrew/bin, and logs to ~/Library/Logs/cortex-local.{out,err}.log"
    - "An interactive install.sh prompts for cortex API URL, Meetily/exporter output dir, hostname, and (if not already in Keychain) the shared secret; then templates the plist with absolute paths and launchctl-bootstraps the agent"
    - "End-to-end SLA (smoke-test asserted): from the moment Meetily writes the markdown file to the moment the corresponding GitHub commit on `nirvana-wiki/main` is observable, no more than 30 seconds elapse. Verified by capturing both timestamps with `stat`/`ls -la` (file write) and `gh api` (commit committer.date) and computing the diff."
  artifacts:
    - path: "cortex-local/package.json"
      provides: "Standalone npm package — type: module; runtime deps chokidar/p-retry/node-cron/gray-matter/zod; dev deps typescript/tsx/vitest/tsup; scripts: dev, build, test, dry-run, start"
      contains: "\"type\": \"module\""
    - path: "cortex-local/src/index.ts"
      provides: "Entry point — loads config, drains the persisted queue on boot, starts watcher, starts heartbeat scheduler"
      min_lines: 10
    - path: "cortex-local/src/config.ts"
      provides: "loadConfig() — reads JSON from CORTEX_LOCAL_CONFIG path, Zod-validates ConfigSchema (cortexApiUrl, sharedSecret, meetilyOutputDir, host, stateDir, optional frontmatterFields, heartbeatCron)"
      min_lines: 40
    - path: "cortex-local/src/watcher.ts"
      provides: "startWatcher(config) — chokidar.watch with awaitWriteFinish stabilityThreshold=5000; ignores _ingested/ and dotfiles; on `add` parses gray-matter, builds payload, enqueues, uploads, marks ingested"
      min_lines: 50
    - path: "cortex-local/src/client.ts"
      provides: "uploadWithRetry(config, payload) — native fetch + Bearer header + AbortSignal.timeout(60s); p-retry with retries=5, factor=2, minTimeout=60s, maxTimeout=30m; AbortError on 401/400 to skip retry; persists lastError on terminal failure"
      min_lines: 60
    - path: "cortex-local/src/queue.ts"
      provides: "Persisted JSON queue at <stateDir>/queue.json with atomic .tmp+rename writes; enqueue / dequeue / drain / depth"
      min_lines: 50
    - path: "cortex-local/src/heartbeat.ts"
      provides: "startHeartbeat(config) — node-cron daily at 9 UTC; persists lastHeartbeatAt to <stateDir>/heartbeat.json; catch-up ping on boot if >24h stale"
      min_lines: 50
    - path: "cortex-local/src/ingest-marker.ts"
      provides: "markIngested(filePath) — atomic fs.rename to <dir>/_ingested/<basename>"
      min_lines: 10
    - path: "cortex-local/scripts/install.sh"
      provides: "Interactive bash installer — prompts for config; reads/stores shared secret in macOS Keychain; renders plist from template; launchctl bootstrap"
      min_lines: 50
    - path: "cortex-local/scripts/com.cortex.local.plist.tmpl"
      provides: "launchd User Agent plist template with __PLACEHOLDERS__ substituted by install.sh — KeepAlive, RunAtLoad, ThrottleInterval=30, explicit PATH, log paths"
      min_lines: 25
  key_links:
    - from: "cortex-local/src/watcher.ts"
      to: "cortex-local/src/client.ts"
      via: "watcher.on('add', ...) → enqueue → uploadWithRetry → markIngested"
      pattern: "uploadWithRetry"
    - from: "cortex-local/src/client.ts"
      to: "(cortex API)"
      via: "fetch(`${config.cortexApiUrl}/api/meetings/ingest`, { headers: { Authorization: `Bearer ${config.sharedSecret}` } })"
      pattern: "Authorization.*Bearer"
    - from: "cortex-local/src/watcher.ts"
      to: "node_modules/chokidar"
      via: "chokidar.watch(dir, { awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 }, ignored: ... })"
      pattern: "stabilityThreshold:\\s*5000"
    - from: "cortex-local/src/watcher.ts"
      to: "cortex-local/src/ingest-marker.ts"
      via: "after successful upload: markIngested(filePath) — atomic mv to _ingested/"
      pattern: "markIngested"
    - from: "cortex-local/src/heartbeat.ts"
      to: "(cortex API)"
      via: "fetch(`${config.cortexApiUrl}/api/heartbeat`, ...) daily via node-cron and on boot if stale"
      pattern: "/api/heartbeat"
    - from: "cortex-local/src/queue.ts"
      to: "<stateDir>/queue.json"
      via: "atomic write: writeFile(tmp, JSON) then rename(tmp, target)"
      pattern: "fs\\.rename|rename\\("
    - from: "cortex-local/scripts/install.sh"
      to: "macOS Keychain"
      via: "security add-generic-password / security find-generic-password -w"
      pattern: "security\\s+(add|find)-generic-password"
    - from: "cortex-local/scripts/install.sh"
      to: "~/Library/LaunchAgents/com.cortex.local.plist"
      via: "sed substitution then launchctl bootstrap gui/$(id -u) (fallback to load -w)"
      pattern: "launchctl\\s+(bootstrap|load)"
    - from: ".dockerignore"
      to: "cortex-local/"
      via: "Add `cortex-local` line so Fly.io image does not bundle the daemon"
      pattern: "cortex-local"
---

<objective>
Build the cortex-local daemon — a standalone TypeScript subproject living at `cortex-local/` (sibling to `src/`) — that runs on the user's Mac mini under launchd, watches Meetily/meetily-exporter's output directory for new transcript markdown files, POSTs them with Bearer-token auth to the `POST /api/meetings/ingest` endpoint built in plan 07b-01, and pings `POST /api/heartbeat` daily. Crash survivability is non-negotiable: the daemon persists its pending-upload queue and last-heartbeat timestamp to disk so launchd-restarts pick up where they left off, and the 1-hour retry window survives daemon death. Audio NEVER leaves the Mac (MEET-07) — the daemon hard-filters by `.md` extension. The daemon has NO Telegram bot token: terminal upload failures escalate via the `lastError` field on the next heartbeat, surfaced by cortex's staleness checker.

Purpose: Close the hands-off meeting-capture loop. After this plan, a Google Meet call recorded by Meetily on the Mac mini lands as a verbatim transcript in `nirvana-wiki/raw/meetings/...` and a Telegram notification arrives — without any user action.

Output:
- A new top-level `cortex-local/` subproject (own package.json, own tsconfig, own node_modules) — NOT a workspace, NOT a monorepo
- Source modules: index, config (Zod-validated), watcher (chokidar with `awaitWriteFinish`), client (native fetch + p-retry), queue (atomic JSON file), heartbeat (node-cron + persisted state), ingest-marker (atomic mv), dry-run mode
- Tests for each module via vitest
- launchd plist template + interactive bash install/uninstall scripts using macOS Keychain
- README covering install, dry-run, configuration of frontmatter field names, launchctl management, troubleshooting
- Root `.dockerignore` updated so `cortex-local/` is excluded from the Fly.io image build context
- Human checkpoint: user installs Meetily/meetily-exporter, runs install.sh on the Mac mini, dry-runs against an actual Meetily output file, then captures a real meeting end-to-end
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
@.planning/phases/07b-meeting-capture/07b-01-SUMMARY.md

@.dockerignore

<interfaces>
<!-- Server-side endpoints exposed by plan 07b-01 that this daemon consumes. -->

POST /api/meetings/ingest
- Auth: `Authorization: Bearer ${CORTEX_LOCAL_SHARED_SECRET}` (matches sharedSecret in daemon config)
- Body (JSON, max 5 MB):
  ```typescript
  {
    title: string;          // 1..500 chars
    started_at: string;     // ISO 8601 UTC
    ended_at: string;       // ISO 8601 UTC
    attendees: string[];    // 0..50 entries; verbatim names or emails
    transcript: string;     // 1..5_000_000 chars
    source: 'meetily';      // literal
    external_id?: string;   // 1..200 chars; meetily-exporter `meeting-id` for idempotency
  }
  ```
- Success (200): `{ meeting_id, vault_path, commit_sha }`
- Failures: 401 (bad Bearer), 400 (Zod validation), 5xx (server error — retry-eligible)

POST /api/heartbeat
- Auth: same Bearer
- Body:
  ```typescript
  {
    host: string;                          // 1..100 chars
    version?: string;                      // optional
    last_ingest_at?: string | null;        // ISO 8601 of most recent successful ingest
    queue_depth?: number;                  // pending uploads in our JSON queue
    last_error?: string | null;            // up to 2000 chars; daemon's terminal-failure escalation channel
  }
  ```
- Success (200): `{ ok: true, last_seen_at: string }`

<!-- Daemon's own internal contracts. -->

ConfigSchema (Zod) — what install.sh writes and what config.ts validates:
```typescript
const ConfigSchema = z.object({
  cortexApiUrl: z.string().url(),
  sharedSecret: z.string().min(32),
  meetilyOutputDir: z.string().min(1),     // absolute path; ~ expanded by install.sh
  host: z.string().min(1).max(100),
  stateDir: z.string().min(1),             // ~/Library/Application Support/cortex-local/state
  frontmatterFields: z.object({
    title: z.string().default('title'),
    startedAt: z.string().default('started_at'),
    endedAt: z.string().default('ended_at'),
    attendees: z.string().default('attendees'),
    externalId: z.string().default('meeting-id'),
  }).default({}),
  heartbeatCron: z.string().default('0 9 * * *'),
});
```

QueuedItem (cortex-local/src/queue.ts):
```typescript
interface QueuedItem {
  filePath: string;       // absolute path of source markdown (used as dedupe key)
  payload: IngestPayload;
  enqueuedAt: string;
  attempts: number;
}
```

IngestPayload (cortex-local/src/types.ts) — mirrors server's Zod schema exactly.

PersistedRuntimeState (cortex-local/src/types.ts):
```typescript
interface PersistedRuntimeState {
  lastIngestAt: string | null;
  lastError: string | null;
}
```

<!-- Existing patterns from research that drive the install/run flow. -->

macOS Keychain CLI:
```bash
security add-generic-password -U -s 'cortex-local' -a 'shared-secret' -w "$SECRET"
security find-generic-password -s 'cortex-local' -a 'shared-secret' -w
```

launchd User Agent control (modern bootstrap, with legacy load fallback):
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortex.local.plist
launchctl bootout gui/$(id -u)/com.cortex.local
launchctl print gui/$(id -u)/com.cortex.local
# Legacy fallback if bootstrap unavailable:
launchctl load -w ~/Library/LaunchAgents/com.cortex.local.plist
```

Existing root `.dockerignore` (we APPEND `cortex-local`):
```
node_modules
dist
dashboard
.planning
.claude
.git
.env
*.md
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold cortex-local subproject — package + tsconfig + types/config/queue/ingest-marker/dry-run + their tests; update root .dockerignore</name>
  <files>cortex-local/package.json, cortex-local/package-lock.json, cortex-local/tsconfig.json, cortex-local/.gitignore, cortex-local/tsup.config.ts, cortex-local/src/types.ts, cortex-local/src/config.ts, cortex-local/src/queue.ts, cortex-local/src/ingest-marker.ts, cortex-local/src/dry-run.ts, cortex-local/tests/config.test.ts, cortex-local/tests/queue.test.ts, cortex-local/tests/ingest-marker.test.ts, .dockerignore</files>
  <action>
**Append `cortex-local` to root `.dockerignore`** (so Fly.io image build context excludes the daemon — RESEARCH.md Open Question 2). Use the Edit tool — read the file then add a single new line `cortex-local` at the end. The existing `*.md` line should remain.

**Create `cortex-local/.gitignore`:**

```
node_modules
dist
*.log
.DS_Store
state/
```

**Create `cortex-local/package.json`:**

```json
{
  "name": "cortex-local",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Cortex meeting-capture watcher daemon for the Mac mini.",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup",
    "dry-run": "tsx src/dry-run.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chokidar": "^4.0.3",
    "p-retry": "^6.2.0",
    "node-cron": "^3.0.3",
    "gray-matter": "^4.0.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "tsup": "^8.3.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.16.0",
    "@types/node-cron": "^3.0.11"
  },
  "engines": { "node": ">=20" }
}
```

Then install:
```bash
cd cortex-local && npm install
```

**Create `cortex-local/tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Create `cortex-local/tsup.config.ts`** (tsup bundles src/index.ts to dist/index.js; install.sh ships node_modules separately so we keep the listed deps `external`):

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  bundle: true,
  splitting: false,
  external: ['chokidar', 'p-retry', 'node-cron', 'gray-matter', 'zod'],
});
```

**Create `cortex-local/src/types.ts`:**

```typescript
export interface IngestPayload {
  title: string;
  started_at: string;
  ended_at: string;
  attendees: string[];
  transcript: string;
  source: 'meetily';
  external_id?: string;
}
export interface QueuedItem {
  filePath: string;
  payload: IngestPayload;
  enqueuedAt: string;
  attempts: number;
}
export interface HeartbeatState {
  lastHeartbeatAt: string;
}
export interface PersistedRuntimeState {
  lastIngestAt: string | null;
  lastError: string | null;
}
```

**Create `cortex-local/src/config.ts`:**

Implement `loadConfig(configPath?)` that reads `CORTEX_LOCAL_CONFIG` env (or argument) → `fs.readFile` → `JSON.parse` → `ConfigSchema.safeParse`. Throw `Error` with descriptive message on each failure mode. Export `ConfigSchema` and `Config = z.infer<typeof ConfigSchema>`.

Schema fields exactly as in the `<interfaces>` block above. Use `.default({})` on `frontmatterFields` so the default object materializes when the user omits the override block.

**Create `cortex-local/src/queue.ts`** — atomic JSON queue (RESEARCH.md Pattern 6):

Functions:
- `enqueue(stateDir, filePath, payload): Promise<void>` — read array, dedupe by `filePath` (don't add if same path already pending), append `{ filePath, payload, enqueuedAt: iso, attempts: 0 }`, atomic write.
- `dequeue(stateDir, filePath): Promise<void>` — filter out matching filePath, atomic write.
- `depth(stateDir): Promise<number>` — return array length.
- `drain(stateDir, retry): Promise<void>` — for each pending item, await `retry(item)`; on success dequeue; on throw log and continue.

Atomic write helper: `writeFile(tmp, JSON.stringify(items, null, 2))` then `fs.rename(tmp, target)` (atomic on same filesystem).

Read helper returns `[]` on missing/unparseable file (corruption recovery).

**Create `cortex-local/src/ingest-marker.ts`** (RESEARCH.md Pattern 7):

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const INGESTED_DIR = '_ingested';

export async function markIngested(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  const ingestedDir = path.join(dir, INGESTED_DIR);
  await fs.mkdir(ingestedDir, { recursive: true });
  const dst = path.join(ingestedDir, path.basename(filePath));
  await fs.rename(filePath, dst);
  return dst;
}
```

**Create `cortex-local/src/dry-run.ts`** — a tsx-runnable helper that loads config, reads the file path from `process.argv[2]`, parses frontmatter via gray-matter using `config.frontmatterFields` overrides, builds the IngestPayload, and `console.log`s both the parsed frontmatter and the would-be POST body (with transcript truncated to 200 chars + length annotation). Does NOT POST. Exits 2 on missing argv, 1 on any failure.

**Create `cortex-local/tests/config.test.ts`:**

vitest using `fs.mkdtemp` for temp dirs:
1. throws on missing path
2. throws on invalid JSON
3. throws on missing required fields
4. throws if `sharedSecret` < 32 chars
5. throws if `cortexApiUrl` is not a valid URL
6. parses valid config and applies defaults (`heartbeatCron === '0 9 * * *'`, `frontmatterFields.externalId === 'meeting-id'`)
7. honors explicit `frontmatterFields` overrides

**Create `cortex-local/tests/queue.test.ts`:**

vitest using temp dirs:
1. enqueue then read returns the item with `attempts === 0` and an `enqueuedAt` ISO string
2. enqueue with duplicate `filePath` does NOT add a second entry
3. dequeue removes matching `filePath` (other entries unaffected)
4. `drain(retry)`: when retry resolves, item is removed; when retry throws, item stays
5. `depth()` returns count
6. atomic-write evidence: spy on `fs.writeFile` to confirm the call target ends in `.tmp`, and `fs.rename` is called next from `.tmp` to the final path

**Create `cortex-local/tests/ingest-marker.test.ts`:**

vitest using temp dirs:
1. `markIngested(filePath)` moves file to `<dir>/_ingested/<basename>` and returns destination path
2. creates `_ingested/` dir if missing
3. **Deterministic overwrite behavior**: asserts that calling `markIngested` twice with the same source basename overwrites the previous file in `_ingested/` (macOS `fs.rename` overwrite semantics — documented Node.js behavior on POSIX systems where `fs.rename` atomically replaces an existing destination). Setup: write fixture A → `markIngested(fixtureA)` → assert at `_ingested/A.md`; write fixture B with the same filename to the watch dir → `markIngested(fixtureB)` → assert `_ingested/A.md` now contains fixture B's contents (overwritten, no error thrown). Add an inline comment in the test: `// Deterministic by spec: macOS fs.rename overwrites destination atomically — see Node.js fs.promises.rename docs and POSIX rename(2). If we ever need to preserve old ingested copies, switch to a content-hashed filename here.`

**Verify so far:**
```bash
cd cortex-local && npm test
```
Build will not work yet (no `src/index.ts`) — that lands in Task 2. Tests for config, queue, ingest-marker MUST pass.
  </action>
  <verify>
    <automated>cd cortex-local &amp;&amp; npm test 2>&amp;1 | tail -25 &amp;&amp; cd .. &amp;&amp; grep -q "^cortex-local$" .dockerignore</automated>
  </verify>
  <done>cortex-local subproject scaffolded with own package.json (type: module), tsconfig (Node16 ESM), tsup.config; src/types.ts, src/config.ts, src/queue.ts, src/ingest-marker.ts, src/dry-run.ts created; tests for config + queue + ingest-marker pass (including deterministic overwrite assertion); root .dockerignore has `cortex-local` line.</done>
</task>

<task type="auto">
  <name>Task 2: Build watcher + client + heartbeat + index entry; tests; bundle build; launchd plist + install/uninstall scripts; README</name>
  <files>cortex-local/src/watcher.ts, cortex-local/src/client.ts, cortex-local/src/heartbeat.ts, cortex-local/src/index.ts, cortex-local/tests/watcher.test.ts, cortex-local/tests/client.test.ts, cortex-local/tests/heartbeat.test.ts, cortex-local/scripts/install.sh, cortex-local/scripts/uninstall.sh, cortex-local/scripts/com.cortex.local.plist.tmpl, cortex-local/README.md</files>
  <action>
**Create `cortex-local/src/client.ts`:**

Implement two exports:
- `getRuntimeState(stateDir): Promise<PersistedRuntimeState>` — reads `<stateDir>/runtime.json`; returns `{ lastIngestAt: null, lastError: null }` if missing/unreadable.
- `uploadWithRetry(config, payload): Promise<UploadResult>` per RESEARCH.md Code Examples:

```typescript
import pRetry, { AbortError } from 'p-retry';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from './config.js';
import type { IngestPayload, PersistedRuntimeState } from './types.js';

const RUNTIME_FILE = 'runtime.json';

export interface UploadResult {
  meeting_id: string;
  vault_path: string;
  commit_sha: string;
}

async function readRuntime(stateDir: string): Promise<PersistedRuntimeState> {
  try {
    return JSON.parse(await fs.readFile(path.join(stateDir, RUNTIME_FILE), 'utf8'));
  } catch {
    return { lastIngestAt: null, lastError: null };
  }
}

async function writeRuntime(stateDir: string, state: PersistedRuntimeState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, RUNTIME_FILE);
  await fs.writeFile(`${target}.tmp`, JSON.stringify(state, null, 2));
  await fs.rename(`${target}.tmp`, target);
}

export async function getRuntimeState(stateDir: string): Promise<PersistedRuntimeState> {
  return readRuntime(stateDir);
}

export async function uploadWithRetry(config: Config, payload: IngestPayload): Promise<UploadResult> {
  const url = `${config.cortexApiUrl.replace(/\/$/, '')}/api/meetings/ingest`;
  try {
    const result = await pRetry<UploadResult>(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.sharedSecret}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 401) throw new AbortError('auth failed (401) — check sharedSecret');
        if (res.status === 400) {
          const text = await res.text().catch(() => '');
          throw new AbortError(`bad payload (400): ${text.slice(0, 500)}`);
        }
        if (!res.ok) throw new Error(`status ${res.status}`);
        return (await res.json()) as UploadResult;
      },
      {
        retries: 5,
        factor: 2,
        minTimeout: 60_000,
        maxTimeout: 1_800_000,
        onFailedAttempt: (err) => {
          console.warn(
            `[upload] attempt ${err.attemptNumber} failed: ${err.message}; ${err.retriesLeft} left`,
          );
        },
      },
    );
    await writeRuntime(config.stateDir, {
      lastIngestAt: new Date().toISOString(),
      lastError: null,
    });
    return result;
  } catch (err) {
    const errMsg = String(err);
    console.error(`[upload] terminal failure: ${errMsg}`);
    const prev = await readRuntime(config.stateDir);
    await writeRuntime(config.stateDir, {
      lastIngestAt: prev.lastIngestAt,
      lastError: errMsg.slice(0, 1900),   // server schema caps at 2000
    });
    throw err;
  }
}
```

Behavior contract:
- 401 / 400 → AbortError → no retry, immediately surfaces; lastError persisted.
- 5xx, network errors, timeouts → retried up to ~5 times with exponential backoff.
- Success → clears lastError, sets lastIngestAt.

**Create `cortex-local/src/watcher.ts`:**

Implement two named exports + `startWatcher`:
- `buildPayload(config, filePath, raw): IngestPayload` — parses gray-matter, extracts via `config.frontmatterFields.*`, falls back to filename basename for title, current ISO for timestamps, empty array for attendees, undefined external_id when absent.
- `processFile(config, filePath): Promise<void>` — hard-filter by `.md` extension (MEET-07), read file, build payload, skip if empty transcript, enqueue, call uploadWithRetry, on success dequeue + markIngested, on failure leave queued for next-boot drain.
- `startWatcher(config): Promise<void>` — first drains the persisted queue, then opens chokidar with `awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 }`, ignores `_ingested/` and dotfiles, `ignoreInitial: false`. On `add` event call `processFile(config, filePath)` (catch errors).

```typescript
// Skeleton — fill in per the contract above
import chokidar from 'chokidar';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import matter from 'gray-matter';
import type { Config } from './config.js';
import type { IngestPayload } from './types.js';
import { uploadWithRetry } from './client.js';
import { markIngested } from './ingest-marker.js';
import { drain, enqueue, dequeue } from './queue.js';

const ALLOWED_EXT = '.md';

export function buildPayload(config: Config, filePath: string, raw: string): IngestPayload {
  const { data, content } = matter(raw);
  const ff = config.frontmatterFields;
  const d = data as Record<string, unknown>;
  return {
    title: String(d[ff.title] ?? path.basename(filePath, '.md')),
    started_at: new Date((d[ff.startedAt] as string | undefined) ?? Date.now()).toISOString(),
    ended_at: new Date((d[ff.endedAt] as string | undefined) ?? Date.now()).toISOString(),
    attendees: Array.isArray(d[ff.attendees]) ? (d[ff.attendees] as string[]) : [],
    transcript: content.trim(),
    source: 'meetily',
    external_id: (d[ff.externalId] as string | undefined) || undefined,
  };
}

export async function processFile(config: Config, filePath: string): Promise<void> {
  if (path.extname(filePath).toLowerCase() !== ALLOWED_EXT) return;   // MEET-07 hard filter
  const raw = await fs.readFile(filePath, 'utf8').catch((err) => {
    console.error(`[watcher] cannot read ${filePath}: ${String(err)}`);
    return null;
  });
  if (raw === null) return;
  let payload: IngestPayload;
  try { payload = buildPayload(config, filePath, raw); }
  catch (err) { console.error(`[watcher] cannot build payload from ${filePath}: ${String(err)}`); return; }
  if (!payload.transcript || payload.transcript.length === 0) {
    console.warn(`[watcher] empty transcript in ${filePath}; skipping`);
    return;
  }
  await enqueue(config.stateDir, filePath, payload);
  try {
    const result = await uploadWithRetry(config, payload);
    await dequeue(config.stateDir, filePath);
    const newPath = await markIngested(filePath);
    console.log(`[watcher] ingested ${filePath} → ${newPath} (meeting=${result.meeting_id})`);
  } catch (err) {
    console.error(`[watcher] terminal upload failure for ${filePath}: ${String(err)}`);
    // Item stays in queue for next-boot drain attempt.
  }
}

export async function startWatcher(config: Config): Promise<void> {
  await drain(config.stateDir, async (item) => {
    await uploadWithRetry(config, item.payload);
    await markIngested(item.filePath).catch((err) => {
      console.warn(`[watcher] drain markIngested failed for ${item.filePath}: ${String(err)}`);
    });
  });

  const watcher = chokidar.watch(config.meetilyOutputDir, {
    ignored: (p: string) => p.includes('/_ingested/') || path.basename(p).startsWith('.'),
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 },
    ignoreInitial: false,
  });

  watcher.on('add', (filePath) => {
    processFile(config, filePath).catch((err) =>
      console.error(`[watcher] processFile threw for ${filePath}: ${String(err)}`),
    );
  });
  watcher.on('error', (err) => console.error('[chokidar]', err));

  console.log(`[watcher] watching ${config.meetilyOutputDir} (stable after 5s)`);
}
```

**Create `cortex-local/src/heartbeat.ts`** (RESEARCH.md Pattern 8):

Exports `pingHeartbeat(config)` and `startHeartbeat(config)`. The cron is registered with explicit `timezone: 'UTC'` (RESEARCH.md Pitfall 6). On boot, if persisted `lastHeartbeatAt` is missing or >24h old, fire one ping immediately (catch errors — don't crash boot).

```typescript
import cron from 'node-cron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from './config.js';
import type { HeartbeatState } from './types.js';
import { getRuntimeState } from './client.js';
import { depth } from './queue.js';

const HEARTBEAT_FILE = 'heartbeat.json';
const PKG_VERSION = '0.1.0';   // bump alongside package.json on release

async function readState(stateDir: string): Promise<HeartbeatState | null> {
  try { return JSON.parse(await fs.readFile(path.join(stateDir, HEARTBEAT_FILE), 'utf8')); }
  catch { return null; }
}
async function writeState(stateDir: string, state: HeartbeatState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, HEARTBEAT_FILE);
  await fs.writeFile(`${target}.tmp`, JSON.stringify(state, null, 2));
  await fs.rename(`${target}.tmp`, target);
}

export async function pingHeartbeat(config: Config): Promise<void> {
  const runtime = await getRuntimeState(config.stateDir);
  const queueDepth = await depth(config.stateDir);
  const url = `${config.cortexApiUrl.replace(/\/$/, '')}/api/heartbeat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.sharedSecret}`,
    },
    body: JSON.stringify({
      host: config.host,
      version: PKG_VERSION,
      last_ingest_at: runtime.lastIngestAt,
      queue_depth: queueDepth,
      last_error: runtime.lastError,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`heartbeat ${res.status}`);
  await writeState(config.stateDir, { lastHeartbeatAt: new Date().toISOString() });
  console.log(`[heartbeat] ok (queue=${queueDepth}, lastErr=${runtime.lastError ? 'yes' : 'no'})`);
}

export async function startHeartbeat(config: Config): Promise<void> {
  const state = await readState(config.stateDir);
  const lastMs = state ? new Date(state.lastHeartbeatAt).getTime() : 0;
  if (Date.now() - lastMs > 24 * 60 * 60 * 1000) {
    pingHeartbeat(config).catch((err) =>
      console.error(`[heartbeat] catch-up ping failed: ${String(err)}`),
    );
  }
  cron.schedule(
    config.heartbeatCron,
    () => {
      pingHeartbeat(config).catch((err) =>
        console.error(`[heartbeat] scheduled ping failed: ${String(err)}`),
      );
    },
    { timezone: 'UTC' },
  );
  console.log(`[heartbeat] cron registered: "${config.heartbeatCron}" UTC`);
}
```

**Create `cortex-local/src/index.ts`:**

```typescript
import { loadConfig } from './config.js';
import { startWatcher } from './watcher.js';
import { startHeartbeat } from './heartbeat.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  console.log(`[cortex-local] starting; host=${config.host}; watching=${config.meetilyOutputDir}`);
  await startWatcher(config);
  await startHeartbeat(config);
}

main().catch((err) => {
  console.error('[cortex-local] FATAL:', err);
  process.exit(1);
});
```

**Create `cortex-local/tests/watcher.test.ts`:**

vitest. Mock `chokidar`, `./client.js`, `./ingest-marker.js`, `./queue.js`. Test:
1. `buildPayload` extracts title/started_at/ended_at/attendees/transcript correctly from a fixture frontmatter+body string
2. `buildPayload` falls back to filename basename when title field is missing
3. `buildPayload` honors explicit `frontmatterFields` overrides (e.g., `title: 'meeting_name'`)
4. `processFile` returns immediately for non-`.md` extensions (MEET-07 hard filter — assert uploadWithRetry NOT called for `.opus`, `.ogg`, `.wav`, `.mp3`, `.m4a`)
5. `processFile` skips files with empty transcript
6. `processFile` calls enqueue → uploadWithRetry → dequeue → markIngested in order on success
7. `processFile` does NOT call markIngested when uploadWithRetry throws (item stays in queue)

**Create `cortex-local/tests/client.test.ts`:**

vitest. Use `vi.stubGlobal('fetch', vi.fn())`. Test:
1. 200 OK → returns parsed JSON; writes runtime state with `lastIngestAt` set, `lastError: null`
2. 401 → throws AbortError immediately (fetch called exactly once); writes `lastError` populated
3. 400 → throws AbortError immediately; fetch called exactly once
4. 500 then 200 → eventually succeeds (use `mockResolvedValueOnce({ ok: false, status: 500, ... }).mockResolvedValueOnce({ ok: true, status: 200, json: ... })`); to keep test fast, override `minTimeout` via a test-only constant or `vi.useFakeTimers` + advance
5. Repeated 500 → throws after retries exhausted; writes `lastError`
6. Network error (fetch throws) → retried
7. Authorization header is exactly `Bearer <sharedSecret>`

**Create `cortex-local/tests/heartbeat.test.ts`:**

vitest. Mock `node-cron` with `vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }))`. Mock `fetch`. Test:
1. `pingHeartbeat` POSTs to `${cortexApiUrl}/api/heartbeat` with expected JSON body and Bearer header; on 200 OK writes heartbeat.json
2. `pingHeartbeat` includes `queue_depth` from queue.depth() and `last_error` from runtime state
3. `startHeartbeat` calls pingHeartbeat immediately when heartbeat.json missing
4. `startHeartbeat` calls pingHeartbeat immediately when lastHeartbeatAt is >24h old
5. `startHeartbeat` does NOT call pingHeartbeat immediately when lastHeartbeatAt is <24h old
6. `cron.schedule` called with the cron expression from config and `{ timezone: 'UTC' }`

**Build and verify:**
```bash
cd cortex-local && npm run build && npm test
```
Both must succeed; build emits `dist/index.js`.

**Create `cortex-local/scripts/com.cortex.local.plist.tmpl`** (RESEARCH.md Pattern 5):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cortex.local</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE_BIN__</string>
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
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>__HOME__/Library/Logs/cortex-local.out.log</string>
  <key>StandardErrorPath</key>
  <string>__HOME__/Library/Logs/cortex-local.err.log</string>
</dict>
</plist>
```

**Create `cortex-local/scripts/install.sh`** (interactive bash installer per RESEARCH.md Pattern 5):

The script should:
1. Resolve absolute `node` path via `command -v node`; abort if Node < 20.
2. Create `INSTALL_DIR=$HOME/.cortex-local`, `CONFIG_DIR=$HOME/Library/Application Support/cortex-local`, `STATE_DIR=$CONFIG_DIR/state`, `LOG_DIR=$HOME/Library/Logs`.
3. Run `npm install` and `npm run build` from the cortex-local subproject.
4. Copy `dist/`, `node_modules/`, `package.json` to `INSTALL_DIR`.
5. Check Keychain for the shared secret; if missing, prompt with `read -rsp` (silent), validate length ≥ 32, store with `security add-generic-password -U -s cortex-local -a shared-secret -w "$SECRET"`.
6. Read the secret from Keychain (so install.sh works even when only restoring config from existing Keychain entry).
7. If `$CONFIG_DIR/config.json` doesn't exist, prompt for cortex API URL, Meetily output dir (expand `~`), hostname; write the JSON config with `chmod 600`. Reuse existing config on re-run.
8. Render plist template via `sed` substituting `__NODE_BIN__`, `__INSTALL_DIR__`, `__CONFIG_PATH__`, `__HOME__` — output to `~/Library/LaunchAgents/com.cortex.local.plist`.
9. Bootstrap the agent: try `launchctl bootstrap gui/$(id -u) "$PLIST_DST"`; on failure fall back to `launchctl load -w "$PLIST_DST"`. Bootout/unload first to handle re-install.
10. Print final status: log paths, status command, config path, state dir.

Use `set -euo pipefail` at the top. Make executable with `chmod +x`.

**Create `cortex-local/scripts/uninstall.sh`:**

`launchctl bootout gui/$(id -u)/com.cortex.local || launchctl unload -w "$PLIST_DST" || true`; `rm -f "$PLIST_DST"`; prompt to remove `INSTALL_DIR`; print note that config + state at `~/Library/Application Support/cortex-local` and the Keychain entry are kept (with the `security delete-generic-password` command to remove the Keychain entry manually).

```bash
chmod +x cortex-local/scripts/install.sh cortex-local/scripts/uninstall.sh
```

**Create `cortex-local/README.md`** with sections:
1. **What it does** — one-paragraph summary; link back to ROADMAP Phase 7b and HLD §3.8.
2. **Prerequisites** — Node ≥ 20, Meetily installed, meetily-exporter (recommended) or any source that writes markdown with YAML frontmatter to a known directory; the Fly-side `CORTEX_LOCAL_SHARED_SECRET` already set (link to plan 07b-01).
3. **Install** — `cd cortex-local && bash scripts/install.sh`; describe each prompt and where things land.
4. **Verify** — `launchctl print gui/$(id -u)/com.cortex.local | head`; log paths; expected first log lines (`[cortex-local] starting…`, `[watcher] watching…`, `[heartbeat] cron registered…`).
5. **Dry-run** — `npm run dry-run -- /absolute/path/to/sample.md`; explains use case (validating frontmatter field names against actual Meetily output BEFORE going live, per RESEARCH.md Open Question 1).
6. **Custom frontmatter field names** — show `frontmatterFields` config block; call out `meeting-id` (meetily-exporter default) vs other tools.
7. **Heartbeat** — daily 9 UTC; how to verify on cortex side; what `last_error` surfaces.
8. **Recovery** — what happens if the daemon dies mid-upload (queue.json drains on next boot); what happens if user moves a file out of `_ingested/` (server idempotency on `external_id` returns existing record).
9. **Uninstall** — `bash scripts/uninstall.sh`; how to also remove Keychain entry.
10. **Troubleshooting** — common failure modes from RESEARCH.md Pitfalls (PATH not inherited by launchd → use absolute node bin in plist; ThrottleInterval=30 for crash loops; awaitWriteFinish stabilityThreshold=5000 for partial-read failures; 401 → wrong secret in Keychain; 413 → server-side body parser limit needs raising).

**Final build + test before checkpoint:**
```bash
cd cortex-local && npm run build && npm test
```
  </action>
  <verify>
    <automated>cd cortex-local &amp;&amp; npm run build 2>&amp;1 | tail -10 &amp;&amp; npm test 2>&amp;1 | tail -30 &amp;&amp; test -x scripts/install.sh &amp;&amp; test -x scripts/uninstall.sh &amp;&amp; sh -n scripts/install.sh &amp;&amp; sh -n scripts/uninstall.sh &amp;&amp; test -f scripts/com.cortex.local.plist.tmpl &amp;&amp; test -f README.md &amp;&amp; test -f dist/index.js</automated>
  </verify>
  <done>cortex-local/dist/index.js bundled successfully; all vitest suites pass (config + queue + ingest-marker from Task 1, plus watcher + client + heartbeat); install.sh + uninstall.sh are executable and pass `sh -n` syntax check; plist template + README exist; daemon is end-to-end runnable via `npm run dev` for local iteration.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Human checkpoint — install Meetily + meetily-exporter, run install.sh, dry-run + live-meeting smoke test</name>
  <files>(no code changes — verification only)</files>
  <action>
This task is a human verification checkpoint. Claude does NOT attempt automation — installing Meetily, capturing real audio on the Mac mini, joining a Google Meet, and observing launchd behavior are all user-bound operations.

The user runs the steps in `<how-to-verify>` to:
1. Install Meetily on the Mac mini (or confirm it's already installed).
2. Install meetily-exporter (the proven adapter recommended by RESEARCH.md) and configure it to write to a known directory.
3. Run `cortex-local/scripts/install.sh` on the Mac mini, providing the same `CORTEX_LOCAL_SHARED_SECRET` that was set on Fly.io in plan 07b-01.
4. Confirm launchd loaded the agent and the daemon is running (initial log lines visible).
5. Run `npm run dry-run` against an actual Meetily export to validate frontmatter field names BEFORE going live (the MEDIUM-confidence unknown from RESEARCH.md Open Question 1).
6. Capture a real (or test) Google Meet, wait for Meetily to write the transcript, and observe the file land in `nirvana-wiki/raw/meetings/...` on GitHub plus a Telegram notification arrive.
7. Verify `/vault recent` on Telegram lists the new meeting (VAULT-06 polymorphism observable end-to-end).
8. Tap a heartbeat verification: stop the daemon for >26h (or manually mark a heartbeat row as stale via the DB) and confirm the staleness alert fires.

Type "approved" once all checks pass, or describe failures so we can adjust before declaring Phase 7b complete.
  </action>
  <verify>
    <automated>MISSING — this is a human-verify checkpoint; verification is the &lt;how-to-verify&gt; checklist below, confirmed by user typing "approved"</automated>
  </verify>
  <done>User has confirmed via "approved": (a) Meetily + meetily-exporter installed on the Mac mini and writing markdown to the watched directory; (b) `bash cortex-local/scripts/install.sh` ran cleanly, secret stored in Keychain, plist bootstrapped; (c) `launchctl print gui/$(id -u)/com.cortex.local` shows the agent running, no crash-loop in `~/Library/Logs/cortex-local.err.log`; (d) `npm run dry-run` against an actual Meetily export produced a valid IngestPayload (no missing frontmatter fields); (e) end-to-end smoke: a captured meeting landed at `nirvana-wiki/raw/meetings/YYYY-MM-DD-{slug}.md` on GitHub with the correct header (Source/Date/Started/Ended/Attendees) and verbatim transcript, AND the measured time-from-file-write to commit-on-main is ≤ 30 seconds (computed from `stat`/`ls -la` and `gh api .../commits/main`); (f) Telegram bot DM `Meeting captured: "<title>" (<duration>, <N> attendees) → <vault path>` arrived; (g) `/vault recent` on Telegram lists the meeting alongside any prior notes; (h) heartbeat staleness alert verified (either by 26h+ daemon downtime or by manually backdating the Heartbeat row's lastSeenAt and triggering the cron worker); (i) MEET-07 invariant audit: confirmed via `fly logs` and Mac-side logs that no audio file extensions appear in any payload, no audio bytes leave the Mac.</done>
  <what-built>
- A standalone `cortex-local/` TypeScript daemon: chokidar watcher with 5s file-stable detection, native fetch + p-retry exponential backoff (up to ~1h), persisted JSON queue (`queue.json`) for crash survivability, daily heartbeat via node-cron with on-boot catch-up, persisted `runtime.json` (lastIngestAt + lastError) and `heartbeat.json` (lastHeartbeatAt) state.
- launchd User Agent plist (KeepAlive, RunAtLoad, ThrottleInterval=30, explicit PATH, log files in `~/Library/Logs/`).
- Interactive bash install.sh: stores shared secret in macOS Keychain, prompts for cortex URL + Meetily output dir + hostname, renders plist with absolute paths, bootstraps the agent.
- README + dry-run mode for validating Meetily frontmatter field names before going live.

Server side from plan 07b-01: `POST /api/meetings/ingest` (Zod-validated, SharedSecretGuard with 401 on auth failure), `POST /api/heartbeat` (with MEET-06 lastError change-detection that fires sendUploadFailed on transition), daily pg-boss cron firing `sendHeartbeatStale` Telegram DMs when last_seen_at > 26h, body parser raised to 5 MB, NotificationService.sendMeetingCaptured implementing the MEET-05 message format.

The whole thing is ready to wire to Meetily; everything except the live meeting capture has been unit-tested. This checkpoint is the only thing that proves the Meetily output contract is what we assume it is — a MEDIUM-confidence item from RESEARCH.md.
  </what-built>
  <how-to-verify>
**Pre-flight (one-time, on the Mac mini):**

1. **Install Meetily** if not already present. Follow https://github.com/Zackriya-Solutions/meetily — download the macOS app, grant microphone + screen-recording permissions, do one short test recording to confirm it transcribes successfully.

2. **Install meetily-exporter** (the recommended adapter):
   ```bash
   npm i -g meetily-exporter
   ```
   Run it once with `--watch` mode pointed at the directory cortex-local will watch. Recommended location: `~/Documents/Meetily/exports`. Example:
   ```bash
   mkdir -p ~/Documents/Meetily/exports
   meetily-exporter --watch --output ~/Documents/Meetily/exports
   # Leave this running in a background terminal or tmux session;
   # alternatively wrap meetily-exporter in its own launchd agent.
   ```
   If meetily-exporter doesn't suit your setup, use any tool that writes Meetily transcripts as `*.md` files with a YAML frontmatter block to a single directory.

**Install cortex-local:**

3. From the cortex repo root on the Mac mini:
   ```bash
   cd cortex-local
   bash scripts/install.sh
   ```
   Provide when prompted:
   - **Cortex API URL**: `https://cortex-hindole.fly.dev` (or your Fly app URL)
   - **Meetily/exporter output directory**: `~/Documents/Meetily/exports` (or wherever meetily-exporter writes — must be the absolute path; `~` is expanded by the script)
   - **Hostname label**: `mac-mini-home` (any short identifier)
   - **Cortex shared secret**: paste the SAME value you set for `CORTEX_LOCAL_SHARED_SECRET` on Fly.io in plan 07b-01. The script stores it in Keychain so subsequent install.sh runs don't prompt.

4. **Confirm launchd loaded the agent:**
   ```bash
   launchctl print gui/$(id -u)/com.cortex.local | head -30
   tail -f ~/Library/Logs/cortex-local.out.log
   ```
   Expected first log lines:
   - `[cortex-local] starting; host=mac-mini-home; watching=/Users/.../Meetily/exports`
   - `[watcher] watching /Users/.../Meetily/exports (stable after 5s)`
   - `[heartbeat] cron registered: "0 9 * * *" UTC`

   Check `~/Library/Logs/cortex-local.err.log` is empty (or only contains noise from chokidar startup). If it shows `node: command not found` → the plist's `__NODE_BIN__` substitution failed; re-run install.sh. If it shows constant restart cycles → ThrottleInterval is failing (rare); inspect the err log for the underlying crash reason.

**Dry-run smoke (validates the Meetily-output contract — RESEARCH.md Open Question 1):**

5. Capture one short test meeting in Meetily so meetily-exporter writes one `.md` file. Then dry-run:
   ```bash
   cd ~/path/to/cortex/cortex-local
   npm run dry-run -- ~/Documents/Meetily/exports/<your-test-meeting>.md
   ```
   Expected output:
   - The parsed frontmatter (title, started_at, ended_at, attendees, meeting-id) — confirm all fields are present and non-null.
   - The IngestPayload that WOULD be POSTed.

   **If any expected frontmatter field is missing or has a different name** (e.g., `started` instead of `started_at`): edit `~/Library/Application Support/cortex-local/config.json` and add a `frontmatterFields` block:
   ```json
   {
     "frontmatterFields": {
       "title": "title",
       "startedAt": "started",
       "endedAt": "ended",
       "attendees": "attendees",
       "externalId": "meeting-id"
     }
   }
   ```
   Then `launchctl bootout gui/$(id -u)/com.cortex.local && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortex.local.plist` to reload the daemon.

**Live end-to-end smoke (with measured 30-second SLA):**

6. Capture a short (~2 min) test meeting in Meetily — can be a solo Google Meet you join from another device, or just a Meetily test recording.

7. **Measure the SLA explicitly (do not eyeball)**:
   - **Step A — Capture the file-write timestamp on the Mac mini.** As soon as Meetily/meetily-exporter has written the markdown file, run:
     ```bash
     # Replace <FILE> with the actual path under ~/Documents/Meetily/exports/
     ls -la <FILE>
     stat -f "%Sm  (%m epoch)" -t "%Y-%m-%dT%H:%M:%SZ" <FILE>   # ISO + epoch
     ```
     Record the modification time (e.g. `2026-04-26T18:42:11Z`).
   - **Step B — Capture the GitHub commit timestamp.** After ~30 seconds (give the daemon time to detect, wait the 5s stability window, POST, and let cortex commit + push), run:
     ```bash
     gh api repos/<your-user>/nirvana-wiki/commits/main --jq '.commit.committer.date'
     ```
     This returns an ISO 8601 timestamp like `2026-04-26T18:42:36Z`.
   - **Step C — Compute the diff.** Subtract Step A from Step B:
     - **PASS:** delta ≤ 30 seconds → record the actual delta in the SUMMARY (e.g. "measured: 25s file-write → commit").
     - **FAIL:** delta > 30 seconds → STOP. Document the breakdown (chokidar detect time, server commit time, push time) in the SUMMARY and treat as an open regression for Phase 7b. Common causes: chokidar's `awaitWriteFinish` 5s + slow push to GitHub; server queue contention; large transcript over slow uplink. If the delta is consistently >30s for normal-sized transcripts (50-200KB), open a follow-up plan to revisit `awaitWriteFinish` timing or the vault-write batching.
   - **Also verify** during this window:
     - File appears at https://github.com/<your-user>/nirvana-wiki/tree/main/raw/meetings as `YYYY-MM-DD-{title-slug}.md` with correct header (Source: Meetily (Google Meet) / Date / Started / Ended / Attendees) and verbatim transcript body.
     - Telegram bot DM arrives: `📝 Meeting captured: "<title>" (<duration>, <N> attendees) → raw/meetings/...`
     - The source file in `~/Documents/Meetily/exports/` has been moved to `~/Documents/Meetily/exports/_ingested/`.

8. From Telegram: send `/vault recent`. The new meeting should appear at the top with ✅, alongside any prior notes from Phase 7a. (This is VAULT-06 — already polymorphic in 7a, observably satisfied here.)

**Failure-mode smoke (one-shot proofs):**

9. **Auth failure**: temporarily corrupt the secret in `~/Library/Application Support/cortex-local/config.json` (change one character), `launchctl bootout` + `bootstrap` to reload, capture a meeting. Expected: log shows `[upload] terminal failure: auth failed (401)`; runtime.json has `lastError` populated; restore the correct secret and reload before continuing.

10. **MEET-06 escalation chain (server-side surfacing of daemon's lastError)**: While the daemon still has the corrupted secret from step 9, wait for it to attempt one heartbeat (or manually trigger one by `launchctl bootout` + `bootstrap`). Expected: cortex receives a heartbeat with `last_error` populated; HeartbeatService.upsert detects the null→string transition; Telegram DM arrives: `⚠ cortex-local upload failed — Host: mac-mini-home, Last error: auth failed (401) ... Meeting capture is paused. Investigate the daemon log on the Mac mini.` Restore the secret, restart the daemon, capture a successful meeting; on the NEXT heartbeat, runtime.json's lastError is null → cortex stores null → no further DM (single-fire on transition, not on every healthy ping).

11. **Idempotency**: move one file from `_ingested/` back to the watch dir. Expected: cortex returns 200 with the existing `meeting_id` (no duplicate vault commit); log shows the duplicate-ingest log line on the cortex side (`Duplicate ingest external_id=...`).

12. **Heartbeat staleness alert**: either (preferred for time) connect to the cortex Postgres and `UPDATE heartbeats SET last_seen_at = NOW() - INTERVAL '30 hours' WHERE host = 'mac-mini-home';`, then manually trigger the staleness check via `psql` or wait for the next 9 UTC cron tick. Expected: Telegram DM `⚠️ cortex-local silent — mac-mini-home hasn't checked in for 30 hours`.

**Confirm or report:**

Type `approved` once steps 4–12 succeed. If any step fails, capture the relevant logs (`fly logs -a cortex-hindole`, `~/Library/Logs/cortex-local.err.log`, `~/Library/Logs/cortex-local.out.log`) and describe the failure so we can fix before declaring Phase 7b complete. Specifically include the measured SLA delta from step 7 in the SUMMARY.
  </how-to-verify>
  <resume-signal>Type "approved" once the live meeting end-to-end smoke succeeds (with measured SLA ≤ 30s) and the MEET-06 escalation DM is verified, or describe failures.</resume-signal>
</task>

</tasks>

<verification>
- `cd cortex-local && npm run build` produces `dist/index.js` with zero TypeScript errors.
- `cd cortex-local && npm test` passes for: config (env/path validation, schema validation, defaults), queue (atomic write, dedupe, drain), ingest-marker (atomic mv to `_ingested/`, deterministic overwrite), watcher (buildPayload extraction, MEET-07 extension filter, processFile order), client (401/400 abort, retry on 5xx, runtime state writes), heartbeat (catch-up on boot, daily cron with UTC timezone).
- `cortex-local/scripts/install.sh` and `uninstall.sh` are executable; both pass `sh -n` syntax check.
- `cortex-local/scripts/com.cortex.local.plist.tmpl` exists with required keys (Label, ProgramArguments, KeepAlive=true, RunAtLoad=true, ThrottleInterval=30, EnvironmentVariables.PATH, log paths).
- Root `.dockerignore` has `cortex-local` line so the Fly image excludes the daemon.
- VaultService is NOT modified (plan reuses it via the server-side endpoints from 07b-01).
- Human checkpoint (Task 3): Meetily + meetily-exporter installed, install.sh ran, dry-run validated frontmatter field names, live meeting captured end-to-end with measured ≤30s SLA from `stat` to `gh api commits/main`, MEET-06 escalation DM verified, heartbeat staleness alert verified.
</verification>

<success_criteria>
- MEET-01 (cortex-local under launchd watching Meetily output): User Agent plist at `~/Library/LaunchAgents/com.cortex.local.plist`, KeepAlive + RunAtLoad + ThrottleInterval=30, watching `meetilyOutputDir` from config ✅
- MEET-02 (5s file stability + POST): chokidar.watch with `awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 }`; on `add` parse + POST to `/api/meetings/ingest` ✅
- MEET-06 (exponential backoff up to 1h, then notify): p-retry retries=5, factor=2, minTimeout=60s, maxTimeout=30m; on terminal failure persist `lastError` so the next heartbeat surfaces it via cortex's HeartbeatService.upsert lastError-transition detector → sendUploadFailed Telegram DM ✅
- MEET-07 (audio never leaves Mac, daemon side): `.md` extension hard-filter at the top of `processFile`; dry-run shows no audio fields in payload; payload schema accepts only text fields ✅
- MEET-09 (daemon side — daily heartbeat + boot catch-up): node-cron `0 9 * * *` UTC; persisted `lastHeartbeatAt`; if missing or >24h stale on boot, fire one ping immediately ✅
- Crash survivability: `queue.json` (pending uploads) and `runtime.json` (lastIngestAt + lastError) and `heartbeat.json` (lastHeartbeatAt) all atomic-written; daemon drains queue on boot before listening ✅
- Phase 7b end-to-end success criteria from ROADMAP.md (all 8) verified by checkpoint:
  - SC-1: transcript at `raw/meetings/YYYY-MM-DD-{title-slug}.md` within measured ≤30s (asserted via `stat` + `gh api`) ✅
  - SC-2: verbatim transcript + correct header ✅
  - SC-3: Telegram notification with title/duration/N attendees/path ✅
  - SC-4: audio never leaves Mac ✅
  - SC-5: 1h retry + Telegram alert on terminal failure (via MEET-06 escalation chain) ✅
  - SC-6: `/vault recent` lists meetings + notes ✅
  - SC-7: workspace=Work always ✅ (asserted server-side in 07b-01 tests)
  - SC-8: daily heartbeat + 26h staleness Telegram alert ✅
</success_criteria>

<output>
After completion, create `.planning/phases/07b-meeting-capture/07b-02-SUMMARY.md` summarizing:
- New `cortex-local/` subproject layout (sibling, own package.json, type:module, ESM, Node20 target; tsup bundle)
- Source modules: index/config/types/watcher/client/queue/heartbeat/ingest-marker/dry-run; how each maps to the requirements
- launchd plist + install/uninstall scripts; macOS Keychain integration
- Crash-survivability triad: queue.json (pending uploads) + runtime.json (lastIngestAt + lastError) + heartbeat.json (lastHeartbeatAt) — all atomic-written; drain on boot
- Frontmatter-field-name flexibility (RESEARCH.md Open Question 1) — config block allows the user to map cortex-local's expected keys to whatever meetily-exporter (or whatever adapter they ended up with) produces
- Dry-run mode: validates the Meetily contract against actual user output before going live
- 401/400 → AbortError; 5xx/network → retry; on terminal failure surface via heartbeat lastError field (daemon has no Telegram token of its own); cortex's MEET-06 escalation chain (HeartbeatService.upsert lastError-transition detector → sendUploadFailed) closes the loop
- launchctl bootstrap (modern) with load -w fallback (legacy)
- Root .dockerignore updated so Fly image excludes the daemon
- Smoke-test outcomes from the human checkpoint (Meetily install path, exact frontmatter field names that worked, any field-name overrides applied, **measured SLA delta from file-write to GitHub commit**, MEET-06 escalation DM verification result)
- Deviations from RESEARCH.md and rationale
- Phase 7b traceability: every requirement (MEET-01..09 + VAULT-06) → which plan / which artifact
</output>
