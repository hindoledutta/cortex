---
phase: 07a-note-capture
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - prisma/schema.prisma
  - prisma/migrations
  - src/vault/vault.module.ts
  - src/vault/vault.service.ts
  - src/vault/vault.types.ts
  - src/vault/vault.service.spec.ts
  - src/note/note.module.ts
  - src/note/note.service.ts
  - src/note/note.service.spec.ts
  - src/app.module.ts
  - package.json
  - package-lock.json
  - fly.toml
  - Dockerfile
  - scripts/entrypoint.sh
  - .env.example
autonomous: false
requirements:
  - VAULT-01
  - VAULT-02
  - VAULT-03
  - VAULT-04
  - VAULT-05

user_setup:
  - service: github-nirvana-wiki
    why: "Cortex must be able to push to the user's nirvana-wiki repo via SSH deploy key."
    env_vars:
      - name: NIRVANA_WIKI_REPO_URL
        source: "GitHub repo SSH URL, e.g. git@github.com:hindole/nirvana-wiki.git (set via fly secrets set)"
      - name: NIRVANA_WIKI_DEPLOY_KEY_B64
        source: "base64 -w0 of an SSH private key. Generate with `ssh-keygen -t ed25519 -f ~/.ssh/cortex_deploy_key -C cortex-bot -N ''`. Public key (~/.ssh/cortex_deploy_key.pub) added to the nirvana-wiki repo as a Deploy Key with WRITE access. Then `base64 -w0 ~/.ssh/cortex_deploy_key` and set as fly secret."
      - name: NIRVANA_WIKI_LOCAL_DIR
        source: "Local clone path on Fly volume — set to /data/nirvana-wiki"
      - name: NIRVANA_WIKI_SSH_KEY_PATH
        source: "Path entrypoint writes the materialized key to — set to /data/cortex-key"
    dashboard_config:
      - task: "Add deploy key to nirvana-wiki repo with WRITE access"
        location: "GitHub → nirvana-wiki repo → Settings → Deploy keys → Add deploy key (paste public key, check 'Allow write access')"
      - task: "Create Fly.io persistent volume cortex_vault (1 GB) in primary_region (sin)"
        location: "Run on dev machine: `fly volume create cortex_vault --region sin --size 1 -a cortex-hindole`"
      - task: "Set Fly secrets (one-time)"
        location: "Run on dev machine: `fly secrets set NIRVANA_WIKI_REPO_URL=git@github.com:hindole/nirvana-wiki.git NIRVANA_WIKI_DEPLOY_KEY_B64=\"$(base64 -w0 ~/.ssh/cortex_deploy_key)\" NIRVANA_WIKI_LOCAL_DIR=/data/nirvana-wiki NIRVANA_WIKI_SSH_KEY_PATH=/data/cortex-key -a cortex-hindole`"

