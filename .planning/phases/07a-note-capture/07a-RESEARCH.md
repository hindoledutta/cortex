# Phase 7a: Note Capture - Research

**Researched:** 2026-04-26
**Domain:** Telegram bot side-channel + Git automation on Fly.io persistent volume
**Confidence:** HIGH (stack, patterns, codebase integration), MEDIUM (Fly.io secret-as-file pattern for SSH key — needs deploy-time validation)

## Summary

Phase 7a adds a `/note` Telegram command that writes verbatim text/voice into the user's nirvana-wiki GitHub repo at `raw/inbox/YYYY-MM-DD-{slug}.md`. The work splits cleanly into two layers: a **VaultModule** that owns a working clone of the repo on a Fly.io persistent volume and exposes a single serialized `writeFile()` operation (pull-rebase → write → commit → push under a process-local mutex), and **Telegram surface code** that registers `/note` as a side-channel command, generates a 4-6 word kebab-case slug via Sonnet, and shows a 60-second `[Undo]` inline button that triggers `git revert HEAD --no-edit && push`.

The core technical risk is git authentication: the Fly.io machine needs an SSH deploy key for the private nirvana-wiki repo. Fly's standard `fly secrets set` doesn't gracefully accept multiline values, so the recommended pattern is to base64-encode the key and write it to disk at app boot via `[[files]]` in `fly.toml` (or decode in a small entrypoint script), then point `GIT_SSH_COMMAND` at that file with `IdentitiesOnly=yes`. The git operations themselves use **simple-git 3.28** (a thin wrapper over the `git` CLI subprocess) — `isomorphic-git` is the wrong choice here because it's a pure-JS reimplementation aimed at browser environments and adds risk over the battle-tested CLI.

The rest is straight integration: a new `Note` and `VaultWrite` Prisma model, a new Sonnet operation `slug-generation` slotted into the existing `LlmService.MODEL_MAP`, a new `@Command('note')` and `@Action(/^note:undo:.../)` decorator on the existing `TelegramUpdate` class, and a new "expecting-voice-for-note" pending state in `OrchestratorService` to handle the two-message form (`/note` then voice). The `[Undo]` 60-second window is implemented either with `setTimeout` (process-local, lost on restart — acceptable for a UX nicety) or by storing `undoExpiresAt` on the Note row and rejecting the callback if past. The pg-boss path is overkill for a 60-second UI affordance.

**Primary recommendation:** Use `simple-git` over the `git` CLI via subprocess wrapper, store the SSH deploy key as a base64-encoded Fly secret materialized to disk at boot, serialize all vault writes through a single `async-mutex` instance held by `VaultService`, and use `setTimeout` + `editMessageReplyMarkup` to implement the 60-second `[Undo]` button removal (with a defensive `undoExpiresAt` check on the callback handler).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NOTE-01 | `/note <text>` captures text note routed to vault | Existing `@Command('note')` pattern in `TelegramUpdate`; new `OrchestratorService.handleNoteCommand()`; calls VaultService.writeNote() |
| NOTE-02 | `/note` followed by voice captures voice note (reuses Whisper) | New pending state `pendingNoteVoiceSessions: Map<chatId, {...}>` in `OrchestratorService` (pattern matches `pendingContactResolutions`); existing `VoiceService.transcribe()` reused unchanged |
| NOTE-03 | Reply to a transcribed voice msg with `/note` re-routes from task to note | Telegram message reply chain: `ctx.message.reply_to_message` exposes the original message; check if reply is to our own bot's transcription confirmation, look up transcript text, treat as note body. If no associated task was created yet, this needs careful ordering — see Open Questions |
| NOTE-04 | Notes written verbatim with Source/Captured/Workspace header | Plain string template in VaultService; no LLM; uses workspace name from `WorkspaceService.getDefault()` (or session workspace if available) |
| NOTE-05 | Sonnet generates 4-6 word kebab-case slug | New `'slug-generation': 'claude-sonnet-4-6'` entry in `MODEL_MAP`; new `SlugService` in `LlmModule` mirroring `ClassificationService` pattern; reuse `LlmService.createMessage()`; collision-handling `-2`, `-3` done by VaultService against the on-disk filesystem |
| NOTE-06 | Bot replies with file path, commit sha, `[Undo]` button (60s) | `MessageFormatterService.formatNoteSaved()` new method; inline keyboard `Markup.button.callback('Undo', 'note:undo:{noteId}')` matches existing callback pattern (e.g. `task:done:{id}`); `setTimeout(() => editMessageReplyMarkup({inline_keyboard:[]}), 60000)` |
| NOTE-07 | `[Undo]` reverts commit, pushes, soft-deletes Note row | New `@Action(/^note:undo:(.+)$/)` on `TelegramUpdate`; `OrchestratorService.handleNoteUndoCallback()` calls `VaultService.revertLastCommit()` (idempotent: checks HEAD sha == note.vaultCommitSha first) and `prisma.note.update({where:{id}, data:{deletedAt: new Date()}})` |
| NOTE-08 | Voice notes >10 min rejected | Extend `VoiceService.transcribe()` to accept optional max-duration param OR check `ctx.message.voice.duration` (Telegram provides this in seconds in the webhook payload — no Whisper call needed for the guard) and reject early. Cleaner: check at orchestrator level, before calling VoiceService |
| NOTE-09 | `/note` is a side-channel — does not interrupt task follow-up | Bypass `classifyAndRoute` entirely. The `@Command('note')` decorator fires before `@On('text')` (existing pattern documented in `TelegramUpdate`). Do NOT call `session.refreshTtl` or modify `pendingFollowUps` in the note flow |
| VAULT-01 | Working clone of nirvana-wiki on Fly.io persistent volume | New `[[mounts]]` block in `fly.toml` (`source="cortex_vault"`, `destination="/data/nirvana-wiki-parent"`; clone target is a subdirectory of the mount). Volume created once via `fly volume create cortex_vault --region sin --size 1`. Bootstrap on first boot detects empty mount, runs initial clone |
| VAULT-02 | pull-rebase → write → commit → push under single-writer mutex | `async-mutex` `Mutex.runExclusive()` wrapping the full sequence. `git fetch && git reset --hard origin/main` (HLD says reset, not rebase — vault is remote-authoritative). Single try; retry once on push conflict; surface failure on second attempt |
| VAULT-03 | Cortex writes only to `raw/inbox/` and `raw/meetings/` | Enforce path prefix in VaultService: reject any input path that doesn't start with `raw/inbox/` or `raw/meetings/`. Throw early — do not depend on convention only |
| VAULT-04 | Cortex commits as `cortex-bot <bot@cortex.local>` | `simple-git` supports `--author "Name <email>"` per-commit; alternatively configure the local clone's user.name/user.email once at bootstrap. Per-commit author is safer (immune to subsequent config drift) |
| VAULT-05 | Every write recorded in `VaultWrite` audit log | New Prisma model `VaultWrite` (kind, sourceId, vaultPath, commitSha, succeeded, error, createdAt). Insert in VaultService — both on success and failure. No FK to Note (polymorphic per HLD §7) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `simple-git` | ^3.28.0 | Git operations (clone, fetch, reset, add, commit, push) | 11M weekly downloads, thin wrapper over CLI, used by countless production Node apps; battle-tested vs isomorphic-git's pure-JS reimplementation which is aimed at browser use cases |
| `async-mutex` | ^0.5.0 | Process-local single-writer mutex for vault operations | Industry-standard JS mutex; stable since 2018; supports `runExclusive()` callback pattern and `withTimeout()` decorator |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk` | already installed (^0.78.0) | Sonnet slug generation | Reuse via existing `LlmService` — add `'slug-generation'` to `LlmOperation` union and `MODEL_MAP` |
| `nestjs-telegraf` | already installed (^2.9.1) | `@Command('note')`, `@Action()` for undo callback | Already wired; just add new decorators to existing `TelegramUpdate` class |
| `@prisma/client` | already installed (^7) | Persist `Note` and `VaultWrite` rows | Add two models to `schema.prisma` |
| `pg-boss` | already installed (^12.13.0) | NOT needed for `/note` 60-second undo window | Use `setTimeout` instead — pg-boss is overkill for a 60s UI affordance and adds DB load |
| `openai` | already installed (^6.25.0) | Reused via `VoiceService` for voice transcription | No changes needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `simple-git` | `isomorphic-git` (pure-JS) | Pure-JS implementation; sole win is browser compatibility (irrelevant here); slower; smaller ecosystem; would need extra config for SSH (uses `git-http-backend` paradigm rather than CLI). Avoid. |
| `simple-git` | `nodegit` (libgit2 native bindings) | Native module compilation breaks frequently across Node versions; abandoned for long stretches; debugging is harder. Avoid. |
| `simple-git` | Raw `child_process.exec('git ...')` | Reinvents simple-git's escape/quote/error handling; harder to test. Use only if you discover a critical simple-git bug, which is unlikely. |
| `async-mutex` | Custom Promise chain (single shared `currentOp = currentOp.then(...)`) | Works for trivial cases but lacks timeout, queue inspection, and clean cancellation. async-mutex is 4kb gzipped — not worth hand-rolling. |
| `setTimeout` for undo expiration | `pg-boss` delayed job | pg-boss adds DB round-trip per note + survives restart (which we don't need for a UX nicety). `setTimeout` loses the timer on restart but the worst case is "undo button doesn't disappear visually until next user interaction" — defensive `undoExpiresAt` check on the callback covers correctness. |
| `setTimeout` for undo expiration | Redis key with TTL + scheduled cleanup | Adds Redis dep for this flow; same correctness story as setTimeout + DB column. Not worth it. |
| Slug generation via Sonnet | `github-slugger` or `slug` library | Locked decision (HLD §3.7 / NOTE-05): Sonnet generates an *intelligent* 4-6 word slug from content. A pure slugifier turns the first sentence into a long URL-style slug — different requirement. Use `slug` library only for the *normalization* step after Sonnet returns its candidate (lowercase, strip punctuation, hyphenate). |

**Installation:**
```bash
npm install simple-git async-mutex
# Optional belt-and-suspenders for slug normalization (recommended):
npm install slug
npm install --save-dev @types/slug
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── vault/                          # NEW — owns the working clone + write protocol
│   ├── vault.module.ts
│   ├── vault.service.ts            # writeFile(), revertLastCommit(), under mutex
│   ├── vault.bootstrap.ts          # OnModuleInit: detect empty mount, clone if needed
│   ├── vault.types.ts              # WriteFileInput, RevertResult
│   └── vault.service.spec.ts
├── note/                           # NEW — Note domain CRUD
│   ├── note.module.ts
│   ├── note.service.ts             # create(), softDelete(), recent()
│   └── note.service.spec.ts
├── llm/
│   ├── slug.service.ts             # NEW — Sonnet slug generation (mirrors classification.service.ts)
│   ├── slug.service.spec.ts        # NEW
│   ├── prompts/
│   │   └── slug.prompt.ts          # NEW — system prompt for slug-only output
│   ├── llm.types.ts                # MODIFIED — add 'slug-generation' to LlmOperation, MODEL_MAP, SlugResultSchema
│   └── llm.module.ts               # MODIFIED — register SlugService in providers + exports
├── telegram/
│   ├── telegram.update.ts          # MODIFIED — add @Command('note'), @Action(/^note:undo:.../)
│   ├── services/
│   │   ├── orchestrator.service.ts # MODIFIED — handleNoteCommand, handleNoteVoice, handleNoteUndoCallback, pendingNoteVoiceSessions Map
│   │   └── message-formatter.service.ts  # MODIFIED — formatNoteSaved(), formatNoteReverted()
│   └── telegram.constants.ts       # MODIFIED — add NOTE callback prefix and UNDO action
└── app.module.ts                   # MODIFIED — register VaultModule, NoteModule