must_haves:
  truths:
    - "Cortex maintains a working clone of nirvana-wiki on a Fly.io persistent volume that survives redeploys"
    - "Calling VaultService.writeFile() writes a verbatim file to raw/inbox/ and pushes a commit signed cortex-bot <bot@cortex.local> to the GitHub remote"
    - "Concurrent writeFile() calls execute serially (single-writer mutex), never producing a dirty index or interleaved git operations"
    - "Any write attempt outside raw/inbox/ or raw/meetings/ throws synchronously before touching disk or git"
    - "Every writeFile() call — whether it succeeds or throws — produces exactly one VaultWrite audit row"
    - "On push conflict, VaultService retries once after fetch+rebase; on second failure it persists a failed VaultWrite and surfaces the error"
    - "The bootstrap clone runs idempotently on first boot (empty volume) and is a no-op on subsequent boots"
  artifacts:
    - path: "prisma/schema.prisma"
      provides: "Note + VaultWrite Prisma models with workspace FK and audit-log columns"
      contains: "model Note"
    - path: "src/vault/vault.service.ts"
      provides: "VaultService — clone bootstrap, writeFile under mutex, revertLastCommit, path-prefix guard, audit-log writes"
      min_lines: 200
    - path: "src/vault/vault.module.ts"
      provides: "NestJS module exporting VaultService for use by NoteModule and (later) MeetingsModule"
      exports: ["VaultModule"]
    - path: "src/note/note.service.ts"
      provides: "NoteService — create(), softDelete(), recent() — domain operations on the Note model"
      min_lines: 40
    - path: "fly.toml"
      provides: "Persistent volume mount declaration for /data"
      contains: "[[mounts]]"
    - path: "Dockerfile"
      provides: "Adds git + openssh-client to runtime image and runs entrypoint to materialize SSH key"
      contains: "openssh-client"
    - path: "scripts/entrypoint.sh"
      provides: "Decodes NIRVANA_WIKI_DEPLOY_KEY_B64 to NIRVANA_WIKI_SSH_KEY_PATH with chmod 600 then execs node"
    - path: "src/vault/vault.service.spec.ts"
      provides: "Unit tests for path-prefix guard, mutex serialization (smoke), audit-log row insertion on success and failure"
      min_lines: 60
  key_links:
    - from: "src/vault/vault.service.ts"
      to: "node_modules/simple-git"
      via: "simpleGit(vaultDir).env('GIT_SSH_COMMAND', sshCommand)"
      pattern: "simpleGit\\([^)]+\\)\\s*\\.env\\(['\"]GIT_SSH_COMMAND"
    - from: "src/vault/vault.service.ts"
      to: "node_modules/async-mutex"
      via: "this.mutex.runExclusive(async () => { fetch -> reset -> write -> commit -> push })"
      pattern: "mutex\\.runExclusive"
    - from: "src/vault/vault.service.ts"
      to: "prisma.vaultWrite"
      via: "always insert VaultWrite row in try/finally — succeeded boolean + error string"
      pattern: "prisma\\.vaultWrite\\.create"
    - from: "scripts/entrypoint.sh"
      to: "/data/cortex-key"
      via: "base64 -d > path && chmod 600 path"
      pattern: "chmod\\s+600"
    - from: "fly.toml"
      to: "/data"
      via: "[[mounts]] source = 'cortex_vault' destination = '/data'"
      pattern: "destination\\s*=\\s*['\"]/data['\"]"
---

<objective>
Build the foundation that all vault writes (notes now, meetings later) depend on: persist the Note + VaultWrite domain models, install the vault working clone on a Fly.io persistent volume, and expose a single VaultService with one mutex-serialized writeFile() / revertLastCommit() API that obeys the pull-rebase → write → commit → push protocol against the nirvana-wiki GitHub remote.

Purpose: Phase 7a (and 7b after it) cannot ship without a serialized, auditable, path-bounded git-write primitive. Centralizing this in one service prevents git knowledge from spreading across the codebase and makes the audit log impossible to forget.

Output:
- Two new Prisma models (Note, VaultWrite) + migration
- A new src/vault/ NestJS module with VaultService + bootstrap + types + unit tests
- A new src/note/ module with a thin NoteService (CRUD + soft delete + recent) for the next plan to consume
- Dockerfile + entrypoint.sh + fly.toml updates so the deployed image can SSH to GitHub and mounts the persistent volume
- .env.example documenting the four NIRVANA_WIKI_* variables
- A verified-on-Fly working clone after the human checkpoint
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
@.planning/phases/07a-note-capture/07a-RESEARCH.md
@prisma/schema.prisma
@fly.toml
@Dockerfile
@src/app.module.ts

<interfaces>
<!-- Existing exports the new code will consume. Use these directly — do not re-explore. -->

From src/prisma/prisma.service.ts:
```typescript
export class PrismaService extends PrismaClient implements OnModuleInit { ... }
// Inject and use as `this.prisma.note.create(...)`, `this.prisma.vaultWrite.create(...)`.
```

From src/workspace/workspace.service.ts:
```typescript
export class WorkspaceService {
  async getDefault(): Promise<Workspace>;        // throws if none
  async findByName(name: WorkspaceName): Promise<Workspace | null>;
  async findAll(): Promise<Workspace[]>;
}
// WorkspaceName enum: 'personal' | 'work'
```

Existing prisma model patterns (mirror these conventions exactly):
- camelCase field names with @map("snake_case_column")
- @@map("snake_case_table") for table name
- UUID primary keys: id String @id @default(uuid())
- Timestamps: createdAt DateTime @default(now()) @map("created_at")
- Workspace FK: workspaceId String @map("workspace_id"); workspace Workspace @relation(fields: [workspaceId], references: [id])