prisma/
└── schema.prisma                   # MODIFIED — add Note + VaultWrite models
```

### Pattern 1: VaultService as Single Serialization Point

**What:** All vault writes go through one service holding a single shared `Mutex`. No bypass paths.
**When to use:** Always. Even read-only operations (e.g. `git log` for `/vault recent`) should NOT need the mutex if they're separated, but writes must serialize.

**Example:**
```typescript
// src/vault/vault.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mutex } from 'async-mutex';
import { simpleGit, SimpleGit } from 'simple-git';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface WriteFileInput {
  vaultPath: string;       // e.g. 'raw/inbox/2026-04-26-foo-bar.md'
  body: string;
  commitMessage: string;   // e.g. 'note: capture foo-bar'
}

interface WriteFileResult {
  commitSha: string;
  vaultPath: string;       // returned with collision suffix applied
}

@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private readonly mutex = new Mutex();
  private git!: SimpleGit;
  private vaultDir!: string;
  private static readonly ALLOWED_PREFIXES = ['raw/inbox/', 'raw/meetings/'];
  private static readonly AUTHOR = 'cortex-bot <bot@cortex.local>';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.vaultDir = this.config.getOrThrow<string>('NIRVANA_WIKI_LOCAL_DIR');
    const sshKeyPath = this.config.getOrThrow<string>('NIRVANA_WIKI_SSH_KEY_PATH');
    const repoUrl = this.config.getOrThrow<string>('NIRVANA_WIKI_REPO_URL');

    const sshCommand = `ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;

    // Detect empty mount → bootstrap clone
    const exists = await this.dirExists(path.join(this.vaultDir, '.git'));
    if (!exists) {
      this.logger.log(`Bootstrapping clone to ${this.vaultDir}`);
      await fs.mkdir(path.dirname(this.vaultDir), { recursive: true });
      const tmp = simpleGit().env('GIT_SSH_COMMAND', sshCommand);
      await tmp.clone(repoUrl, this.vaultDir);
    }

    this.git = simpleGit(this.vaultDir).env('GIT_SSH_COMMAND', sshCommand);
    this.logger.log(`Vault ready at ${this.vaultDir}`);
  }

  async writeFile(input: WriteFileInput): Promise<WriteFileResult> {
    this.assertAllowedPath(input.vaultPath);
    return this.mutex.runExclusive(async () => {
      // 1. Sync to remote-authoritative state
      await this.git.fetch();
      await this.git.reset(['--hard', 'origin/main']);

      // 2. Resolve filename collision
      const finalPath = await this.resolveCollision(input.vaultPath);
      const absPath = path.join(this.vaultDir, finalPath);

      // 3. Write
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, input.body, 'utf8');

      // 4. Commit + push
      await this.git.add(finalPath);
      await this.git.commit(input.commitMessage, undefined, {
        '--author': VaultService.AUTHOR,
      });
      try {
        await this.git.push('origin', 'main');
      } catch (err) {
        // Retry once with fresh fetch/replay
        this.logger.warn(`Push failed, retrying once: ${err}`);
        await this.git.fetch();
        // simple-git rebase via pull --rebase if our commit is behind
        await this.git.pull('origin', 'main', { '--rebase': null });
        await this.git.push('origin', 'main');
      }

      const sha = (await this.git.revparse(['HEAD'])).trim();
      return { commitSha: sha, vaultPath: finalPath };
    });
  }

  async revertLastCommit(expectedSha: string): Promise<{ commitSha: string }> {
    return this.mutex.runExclusive(async () => {
      await this.git.fetch();
      await this.git.reset(['--hard', 'origin/main']);
      const headSha = (await this.git.revparse(['HEAD'])).trim();
      if (headSha !== expectedSha) {
        throw new Error(`HEAD is ${headSha}, expected ${expectedSha} — not safe to revert`);
      }
      await this.git.raw(['revert', 'HEAD', '--no-edit']);
      await this.git.push('origin', 'main');
      const newSha = (await this.git.revparse(['HEAD'])).trim();
      return { commitSha: newSha };
    });
  }

  private assertAllowedPath(p: string): void {
    if (!VaultService.ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix))) {
      throw new Error(`Vault writes restricted to ${VaultService.ALLOWED_PREFIXES.join(', ')} — got ${p}`);
    }
    if (p.includes('..')) throw new Error(`Path traversal blocked: ${p}`);
  }

  private async resolveCollision(desired: string): Promise<string> {
    const ext = path.extname(desired);
    const base = desired.slice(0, -ext.length);
    let candidate = desired;
    let n = 2;
    while (await this.fileExists(path.join(this.vaultDir, candidate))) {
      candidate = `${base}-${n}${ext}`;
      n++;
    }
    return candidate;
  }

  private async dirExists(p: string): Promise<boolean> {
    try { const s = await fs.stat(p); return s.isDirectory(); } catch { return false; }
  }
  private async fileExists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }
}
```

### Pattern 2: Two-Phase Voice Note (`/note` then voice)