Existing fly.toml shape (we ADD the [[mounts]] block — do not rewrite):
```toml
app = 'cortex-hindole'
primary_region = 'sin'
[deploy]
  release_command = 'npx prisma migrate deploy'
[http_service]
  internal_port = 3000
  ...
[[vm]]
  memory = '1gb'
  ...
```

Existing Dockerfile multi-stage (we MODIFY the production stage to add git + openssh-client and the entrypoint):
```dockerfile
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npm install --no-save prisma tsx dotenv
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
```

Test runner: vitest (`npm test` runs `vitest run`). Spec files live next to source as *.spec.ts. Pattern from src/llm/classification.service.spec.ts.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add Note + VaultWrite Prisma models, generate migration</name>
  <files>prisma/schema.prisma, prisma/migrations/&lt;new&gt;/migration.sql</files>
  <action>
Add two models and one enum to `prisma/schema.prisma`. Place them after the existing `CalendarEvent` model. Mirror the camelCase + @map conventions used by every existing model.

1. Add enum `NoteSource` with values `text`, `voice`.
2. Add enum `VaultWriteKind` with values `note`, `meeting` (meeting will be used in Phase 7b — declare now to avoid a follow-up migration).
3. Add `model Note`:
   - id            String  @id @default(uuid())
   - workspaceId   String  @map("workspace_id")
   - workspace     Workspace @relation(fields: [workspaceId], references: [id])
   - source        NoteSource
   - body          String  // verbatim transcript or text
   - slug          String
   - vaultPath     String  @map("vault_path")
   - vaultCommitSha String? @map("vault_commit_sha")  // nullable until push succeeds
   - telegramMsgId BigInt? @map("telegram_msg_id")
   - createdAt     DateTime @default(now()) @map("created_at")
   - deletedAt     DateTime? @map("deleted_at")
   - @@index([workspaceId, deletedAt])
   - @@index([telegramMsgId])
   - @@map("notes")
4. Add `model VaultWrite`:
   - id          String  @id @default(uuid())
   - kind        VaultWriteKind
   - sourceId    String  @map("source_id")  // polymorphic — Note.id or Meeting.id; no FK
   - vaultPath   String  @map("vault_path")
   - commitSha   String? @map("commit_sha")  // null on failure
   - succeeded   Boolean
   - error       String?
   - createdAt   DateTime @default(now()) @map("created_at")
   - @@index([kind, sourceId])
   - @@index([createdAt])
   - @@map("vault_writes")
5. Add the inverse relation on `model Workspace`: add `notes Note[]` to the relations block (alongside existing `tasks Task[]` and `contacts Contact[]`).

Then generate the migration. Use the project's existing offline-diff pattern (Phase 01 STATE decision — "Migration SQL generated offline via prisma migrate diff since no local PostgreSQL available"):

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_add_note_and_vault_write
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/$(ls -1d prisma/migrations/*add_note_and_vault_write* | head -1)/migration.sql
```

Use Prisma 7 flag names (`--from-migrations` / `--to-schema-datamodel` per Phase 03 decision in STATE.md). If those exact flag names changed, run `npx prisma migrate diff --help` to confirm and adapt — do NOT use `--from-schema-datamodel` (that's deprecated).

Then regenerate the client:
```bash
npx prisma generate
```

Do NOT run `prisma migrate deploy` locally — there is no local Postgres. The release_command in fly.toml runs it on deploy.
  </action>
  <verify>
    <automated>npx prisma format && npx prisma generate && grep -q "model Note" prisma/schema.prisma && grep -q "model VaultWrite" prisma/schema.prisma && ls prisma/migrations/*add_note_and_vault_write*/migration.sql</automated>
  </verify>
  <done>schema.prisma contains Note + VaultWrite models; Workspace.notes back-relation present; one new migration directory exists with non-empty migration.sql; `npx prisma generate` succeeds and `src/generated/prisma/client/` re-emits with Note + VaultWrite types.</done>
</task>

<task type="auto">
  <name>Task 2: Install deps; build VaultModule (service + bootstrap + tests) and NoteModule</name>
  <files>package.json, package-lock.json, src/vault/vault.module.ts, src/vault/vault.service.ts, src/vault/vault.types.ts, src/vault/vault.service.spec.ts, src/note/note.module.ts, src/note/note.service.ts, src/note/note.service.spec.ts, src/app.module.ts</files>
  <action>
**Install dependencies:**
```bash
npm install simple-git@^3.28.0 async-mutex@^0.5.0 slug
npm install --save-dev @types/slug
```
(`slug` is the npm normalization library used by SlugService in plan 07a-02 but added here so all infra deps land together.)

**Create `src/vault/vault.types.ts`:**
```typescript
export interface WriteFileInput {
  vaultPath: string;     // MUST start with raw/inbox/ or raw/meetings/
  body: string;
  commitMessage: string;
  // For audit log
  kind: 'note' | 'meeting';
  sourceId: string;      // Note.id or Meeting.id
}

export interface WriteFileResult {
  commitSha: string;
  vaultPath: string;     // post-collision-resolution
}

export interface RevertResult {
  commitSha: string;
}
```

**Create `src/vault/vault.service.ts`** — implement exactly per RESEARCH.md "Pattern 1: VaultService as Single Serialization Point" with these requirements:

- `@Injectable()` class with `OnModuleInit`.
- Inject `ConfigService` and `PrismaService`.
- Hold `private readonly mutex = new Mutex()` (one shared instance per service instance).
- `private static readonly ALLOWED_PREFIXES = ['raw/inbox/', 'raw/meetings/']`.
- `private static readonly AUTHOR = 'cortex-bot <bot@cortex.local>'`.
- `private readyPromise!: Promise<void>` — assigned in onModuleInit, awaited at the top of every public method (defensive against startup races; see RESEARCH.md Pitfall 2).
- `onModuleInit()`:
  1. Read `NIRVANA_WIKI_LOCAL_DIR`, `NIRVANA_WIKI_SSH_KEY_PATH`, `NIRVANA_WIKI_REPO_URL` from ConfigService (throw if missing).
  2. Build `sshCommand = \`ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new\``.
  3. If `${vaultDir}/.git` does not exist, run `simpleGit().env('GIT_SSH_COMMAND', sshCommand).clone(repoUrl, vaultDir)`.
  4. Assign `this.git = simpleGit(vaultDir).env('GIT_SSH_COMMAND', sshCommand)`.
  5. Set `await this.git.addConfig('user.email', 'bot@cortex.local')` and `await this.git.addConfig('user.name', 'cortex-bot')` as belt-and-suspenders (--author per-commit is still authoritative).
  6. Resolve `readyPromise`.
- `async writeFile(input: WriteFileInput): Promise<WriteFileResult>`:
  1. `await this.readyPromise`.
  2. `this.assertAllowedPath(input.vaultPath)` (throw BEFORE acquiring mutex).
  3. Track `commitSha: string | null = null` and `finalPath: string | null = null` and `errorMsg: string | null = null` outside the mutex closure.
  4. Wrap in `try { ... await this.mutex.runExclusive(...) ... } catch (e) { errorMsg = String(e); throw; } finally { await prisma.vaultWrite.create({ data: { kind, sourceId, vaultPath: finalPath ?? input.vaultPath, commitSha, succeeded: errorMsg === null, error: errorMsg } }) }`.
  5. Inside the mutex closure (in this exact order):
     a. `await this.git.fetch()`
     b. `await this.git.reset(['--hard', 'origin/main'])`
     c. Resolve collision: `finalPath = await this.resolveCollision(input.vaultPath)`.
     d. `await fs.mkdir(path.dirname(absPath), { recursive: true })`.
     e. `await fs.writeFile(absPath, input.body, 'utf8')`.
     f. `await this.git.add(finalPath)`.
     g. `await this.git.commit(input.commitMessage, undefined, { '--author': VaultService.AUTHOR })`.
     h. Push with one retry: try `await this.git.push('origin', 'main')`; catch → `await this.git.fetch()`, `await this.git.pull('origin', 'main', { '--rebase': null })`, `await this.git.push('origin', 'main')`. If second push throws, let it propagate (the finally will record the failure).
     i. `commitSha = (await this.git.revparse(['HEAD'])).trim()`.
  6. Return `{ commitSha: commitSha!, vaultPath: finalPath! }`.
- `async revertLastCommit(expectedSha: string): Promise<RevertResult>`:
  1. `await this.readyPromise`.
  2. `await this.mutex.runExclusive(...)`:
     a. `await this.git.fetch()` then `await this.git.reset(['--hard', 'origin/main'])`.
     b. `const head = (await this.git.revparse(['HEAD'])).trim()`. If `head !== expectedSha`, throw `Error(\`HEAD is ${head}, expected ${expectedSha} — vault has moved on, cannot undo\`)`.
     c. `await this.git.raw(['revert', 'HEAD', '--no-edit'])`.
     d. `await this.git.push('origin', 'main')`.
     e. Return `{ commitSha: (await this.git.revparse(['HEAD'])).trim() }`.
  3. Audit-log the revert as a VaultWrite row too (kind: same as the original; sourceId: same; commitMessage: prefixed `revert: `; succeeded based on outcome).
- `private assertAllowedPath(p: string)`: throw if `!ALLOWED_PREFIXES.some(prefix => p.startsWith(prefix))` OR if `p.includes('..')`.
- `private async resolveCollision(desired)`: as in RESEARCH.md Pattern 1 — append `-2`, `-3`, etc. by checking fs.access in a loop.

DO NOT hold the mutex across LLM calls (RESEARCH.md anti-pattern). DO NOT use `git pull` instead of `git fetch + reset --hard` (HLD §3.9, RESEARCH.md anti-pattern). DO NOT skip the path-prefix check (VAULT-03).

**Create `src/vault/vault.module.ts`:**
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { VaultService } from './vault.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
```

**Create `src/vault/vault.service.spec.ts`** — vitest tests focused on what doesn't require a real git remote:
1. `assertAllowedPath` rejects paths not starting with `raw/inbox/` or `raw/meetings/` (test with `wiki/foo.md`, `../etc/passwd`, `raw/inbox/../../../tmp/x`).
2. `assertAllowedPath` accepts `raw/inbox/foo.md` and `raw/meetings/bar.md`.
3. With a mocked `simpleGit` (vi.mock) and mocked Prisma, `writeFile` calls in this order: `fetch`, `reset(['--hard','origin/main'])`, `add`, `commit` (with `--author` option), `push`, `revparse`. Use `vi.fn()` order assertions.
4. With mocked Prisma, a successful writeFile inserts ONE VaultWrite row with `succeeded: true`.
5. With a mocked simple-git that throws on `push` BOTH times, writeFile rejects AND inserts ONE VaultWrite row with `succeeded: false` and a non-null `error`.
6. (Smoke test for mutex) Two concurrent `writeFile` calls produce TWO VaultWrite rows in order; the second push call happens strictly after the first push resolves. Use `vi.fn` with manual delays.

Mock git via `vi.mock('simple-git', () => ({ simpleGit: vi.fn() }))` and provide a fluent mock returning `Promise.resolve('')` for each method. Use `Test.createTestingModule({ providers: [VaultService, { provide: ConfigService, useValue: ... }, { provide: PrismaService, useValue: ... }] }).compile()` per the existing pattern in src/llm/classification.service.spec.ts.

**Create `src/note/note.module.ts`:**
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NoteService } from './note.service';

@Module({
  imports: [PrismaModule],
  providers: [NoteService],
  exports: [NoteService],
})
export class NoteModule {}
```

**Create `src/note/note.service.ts`** — thin domain service:
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NoteService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    workspaceId: string;
    source: 'text' | 'voice';
    body: string;
    slug: string;
    vaultPath: string;
    vaultCommitSha: string;
    telegramMsgId?: bigint | null;
  }) {
    return this.prisma.note.create({ data: { ...input } });
  }

  async findById(id: string) {
    return this.prisma.note.findUnique({ where: { id } });
  }

  async softDelete(id: string) {
    return this.prisma.note.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Last N undeleted notes across all workspaces, newest first. */
  async recent(limit = 10) {
    return this.prisma.note.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
```

**Create `src/note/note.service.spec.ts`** — minimal unit tests that mock PrismaService and verify create/softDelete/recent pass through with the right args.

**Wire into `src/app.module.ts`:**
- Add `import { VaultModule } from './vault/vault.module';`
- Add `import { NoteModule } from './note/note.module';`
- Add both to the `imports: [...]` array (anywhere — order doesn't matter for these).

Do NOT wire VaultModule or NoteModule into TelegramModule yet — that happens in plan 07a-02.
  </action>
  <verify>
    <automated>npm test -- src/vault src/note 2>&amp;1 | tail -30 && npm run build 2>&amp;1 | tail -10</automated>
  </verify>
  <done>simple-git, async-mutex, slug installed and present in package.json; src/vault/* and src/note/* files exist; VaultModule + NoteModule registered in AppModule; `npm test -- src/vault src/note` passes (path-prefix tests, audit-log tests, mutex smoke test, NoteService CRUD tests); `npm run build` (tsc) succeeds with zero type errors.</done>
</task>

<task type="auto">
  <name>Task 3: Wire Fly volume + Dockerfile entrypoint + .env.example for SSH key + deploy</name>
  <files>fly.toml, Dockerfile, scripts/entrypoint.sh, .env.example</files>
  <action>
**Add `[[mounts]]` block to `fly.toml`:**

After the existing `[[vm]]` block, append:
```toml

[[mounts]]
  source = 'cortex_vault'
  destination = '/data'
  initial_size = '1'
```

(`initial_size` is honored by `fly launch/deploy` only if the volume doesn't yet exist — we create the volume manually first via the user-setup commands.)

**Modify `Dockerfile` production stage:**

Update the `FROM base AS production` stage to install git + openssh-client and use the entrypoint script. Replace the existing production stage with (preserving the build stage above it):

```dockerfile
# --- Production stage ---
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

# Git + OpenSSH client are required at runtime by VaultService (simple-git + SSH deploy key).
# Append to the existing `apt-get install` in `base` would also work, but keeping it here
# isolates the runtime-only deps and avoids bloating the build image.
RUN apt-get update -y && apt-get install -y git openssh-client && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN npm install --no-save prisma tsx dotenv

COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
CMD ["/entrypoint.sh"]
```

**Create `scripts/entrypoint.sh`:**

```sh
#!/bin/sh
set -e

# Materialize the SSH deploy key from a base64-encoded Fly secret.
# We do this at runtime (not build time) so the key never lives in image layers.
if [ -n "$NIRVANA_WIKI_DEPLOY_KEY_B64" ] && [ -n "$NIRVANA_WIKI_SSH_KEY_PATH" ]; then
  mkdir -p "$(dirname "$NIRVANA_WIKI_SSH_KEY_PATH")"
  echo "$NIRVANA_WIKI_DEPLOY_KEY_B64" | base64 -d > "$NIRVANA_WIKI_SSH_KEY_PATH"
  # SSH refuses keys with group/world-readable permissions (RESEARCH.md Pitfall 4)
  chmod 600 "$NIRVANA_WIKI_SSH_KEY_PATH"

  # Pre-add github.com to known_hosts to avoid first-time host-key prompt
  mkdir -p /root/.ssh
  ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null
  chmod 644 /root/.ssh/known_hosts
fi

exec node dist/src/main.js
```

Make it executable on the dev machine too:
```bash
chmod +x scripts/entrypoint.sh
```

**Update `.env.example`:**

Append (do not remove existing lines):
```
# --- Phase 7a: Note Capture / Vault ---
# SSH URL of the nirvana-wiki repo
NIRVANA_WIKI_REPO_URL=git@github.com:hindole/nirvana-wiki.git
# Where the working clone lives on the Fly persistent volume
NIRVANA_WIKI_LOCAL_DIR=/data/nirvana-wiki
# Where entrypoint.sh writes the materialized SSH key
NIRVANA_WIKI_SSH_KEY_PATH=/data/cortex-key
# base64-encoded private SSH deploy key (set via `fly secrets set` in production; not needed locally
# unless you're running against a real GitHub remote). Generate with:
#   ssh-keygen -t ed25519 -f ~/.ssh/cortex_deploy_key -C cortex-bot -N ''
#   base64 -w0 ~/.ssh/cortex_deploy_key
NIRVANA_WIKI_DEPLOY_KEY_B64=
```

**Verify the Dockerfile builds locally** (no push, just build to catch syntax errors):
```bash
docker build -t cortex:phase7a-vault-check . 2>&1 | tail -20
```

If docker isn't available locally, skip — the next checkpoint catches build failures on Fly.
  </action>
  <verify>
    <automated>grep -q "openssh-client" Dockerfile && grep -q "entrypoint.sh" Dockerfile && grep -q "destination = '/data'" fly.toml && grep -q "NIRVANA_WIKI_REPO_URL" .env.example && test -x scripts/entrypoint.sh && sh -n scripts/entrypoint.sh</automated>
  </verify>
  <done>fly.toml has [[mounts]] block; Dockerfile production stage installs git + openssh-client and uses /entrypoint.sh as CMD; scripts/entrypoint.sh exists, is executable, and passes shell syntax check (`sh -n`); .env.example documents all four NIRVANA_WIKI_* vars.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Human checkpoint — verify deploy key + Fly volume + bootstrap clone end-to-end</name>
  <files>(no code changes — pure verification)</files>
  <action>
This task is a human verification checkpoint. Claude should NOT attempt to automate it — the SSH key generation, GitHub deploy-key UI, and Fly volume creation are user-account-bound operations.

The user runs the steps below to:
1. Generate an SSH deploy key on their dev machine.
2. Add the public key to GitHub with WRITE access via the GitHub UI.
3. Create the Fly persistent volume via `fly volume create`.
4. Set the four NIRVANA_WIKI_* secrets via `fly secrets set`.
5. Run `fly deploy` and watch the bootstrap clone succeed.
6. SSH into the running machine and verify the working clone exists with the correct origin.
7. Type "approved" or describe any failure so we can adjust before plan 07a-02 wires the /note command.

The full `<what-built>` and `<how-to-verify>` blocks below are presented to the user when this checkpoint pauses execution.
  </action>
  <verify>
    <automated>MISSING — this is a human-verify checkpoint; verification is the &lt;how-to-verify&gt; checklist below, confirmed by user typing "approved"</automated>
  </verify>
  <done>User has confirmed via "approved" that: (a) the deploy key is added to nirvana-wiki with WRITE access, (b) the cortex_vault Fly volume exists in region sin, (c) all four NIRVANA_WIKI_* secrets are set, (d) `fly deploy` succeeded with the VaultService bootstrap-clone log lines visible, (e) `fly ssh console` confirms /data/nirvana-wiki/.git exists with the right origin, and (f) /data/cortex-key has mode 600.</done>
  <what-built>
- Note + VaultWrite Prisma models + migration
- VaultService (clone bootstrap, mutex-serialized writeFile + revertLastCommit, path-prefix guard, audit log)
- NoteService (thin CRUD + soft delete + recent)
- Dockerfile + entrypoint.sh + fly.toml updates so the deployed image can SSH to GitHub and uses a 1 GB persistent volume at /data
- .env.example documenting the four NIRVANA_WIKI_* secrets

Everything compiles and the unit tests pass locally. Now we need to verify it actually clones, writes, and pushes against the real GitHub remote on Fly.io. This is the only thing that proves the SSH-key-as-Fly-secret pattern (the one MEDIUM-confidence item from research) works end-to-end.
  </what-built>
  <how-to-verify>
1. **Generate the SSH deploy key (one-time, on your dev machine):**
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/cortex_deploy_key -C cortex-bot -N ''
   ```

2. **Add the public key to GitHub as a deploy key with WRITE access:**
   - Visit https://github.com/hindole/nirvana-wiki/settings/keys (replace user/repo if different)
   - Click "Add deploy key"
   - Title: `cortex-fly`
   - Paste contents of `~/.ssh/cortex_deploy_key.pub`
   - **Check "Allow write access"** (this is required for git push)

3. **Create the Fly persistent volume (one-time):**
   ```bash
   fly volume create cortex_vault --region sin --size 1 -a cortex-hindole
   ```
   Expected: `Created volume cortex_vault ...` — confirm it shows up in `fly volume list -a cortex-hindole`.

4. **Set Fly secrets:**
   ```bash
   fly secrets set \
     NIRVANA_WIKI_REPO_URL=git@github.com:hindole/nirvana-wiki.git \
     NIRVANA_WIKI_DEPLOY_KEY_B64="$(base64 -w0 ~/.ssh/cortex_deploy_key)" \
     NIRVANA_WIKI_LOCAL_DIR=/data/nirvana-wiki \
     NIRVANA_WIKI_SSH_KEY_PATH=/data/cortex-key \
     -a cortex-hindole
   ```
   (Replace the repo URL with your actual nirvana-wiki repo SSH URL if different.)

   On macOS, `base64 -w0` is not supported — use `base64 -i ~/.ssh/cortex_deploy_key | tr -d '\n'` instead.

5. **Deploy:**
   ```bash
   fly deploy -a cortex-hindole
   ```
   Watch the logs — the prisma migration runs first (release_command), then the app boots. Expected log lines from VaultService.onModuleInit:
   - `Bootstrapping clone to /data/nirvana-wiki`  (only on first boot — empty volume)
   - `Vault ready at /data/nirvana-wiki`

6. **SSH into the running machine and verify the working clone:**
   ```bash
   fly ssh console -a cortex-hindole
   # inside the machine:
   ls -la /data/nirvana-wiki/.git
   cd /data/nirvana-wiki && git log --oneline -5
   git remote -v   # should show origin git@github.com:hindole/nirvana-wiki.git
   ls -la /data/cortex-key   # mode should be -rw------- (600)
   exit
   ```

7. **Confirm and report back:** Type `approved` if the bootstrap clone exists at /data/nirvana-wiki and the remote is the correct GitHub repo, OR describe what failed (deploy log error, permissions issue, GitHub auth failure, etc.) so we can adjust before plan 07a-02 starts wiring the /note command.

If step 5 fails with "could not authenticate" → deploy key not added with write access (step 2).
If step 5 fails with "Permissions 0644 are too open" → entrypoint.sh chmod missed; redeploy.
If clone never happens → check `fly logs -a cortex-hindole` for VaultService errors during boot.
  </how-to-verify>
  <resume-signal>Type "approved" once the bootstrap clone is verified, or describe any failures.</resume-signal>
</task>

</tasks>

<verification>
- `npm test` passes for src/vault and src/note (path-prefix guard, mutex serialization, audit-log on success and failure, NoteService CRUD).
- `npm run build` produces zero TypeScript errors.
- After Fly deploy: `fly ssh console -a cortex-hindole` → `/data/nirvana-wiki/.git/` exists, `git remote -v` shows nirvana-wiki origin, `/data/cortex-key` is mode 600.
- Prisma migration ran on Fly (visible in deploy logs): `Migration ...add_note_and_vault_write applied`.
- The app does NOT crash-loop on first boot with an empty volume (bootstrap clone runs idempotently).
</verification>

<success_criteria>
- All five must_have truths are observable on the deployed Fly machine.
- VAULT-01 (working clone on persistent volume) ✅ — verified via `fly ssh console`.
- VAULT-02 (pull-rebase → write → commit → push under mutex) ✅ — codified in writeFile, exercised by unit tests; full path will be exercised by 07a-02.
- VAULT-03 (writes only to raw/inbox/ and raw/meetings/) ✅ — assertAllowedPath enforced before mutex acquisition + tested.
- VAULT-04 (commits as cortex-bot &lt;bot@cortex.local&gt;) ✅ — `--author` flag passed on every commit + git config set as backup.
- VAULT-05 (audit-log row on every write) ✅ — try/finally guarantees a VaultWrite row whether writeFile resolves or throws.
- NoteModule and VaultModule are wired into AppModule and resolve cleanly at boot (no DI errors in `fly logs`).
</success_criteria>

<output>
After completion, create `.planning/phases/07a-note-capture/07a-01-SUMMARY.md` summarizing:
- Schema diff (added Note + VaultWrite + NoteSource + VaultWriteKind enums)
- VaultService public API surface (writeFile, revertLastCommit) and the mutex/path-guard contract downstream code can rely on
- Note: VaultModule + NoteModule are NOT yet imported by TelegramModule — that's plan 07a-02's wiring
- Fly secrets set + deploy key configured (note this so future SUMMARYs don't re-document setup)
- Any deviations from RESEARCH.md and why
</output>