**What:** When user sends `/note` with no args, store a "expecting voice" state keyed by chatId; the next inbound voice message is routed to note handling instead of task handling.
**When to use:** Required by NOTE-02. Mirror the existing `pendingContactResolutions: Map<string, ...>` pattern in `OrchestratorService`.

**Example:**
```typescript
// In OrchestratorService:
private pendingNoteVoiceSessions = new Map<string, { workspace: string; expiresAt: Date }>();

// New /note command handler
async handleNoteCommand(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat!.id);
  const message = ctx.message as Record<string, any>;
  const text = (message.text as string).replace(/^\/note\s*/, '').trim();

  // Reply form: /note as a reply to a previous transcription
  if (message.reply_to_message?.from?.is_bot && message.reply_to_message?.text) {
    const transcript = this.extractTranscriptFromBotMessage(message.reply_to_message.text);
    if (transcript) {
      await this.persistNote(ctx, chatId, 'voice', transcript);
      return;
    }
  }

  if (text) {
    // Inline form: /note <text>
    await this.persistNote(ctx, chatId, 'text', text);
    return;
  }

  // Bare /note — set expecting-voice state
  this.pendingNoteVoiceSessions.set(chatId, {
    workspace: (await this.workspace.getDefault()).name,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min
  });
  await ctx.reply('Send your voice message — I\'ll save it as a note.');
}

// In handleVoice() — check pending note session FIRST
async handleVoice(ctx: Context): Promise<void> {
  const chatId = String(ctx.chat!.id);
  const noteSession = this.pendingNoteVoiceSessions.get(chatId);
  if (noteSession && noteSession.expiresAt > new Date()) {
    this.pendingNoteVoiceSessions.delete(chatId);
    return this.handleNoteVoice(ctx, chatId);
  }
  // ... existing task voice flow
}
```

### Pattern 3: 60-Second Undo Window via setTimeout + Defensive DB Check

**What:** After saving a note, set a `setTimeout(60_000)` to remove the inline keyboard. The undo callback handler additionally checks `note.createdAt + 60s > now` (defensive, in case the timeout was lost to a restart).
**When to use:** All UX timeouts on the order of seconds-to-minutes. For longer (hours/days), use pg-boss.

**Example:**
```typescript
// After successful vault write:
const sentMsg = await ctx.reply(formatNoteSaved(note), {
  parse_mode: 'HTML',
  ...Markup.inlineKeyboard([
    Markup.button.callback('↩️ Undo', `note:undo:${note.id}`),
  ]),
});

// Schedule keyboard removal at 60s
setTimeout(() => {
  ctx.telegram.editMessageReplyMarkup(
    sentMsg.chat.id,
    sentMsg.message_id,
    undefined,
    { inline_keyboard: [] },
  ).catch((err) => this.logger.warn(`Failed to clear undo keyboard: ${err}`));
}, 60_000).unref(); // .unref() so it doesn't keep the process alive

// In handleNoteUndoCallback:
const note = await this.noteService.findById(noteId);
const ageMs = Date.now() - note.createdAt.getTime();
if (ageMs > 60_000) {
  await ctx.answerCbQuery('Undo window expired');
  return;
}
// ... proceed with revert
```

### Pattern 4: Sonnet Slug Generation (Mirror existing LLM service shape)

**What:** A new service that mirrors `ClassificationService` exactly — system prompt + user content → JSON response → Zod-validated → kebab-case string.
**When to use:** This is the only LLM call in the note flow. Body is verbatim — never call the LLM with "rewrite" intent.

**Example:**
```typescript
// src/llm/slug.service.ts
import { z } from 'zod';
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from './llm.service';
import { buildSlugPrompt } from './prompts/slug.prompt';

const SlugResultSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+){2,5}$/), // 3-6 hyphenated tokens
});

@Injectable()
export class SlugService {
  private readonly logger = new Logger(SlugService.name);
  constructor(private readonly llm: LlmService) {}

  async generate(body: string): Promise<string> {
    // Truncate body to avoid burning tokens — slug only needs first ~500 chars
    const sample = body.slice(0, 500);
    const response = await this.llm.createMessage(
      'slug-generation',
      buildSlugPrompt(),
      [{ role: 'user', content: sample }],
      z.toJSONSchema(SlugResultSchema) as Record<string, unknown>,
      64,
    );
    const parsed = SlugResultSchema.parse(JSON.parse(response.content));
    return parsed.slug;
  }
}
```

### Anti-Patterns to Avoid

- **Skipping the mutex on "small" writes:** Even a single dropped concurrent write can corrupt the working clone (mid-pull state, dirty index). Every mutating git operation goes through the mutex. No exceptions.
- **Holding the mutex across LLM calls:** Slug generation, transcription, and DB writes happen *outside* the mutex. The mutex wraps only the `fetch → reset → write file → add → commit → push` sequence (typically <2s). LLM calls inside the mutex would serialize all `/note` invocations on Sonnet latency.
- **Using `git pull` instead of `git fetch + reset --hard`:** HLD §3.9 is explicit: vault is *remote-authoritative*. `git pull` may try to merge if there are divergent local commits (shouldn't happen but defense-in-depth). `fetch + reset --hard` is the only safe pattern when you're treating the working tree as a write cache.
- **Storing the SSH key in the Docker image:** Build-arg secrets persist in image layers. Use Fly.io secrets materialized at runtime via `[[files]]` or a small entrypoint that decodes a base64 secret.
- **Treating `/note` as a classified intent:** Routing `/note` through `ClassificationService` would (a) waste a Sonnet call, (b) risk misclassification, (c) violate NOTE-09 by interacting with session state. The `@Command('note')` decorator must fire *before* `@On('text')` (the existing comment in `TelegramUpdate` already documents this ordering — preserve it).
- **Using `git config --global user.name` for commit author:** Per-commit `--author` is more explicit and survives image rebuilds. Set the local `.git/config` user.email/user.name as backup at bootstrap, but always pass `--author` on commit.
- **Calling `editMessageReplyMarkup({})` instead of `editMessageReplyMarkup({inline_keyboard: []})`:** Empty object → 400 from Telegram (documented Telegraf bug). Always pass `{ inline_keyboard: [] }`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git operations | `child_process.exec('git pull')` with manual escaping | `simple-git` | Handles arg quoting, error parsing, line-ending normalization, env-var passing for `GIT_SSH_COMMAND`. Used by 5,000+ npm packages. |
| Process-local mutex | Promise chain (`prev = prev.then(...)`) | `async-mutex` | Adds timeout, queue introspection, `runExclusive()` ergonomics, AbortError support. 4kb. |
| Slug normalization (post-Sonnet sanity check) | Custom regex pipeline | `slug` (npm) library | Handles unicode, diacritics, edge cases. Tiny. |
| Filename-safe date prefix | Manual `Date.toISOString().slice(0, 10)` | OK to hand-roll — it's literally one expression. Just use `new Date().toISOString().slice(0, 10)` (UTC) or compute in user timezone via existing `Intl.DateTimeFormat` pattern from `OrchestratorService`. |
| Telegram inline keyboard buttons | Manual JSON construction | Existing `Markup.inlineKeyboard([Markup.button.callback(...)])` from telegraf | Already used everywhere in the codebase. |
| Git author attribution | `git config user.email cortex-bot@...` then commit | `--author` flag per-commit | Per-commit author is immune to config drift; explicit at the call site. |
| Idempotent revert | Just `git revert HEAD` and hope | Check `git rev-parse HEAD == expectedSha` first | If a competing write landed between the note and the undo tap, reverting HEAD would revert the wrong commit. Always verify. |

**Key insight:** The "scary" piece of this phase looks like git automation, but every individual operation is well-trodden. The discipline is *isolation* — one service owns the working clone, one mutex serializes all writes, one path-prefix check enforces the write boundary, one `--author` flag stamps every commit. Don't spread git knowledge across the codebase.

## Common Pitfalls

### Pitfall 1: Multiline SSH Key in `fly secrets set`
**What goes wrong:** `fly secrets set NIRVANA_WIKI_DEPLOY_KEY="$(cat key)"` fails with `must be in the format NAME=VALUE` because newlines confuse the parser.
**Why it happens:** flyctl shell-arg parsing predates first-class multiline support.
**How to avoid:** Two options:
  - **(A)** Base64-encode: `fly secrets set NIRVANA_WIKI_DEPLOY_KEY_B64="$(base64 -w0 ~/.ssh/cortex_deploy_key)"`. Decode in entrypoint script: `echo "$NIRVANA_WIKI_DEPLOY_KEY_B64" | base64 -d > /data/cortex-key && chmod 600 /data/cortex-key`.
  - **(B)** Use `fly secrets import` from stdin: `cat ~/.ssh/cortex_deploy_key | fly secrets import` (the file should be a single `NAME=value` block — newlines in the value need escaping).
  - **(C)** Use `[[files]]` in `fly.toml`: declare a file mount with `secret_name`, Fly materializes the secret to disk (still needs base64 for binary safety).
**Recommendation:** Option (A). Simplest, works with existing Fly.io workflow, no fly.toml gymnastics.
**Warning signs:** Deploy logs say "could not parse secrets" — caught at deploy time, not runtime. Easy to spot.

### Pitfall 2: First-Boot Empty Mount Race
**What goes wrong:** App starts, VaultService.onModuleInit runs, sees empty `/data/nirvana-wiki/`, starts cloning... and Telegram webhook fires for `/note` before clone completes. NotePersistence fails or hangs.
**Why it happens:** NestJS bootstrapping isn't a hard barrier — the HTTP listener can be ready before all `OnModuleInit` hooks complete in some configurations.
**How to avoid:** Make `VaultService.writeFile()` await an internal `readyPromise` set by onModuleInit. NestJS *does* wait for `OnModuleInit` to resolve before starting the HTTP server (this is standard behavior), but a defensive `await this.ready` in writeFile is cheap insurance and makes test flakes impossible.
**Warning signs:** First deploy works, redeploys (with fresh containers but persistent volume) work; *very first deploy* fails on first /note within seconds of boot.

### Pitfall 3: Push Conflict from Concurrent wiki-ingest Workflow
**What goes wrong:** The user's existing GitHub Actions workflow promoting `raw/` → `wiki/` happens to push at the exact same moment cortex pushes a note. cortex's push fails with non-fast-forward.
**Why it happens:** Two writers racing on the same branch. HLD §10 documents this as low-probability but possible.
**How to avoid:** Per HLD §3.9 retry protocol: catch push error, run `git fetch && git pull --rebase origin main`, then push again. Limit to one retry. On second failure, log + Telegram-notify + persist failed VaultWrite row + return error.
**Warning signs:** Logs show occasional `! [rejected] main -> main (non-fast-forward)`. If this happens >5% of the time, investigate ingest workflow timing.

### Pitfall 4: Deploy Key with Wrong Permissions
**What goes wrong:** SSH refuses to use the key file because it's group/world-readable. Error is cryptic: `Permissions 0644 for '/data/cortex-key' are too open`.
**Why it happens:** `base64 -d > file` creates the file with the umask default (often 644).
**How to avoid:** Always `chmod 600` the key file immediately after writing it. Bake into the entrypoint script:
  ```sh
  echo "$NIRVANA_WIKI_DEPLOY_KEY_B64" | base64 -d > /data/cortex-key
  chmod 600 /data/cortex-key
  ```
**Warning signs:** Bootstrap clone fails immediately. Error message is clear but only visible in app logs.

### Pitfall 5: `git revert` of Already-Reverted or Diverged HEAD
**What goes wrong:** User taps undo. Between the note being saved and the tap, another note was written, OR the same note was already undone via another tap (e.g. duplicate inline button). Reverting HEAD now reverts the wrong commit.
**Why it happens:** Telegram callbacks aren't deduped; users can double-tap.
**How to avoid:**
  1. Idempotency check on the Note row first: if `note.deletedAt` already set, answer `'Already undone'` and stop.
  2. In VaultService.revertLastCommit(), pass `expectedSha = note.vaultCommitSha` and verify HEAD matches before reverting. If HEAD has moved on, reject with a clear error.
  3. If you really want to undo a note whose commit is no longer HEAD, you'd need `git revert <specific-sha>` — out of scope for v1; just say "Cannot undo, vault has moved on."
**Warning signs:** Audit log shows VaultWrite rows for revert operations whose commit message refers to a different note than expected. Add an integration test that double-taps undo.

### Pitfall 6: Voice Note Length Check After Whisper Call
**What goes wrong:** User sends a 30-minute voice note. We call Whisper, burn $0.18, *then* check duration and reject. Money wasted.
**Why it happens:** Naive ordering: transcribe → check length.
**How to avoid:** Telegram's voice message webhook payload includes `voice.duration` (seconds). Check **before** calling VoiceService.transcribe(). The 10-min cap is enforced pre-Whisper, so cost guard works.
**Warning signs:** Voice transcription bills spike. If they grow with note volume rather than task volume, this check is missing or in the wrong place.

### Pitfall 7: Slug Collision Day-Boundary Race
**What goes wrong:** Two notes with same slug on same day. Collision logic appends `-2`, `-3`. But if mutex is correctly held during write, this is fine. If not, two workers could both check "does foo.md exist? no. write foo.md" and one overwrites the other.
**Why it happens:** Forgetting the mutex covers the file existence check too.
**How to avoid:** All file existence checks happen inside `mutex.runExclusive()`. The example VaultService above does this correctly.
**Warning signs:** Files in `raw/inbox/` appear with content from a different note than the slug suggests.

### Pitfall 8: VaultWrite Audit Row Missing on Failure
**What goes wrong:** Vault write fails mid-way (push fails twice). VaultService throws. The orchestrator's try/catch only logs. No VaultWrite row created. We have no record of the failed write.
**Why it happens:** Audit-log calls are easy to forget on the error path.
**How to avoid:** Use try/finally pattern in VaultService.writeFile — always insert a VaultWrite row, with `succeeded: true/false` and `error: errorMessage`. Better: have VaultService take a callback or return-type that includes audit info, and let the caller (NoteService) own the DB write — but the VaultService is best-positioned because it knows the actual commitSha (or that there isn't one).
**Warning signs:** `/vault recent` shows fewer entries than expected attempts visible in app logs.

## Code Examples

Verified patterns from official sources:

### simple-git Clone with Custom SSH Key
```typescript
// Source: https://github.com/steveukx/git-js (simple-git README)
// Plus: https://devops-daily.com/posts/specify-private-ssh-key-for-git-commands
import { simpleGit } from 'simple-git';

const sshCommand = `ssh -i /data/cortex-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
const git = simpleGit().env('GIT_SSH_COMMAND', sshCommand);
await git.clone('git@github.com:user/nirvana-wiki.git', '/data/nirvana-wiki');
```

### simple-git Commit with Author Override
```typescript
// Source: https://github.com/steveukx/git-js (commit options)
const git = simpleGit('/data/nirvana-wiki').env('GIT_SSH_COMMAND', sshCommand);
await git.add('raw/inbox/2026-04-26-foo.md');
await git.commit('note: capture foo', undefined, {
  '--author': 'cortex-bot <bot@cortex.local>',
});
await git.push('origin', 'main');
```

### async-mutex Serialization
```typescript
// Source: https://github.com/DirtyHairy/async-mutex
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

async function safeOperation(input: string) {
  return mutex.runExclusive(async () => {
    // Only one execution at a time, queue order preserved
    return await criticalSection(input);
  });
}
```

### Fly.io fly.toml with Mount + Secret-File
```toml
# Source: https://fly.io/docs/launch/volume-storage/
# Plus: https://fly.io/docs/reference/configuration/

app = 'cortex-hindole'
primary_region = 'sin'

[build]

[deploy]
  release_command = 'npx prisma migrate deploy'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 1
  processes = ['app']

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1
  memory_mb = 1024

[[mounts]]
  source = 'cortex_vault'
  destination = '/data'
  initial_size = '1'  # GB
```

Volume creation (one-shot, before first deploy):
```bash
fly volume create cortex_vault --region sin --size 1
fly secrets set NIRVANA_WIKI_DEPLOY_KEY_B64="$(base64 -w0 ~/.ssh/cortex_deploy_key)"
fly secrets set NIRVANA_WIKI_REPO_URL="git@github.com:hindole/nirvana-wiki.git"
fly secrets set NIRVANA_WIKI_LOCAL_DIR="/data/nirvana-wiki"
fly secrets set NIRVANA_WIKI_SSH_KEY_PATH="/data/cortex-key"
```

Entrypoint script (Dockerfile addition):
```dockerfile
# Source: synthesized from https://vsupalov.com/build-docker-image-clone-private-repo-ssh-key/
# In Dockerfile production stage:
RUN apt-get update && apt-get install -y git openssh-client && rm -rf /var/lib/apt/lists/*

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
```

```sh
#!/bin/sh
# scripts/entrypoint.sh
set -e

if [ -n "$NIRVANA_WIKI_DEPLOY_KEY_B64" ] && [ -n "$NIRVANA_WIKI_SSH_KEY_PATH" ]; then
  echo "$NIRVANA_WIKI_DEPLOY_KEY_B64" | base64 -d > "$NIRVANA_WIKI_SSH_KEY_PATH"
  chmod 600 "$NIRVANA_WIKI_SSH_KEY_PATH"

  # Pre-add github.com to known_hosts to avoid first-time prompt
  mkdir -p /root/.ssh
  ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null
fi

exec node dist/src/main.js
```

### Telegraf Inline Keyboard Removal at Timeout
```typescript
// Source: https://github.com/telegraf/telegraf/issues/399 (community-validated pattern)
// Plus existing pattern in cortex's notification.service.ts

const sentMsg = await ctx.reply(text, {
  parse_mode: 'HTML',
  ...Markup.inlineKeyboard([Markup.button.callback('↩️ Undo', `note:undo:${noteId}`)]),
});

const timer = setTimeout(() => {
  ctx.telegram.editMessageReplyMarkup(
    sentMsg.chat.id,
    sentMsg.message_id,
    undefined,
    { inline_keyboard: [] },  // empty array, NOT empty object
  ).catch((err) => {
    // Telegram returns 400 if message is too old or already edited — safe to ignore
    if (!String(err).includes('message is not modified')) {
      this.logger.warn(`Undo keyboard removal failed: ${err}`);
    }
  });
}, 60_000);
timer.unref(); // don't keep process alive for this
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `nodegit` (libgit2 native bindings) | `simple-git` (CLI subprocess) | ~2019 (nodegit maintenance lapses) | Native module compilation breaks across Node versions; CLI wrapper is more portable. |
| Pure-JS `isomorphic-git` for server use | `simple-git` for server, `isomorphic-git` for browser only | ~2020 onward | isomorphic-git's value prop is browser support; using it server-side gains nothing and adds API friction. |
| Build-arg SSH keys in Dockerfile | Runtime secret materialization (Fly secrets + entrypoint, or Docker BuildKit `--mount=type=ssh`) | ~2020 (BuildKit GA) | Build-arg keys persist in image layers — security hole. Runtime materialization keeps key on volume only. |
| `git pull` in automation | `git fetch + git reset --hard origin/main` for cache-style clones | Long-standing best practice for non-source-of-truth working trees | Avoids merge attempts when local has divergent state. |

**Deprecated/outdated:**
- `nodegit`: Maintained but slow-moving; native bindings cause persistent CI/CD pain. Avoid for greenfield.
- BullMQ for cortex: Already replaced with pg-boss per Phase 4 decisions (Upstash incompatibility).
- Storing audio: HLD explicitly forbids; cortex retains transcripts only.

## Open Questions

1. **NOTE-03 reply-to-transcription mechanics**
   - **What we know:** When a user replies `/note` to a previous bot message that contains a transcription, NOTE-03 says we re-route from "task" to "note." The reply target is `ctx.message.reply_to_message`.
   - **What's unclear:**
     - The current `OrchestratorService.handleVoice()` shows the transcription via `formatter.formatTranscription(transcription)` and then *immediately* classifies and routes (typically creating a task). By the time a user could reply `/note` to that transcription, the task already exists. Do we (a) just create the note and ignore the task that was already created, (b) delete the task, or (c) only support this if the user replies before the task is fully processed (which is racey)?
     - Where exactly is the transcript text retrievable from? The bot's reply contains the formatted transcription HTML. We can either parse it back out, or store the original transcript on the bot message ID for a short window in Redis.
   - **Recommendation:** v1: Strip the formatting from `reply_to_message.text` to recover the transcript and create a note. Do NOT delete the task — leave it as a side effect. Document this clearly in the user-facing `/help`. If the user wants a clean note from a voice transcription, the cleaner path is to send `/note` *before* the voice. Defer auto-task-deletion to v1.1 if it becomes a real annoyance.

2. **Workspace assignment for notes from a bare `/note` (no prefix, no session)**
   - **What we know:** NOTE-04 requires a Workspace header. `WorkspaceService.getDefault()` always returns one.
   - **What's unclear:** Should notes support `@work` / `@personal` prefix like tasks? HLD doesn't say.
   - **Recommendation:** Yes — for symmetry with task capture. Parse the prefix in `handleNoteCommand`, strip it from the body before persisting. Falls back to default workspace. Easy to add; low risk; high consistency value.

3. **`/vault recent` ordering and what counts**
   - **What we know:** VAULT-06 (Phase 7b) defines the command. Phase 7a creates VaultWrite rows from note operations; Phase 7b adds meeting writes.
   - **What's unclear:** Does `/vault recent` include failed writes? Reverts (which create new commits but represent undos)?
   - **Recommendation:** Show last 10 ordered by createdAt DESC, include both kinds (note/meeting), include both succeeded and failed (failed shown with ❌). Reverts: Don't surface as separate entries — instead, mark the original Note's VaultWrite row as "reverted" and display accordingly. (This is a Phase 7b plan detail; flag it but defer.)

4. **Should we monitor / alert on Fly volume disk fill?**
   - **What we know:** 1 GB volume; HLD projects <200 MB working set for 5+ years. Vast headroom.
   - **What's unclear:** Whether to wire monitoring in v1.
   - **Recommendation:** No. The numbers don't warrant operational complexity. Revisit if growth surprises (or if meeting transcripts in 7b are larger than projected).

5. **Push conflict retry: exactly one retry, or exponential backoff?**
   - **What we know:** HLD §3.9 says "retry once with fresh fetch + replay. After 2 failures, surface to user."
   - **What's unclear:** Whether "2 failures" means the initial attempt + 1 retry, or 2 retries (3 attempts total).
   - **Recommendation:** Read HLD literally: total of 2 attempts (initial + 1 retry). On second failure, persist failed VaultWrite + Telegram-notify. Matches the spec's intent of "low probability conflict, don't paper over a real problem."

6. **Should the slug be deterministic-by-content or LLM-creative?**
   - **What we know:** NOTE-05 says Sonnet generates a 4-6 word kebab-case slug.
   - **What's unclear:** How to handle Sonnet returning an unusable slug (too long, special chars, empty).
   - **Recommendation:** Apply a normalization layer (the `slug` npm library) to whatever Sonnet returns. If after normalization the slug is empty or <2 chars, fall back to a date-time-only filename (`2026-04-26-1432-note.md`). Log the LLM raw output in this fallback case for prompt-tuning later. Validate via Zod regex (`/^[a-z0-9]+(-[a-z0-9]+){2,5}$/`) and retry once on failure.

## Sources

### Primary (HIGH confidence)

- **`simple-git` GitHub repo** — https://github.com/steveukx/git-js — current version 3.28, API for clone/commit/push/reset, `.env('GIT_SSH_COMMAND', ...)` SSH support, `--author` flag for commits. Maintained, 11M weekly downloads.
- **`async-mutex` GitHub repo** — https://github.com/DirtyHairy/async-mutex — `Mutex.runExclusive()` API, `withTimeout()` decorator. v0.5 stable.
- **Fly.io Volume Storage Docs** — https://fly.io/docs/launch/volume-storage/ — `[[mounts]]` syntax, `fly volume create`, `initial_size` semantics. (Note: Volume must exist before `fly deploy` or deploy fails.)
- **Fly.io Configuration Reference** — https://fly.io/docs/reference/configuration/ — confirmed `[[mounts]]` (double brackets), `initial_size` only used by `fly launch/deploy`, `fly volume show` to verify.
- **`pg-boss` README + DeepWiki** — https://deepwiki.com/timgit/pg-boss — `startAfter`, `singletonKey`, `expireInSeconds` semantics. Confirmed pg-boss is overkill for 60s UI windows.
- **Existing cortex codebase** — directly inspected:
  - `src/telegram/telegram.update.ts` — confirmed `@Command` ordering vs `@On('text')`, `@Action` regex pattern
  - `src/telegram/services/orchestrator.service.ts` — `pendingContactResolutions: Map` pattern reused for note-voice state
  - `src/scheduler/notification.service.ts` — `@InjectBot()` + `Markup.inlineKeyboard` pattern
  - `src/llm/classification.service.ts` + `llm.service.ts` + `llm.types.ts` — exact pattern for adding `'slug-generation'` operation
  - `src/scheduler/reminder.service.ts` — `pg-boss` `singletonKey` + `expireInSeconds` already in use (good reference if we ever switch undo to a job)
  - `Dockerfile` — multi-stage build, where to add `git`/`openssh-client` apt install + entrypoint script
  - `fly.toml` — current shape, where to add `[[mounts]]`
  - `prisma/schema.prisma` — pattern for Prisma 7 model definition, how indexes/maps are declared

### Secondary (MEDIUM confidence)

- **Fly.io community thread on multiline secrets** — https://community.fly.io/t/cannot-add-private-key-using-flyctl-to-a-environment-variable/10435 — confirms the multiline parser issue; community-recommended workaround is base64.
- **vsupalov.com — SSH keys in Docker** — https://vsupalov.com/build-docker-image-clone-private-repo-ssh-key/ — confirms build-arg secrets persist in image layers; recommends multi-stage or runtime materialization. Cross-verified against Docker official docs.
- **Telegraf issue #399 (clear keyboard pattern)** — https://github.com/telegraf/telegraf/issues/399 — confirms `editMessageReplyMarkup({inline_keyboard: []})` works; empty `{}` returns 400.
- **Snyk advisor / npm-compare for git libs** — https://npm-compare.com/isomorphic-git,nodegit,simple-git — download counts and maintenance signals confirming simple-git as the de-facto choice for Node-side server git automation.

### Tertiary (LOW confidence — flagged for validation at implementation time)

- **`fly secrets import` for multiline values** — referenced in community posts but Fly's official docs are sparse on this command's exact behavior with files containing `=` characters. Validate at deploy time. Recommendation favors base64 anyway, sidestepping this uncertainty.
- **NestJS `OnModuleInit` blocks HTTP listener startup** — widely understood as true and matches my reading of `@nestjs/core` source, but I didn't verify against current docs. Defensive `await this.ready` in VaultService.writeFile makes this irrelevant.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — simple-git, async-mutex, and existing project libraries (Telegraf, Anthropic SDK, Prisma, pg-boss) are all well-documented and already proven in this codebase.
- Architecture: **HIGH** — VaultService isolation, mutex serialization, two-phase voice note pattern, and slug-generation-as-LLM-op all map cleanly to existing cortex patterns. Codebase inspection grounded every recommendation.
- Pitfalls: **HIGH** for git/Telegram pitfalls (verified via multiple sources + codebase). **MEDIUM** for Fly.io secret-as-file pattern — the base64 workaround is community-recommended but I haven't deployed it personally for this project. First deploy will validate.

**Research date:** 2026-04-26
**Valid until:** 2026-07-26 (90 days for stable libs; revisit if simple-git or async-mutex publish breaking changes, or if Fly.io changes their secret-as-file mechanism)
