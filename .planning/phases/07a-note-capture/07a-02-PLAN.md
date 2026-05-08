---
phase: 07a-note-capture
plan: 02
type: execute
wave: 2
depends_on: ["07a-01"]
files_modified:
  - src/llm/llm.types.ts
  - src/llm/slug.service.ts
  - src/llm/slug.service.spec.ts
  - src/llm/prompts/slug.prompt.ts
  - src/llm/llm.module.ts
  - src/telegram/services/orchestrator.service.ts
  - src/telegram/services/message-formatter.service.ts
  - src/telegram/telegram.constants.ts
  - src/telegram/telegram.module.ts
  - src/telegram/telegram.update.ts
autonomous: true
requirements:
  - NOTE-01
  - NOTE-02
  - NOTE-03
  - NOTE-04
  - NOTE-05
  - NOTE-06
  - NOTE-07
  - NOTE-08
  - NOTE-09

must_haves:
  truths:
    - "User sends `/note <text>` and within ~6s receives a Telegram reply with vault path, commit sha, and an [Undo] inline button"
    - "User sends bare `/note` then a voice message and within ~10s receives the same reply with the verbatim transcript saved at raw/inbox/YYYY-MM-DD-{slug}.md"
    - "User replies `/note` to a previously-transcribed voice message and the transcript is written to raw/inbox/ as a note (the originally-created task is left untouched in v1)"
    - "User taps [Undo] within 60 seconds and the bot reverts the commit, soft-deletes the Note row, and replies `Reverted.`"
    - "User sends a voice note longer than 10 minutes after `/note` and the bot rejects it with a clear error before any Whisper API call"
    - "User sending `/note` during an active task follow-up session does NOT clear pending follow-ups, advance the session state, or alter pendingFollowUps in Redis"
    - "Each successful note results in a verbatim file body (no LLM rewriting) with a Source/Captured/Workspace header, written under raw/inbox/ only"
    - "User sends `/vault recent` and receives the 10 most recent vault writes (notes only in this phase) with status indicators"
  artifacts:
    - path: "src/llm/slug.service.ts"
      provides: "SlugService.generate(body) — Sonnet call returning a normalized 4-6 word kebab-case slug, with fallback to date-time-only slug"
      min_lines: 50
    - path: "src/llm/prompts/slug.prompt.ts"
      provides: "buildSlugPrompt() returning the cache-controlled system prompt"
      min_lines: 15
    - path: "src/telegram/services/orchestrator.service.ts"
      provides: "handleNoteCommand, handleNoteVoice, handleNoteUndoCallback, handleVaultRecent + pendingNoteVoiceSessions Map; handleVoice extended to short-circuit on pending note session"
      contains: "handleNoteCommand"
    - path: "src/telegram/services/message-formatter.service.ts"
      provides: "formatNoteSaved(), formatNoteReverted(), formatVaultRecent() with HTML escaping and inline-keyboard helpers"
      contains: "formatNoteSaved"
    - path: "src/telegram/telegram.update.ts"
      provides: "@Command('note'), @Command('vault'), @Action(/^note:undo:(.+)$/) decorators on TelegramUpdate"
      contains: "@Command('note')"
    - path: "src/llm/llm.types.ts"
      provides: "'slug-generation' added to LlmOperation union and MODEL_MAP routes it to claude-sonnet-4-6"
      contains: "slug-generation"
  key_links:
    - from: "src/telegram/telegram.update.ts"
      to: "src/telegram/services/orchestrator.service.ts"
      via: "@Command('note') -> orchestrator.handleNoteCommand(ctx)"
      pattern: "@Command\\(['\"]note['\"]\\)"
    - from: "src/telegram/services/orchestrator.service.ts"
      to: "src/vault/vault.service.ts"
      via: "this.vault.writeFile({ vaultPath, body, commitMessage, kind: 'note', sourceId: ... })"
      pattern: "vault\\.writeFile"
    - from: "src/telegram/services/orchestrator.service.ts"
      to: "src/note/note.service.ts"
      via: "this.noteService.create(...) after successful vault write; this.noteService.softDelete(...) on undo"
      pattern: "noteService\\.(create|softDelete|recent|findById)"
    - from: "src/telegram/services/orchestrator.service.ts"
      to: "src/llm/slug.service.ts"
      via: "this.slugService.generate(body)"
      pattern: "slugService\\.generate"
    - from: "src/telegram/telegram.update.ts"
      to: "src/telegram/services/orchestrator.service.ts"
      via: "@Action(/^note:undo:(.+)$/) -> orchestrator.handleNoteUndoCallback(ctx)"
      pattern: "note:undo"
    - from: "src/telegram/services/orchestrator.service.ts"
      to: "(note voice short-circuit)"
      via: "handleVoice() checks pendingNoteVoiceSessions BEFORE calling classifyAndRoute"
      pattern: "pendingNoteVoiceSessions"
---

<objective>
Wire the user-facing `/note` Telegram side-channel on top of the VaultService + NoteService primitives built in plan 07a-01. This plan adds the only LLM call in the note flow (Sonnet slug generation), the three forms of `/note` (inline text, bare-then-voice, reply-to-transcription), the 60-second [Undo] inline button, the 10-minute voice cap (pre-Whisper), the Source/Captured/Workspace header format, the `@work`/`@personal` prefix support, and the `/vault recent` command — all without disturbing the existing task-capture flow.

Purpose: Close the loop between Telegram and the vault. After this plan, every Phase 7a success criterion in ROADMAP.md is observable end-to-end.

Output:
- New SlugService + slug prompt + Sonnet operation registration
- Extended OrchestratorService with note handlers + pending-voice-session map + undo + /vault recent
- Extended MessageFormatterService with note-saved / note-reverted / vault-recent formatters
- New @Command('note'), @Command('vault'), @Action(note:undo:...) decorators on TelegramUpdate
- TelegramModule wired to import VaultModule + NoteModule
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
@.planning/phases/07a-note-capture/07a-01-SUMMARY.md

@src/telegram/telegram.update.ts
@src/telegram/services/orchestrator.service.ts
@src/telegram/services/message-formatter.service.ts
@src/telegram/services/voice.service.ts
@src/telegram/telegram.module.ts
@src/llm/classification.service.ts
@src/llm/llm.types.ts
@src/llm/llm.service.ts
@src/llm/llm.module.ts

<interfaces>
<!-- Exports from plan 07a-01 that this plan consumes. Use these directly. -->

From src/vault/vault.types.ts:
```typescript
export interface WriteFileInput {
  vaultPath: string;
  body: string;
  commitMessage: string;
  kind: 'note' | 'meeting';
  sourceId: string;
}
export interface WriteFileResult {
  commitSha: string;
  vaultPath: string;  // post-collision-resolution
}
export interface RevertResult {
  commitSha: string;
}
```

From src/vault/vault.service.ts:
```typescript
export class VaultService implements OnModuleInit {
  async writeFile(input: WriteFileInput): Promise<WriteFileResult>;     // throws on path violation or unrecoverable git failure; ALWAYS records VaultWrite
  async revertLastCommit(expectedSha: string): Promise<RevertResult>;   // throws if HEAD has moved; ALWAYS records VaultWrite
}
```

From src/note/note.service.ts:
```typescript
export class NoteService {
  async create(input: { workspaceId, source, body, slug, vaultPath, vaultCommitSha, telegramMsgId? }): Promise<Note>;
  async findById(id: string): Promise<Note | null>;
  async softDelete(id: string): Promise<Note>;
  async recent(limit?: number): Promise<Note[]>;
}
```

From src/llm/llm.types.ts (existing — we ADD to LlmOperation and MODEL_MAP):
```typescript
export type LlmOperation = 'decomposition' | 'classification' | ... ;  // add 'slug-generation'
export const MODEL_MAP: Record<LlmOperation, string> = { decomposition: 'claude-opus-4-6', classification: 'claude-sonnet-4-6', ... };
```

From src/llm/llm.service.ts:
```typescript
export class LlmService {
  async createMessage(operation, systemPrompt, messages, outputSchema?, maxTokens?): Promise<{ content: string; usage: ... }>;
}
```

From src/workspace/workspace.service.ts:
```typescript
export class WorkspaceService {
  async getDefault(): Promise<{ id: string; name: 'personal' | 'work'; ... }>;
  async findByName(name: 'personal' | 'work'): Promise<Workspace | null>;
}
```

From src/telegram/telegram.update.ts (existing pattern — see file for ordering rules):
- @Command('xxx') decorators MUST be declared BEFORE @On('text'). The existing file has them in this order — preserve it when adding @Command('note') and @Command('vault').
- @Action(/^...$/) regex must be unique per callback prefix.

From src/telegram/services/orchestrator.service.ts:
- Existing pattern for in-memory pending-state Maps: `pendingContactResolutions = new Map<string, ...>()`. Mirror exactly for `pendingNoteVoiceSessions`.
- handleVoice() currently calls classifyAndRoute after transcription — we INTERCEPT at the top of handleVoice BEFORE transcription (10-min cap also lives here, BEFORE Whisper, per RESEARCH.md Pitfall 6).
- formatProcessingError(error) helper exists for consistent error replies.

From src/telegram/services/message-formatter.service.ts:
- Existing private `escapeHtml(text)` method — reuse for ALL user-controlled content in note formatters.
- Pattern: methods return either a string OR `{ text, extra }` for messages with inline keyboards.
- Use `import { Markup } from 'telegraf'` and `Markup.inlineKeyboard([Markup.button.callback('label', 'callback:data')])`.

From src/llm/classification.service.ts (mirror this exactly for SlugService):
- Inject LlmService.
- Build system prompt via a separate prompts/*.prompt.ts file.
- Call `this.llm.createMessage(operation, systemPrompt, messages, jsonSchema, maxTokens)`.
- Parse with `Zod.parse(JSON.parse(response.content))`; throw with logger.error on failure.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add SlugService — Sonnet operation, prompt, service, normalizer, tests</name>
  <files>src/llm/llm.types.ts, src/llm/slug.service.ts, src/llm/slug.service.spec.ts, src/llm/prompts/slug.prompt.ts, src/llm/llm.module.ts</files>
  <action>
**Update `src/llm/llm.types.ts`:**

1. Extend `LlmOperation` union:
   ```typescript
   export type LlmOperation =
     | 'decomposition'
     | 'classification'
     | 'follow-up'
     | 'enrichment'
     | 'comment-extraction'
     | 'calendar-extraction'
     | 'direct-calendar-extraction'
     | 'slug-generation';   // NEW
   ```

2. Extend `MODEL_MAP`:
   ```typescript
   export const MODEL_MAP: Record<LlmOperation, string> = {
     decomposition: 'claude-opus-4-6',
     classification: 'claude-sonnet-4-6',
     'follow-up': 'claude-sonnet-4-6',
     enrichment: 'claude-sonnet-4-6',
     'comment-extraction': 'claude-sonnet-4-6',
     'calendar-extraction': 'claude-sonnet-4-6',
     'direct-calendar-extraction': 'claude-sonnet-4-6',
     'slug-generation': 'claude-sonnet-4-6',  // NEW
   };
   ```

3. Append a new schema at the end of the file:
   ```typescript
   export const SlugResultSchema = z.object({
     slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+){2,5}$/),  // 3-6 hyphenated tokens
   });
   export type SlugResult = z.infer<typeof SlugResultSchema>;
   ```

**Create `src/llm/prompts/slug.prompt.ts`:**

Mirror the cache-controlled array shape used by the existing classification prompt. The system prompt should:
- Tell the model it generates kebab-case file slugs only
- Constrain to 4-6 words, lowercase a-z and digits, hyphens between words, no punctuation, no leading/trailing hyphens
- Demand it returns JSON `{ "slug": "..." }` and nothing else
- Forbid summarization, paraphrasing, or content rewriting (the body is verbatim — only the *filename* is generated)
- Include 3 input/output examples spanning short, medium, and long inputs

```typescript
export function buildSlugPrompt(): Array<{
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}> {
  const text = `You generate kebab-case filename slugs for personal notes.

## Rules
- Output JSON ONLY: {"slug": "..."}.
- The slug MUST be 4-6 lowercase words separated by single hyphens.
- Allowed characters: a-z, 0-9, hyphen.
- No leading/trailing hyphens. No double hyphens. No punctuation. No quotes.
- Do NOT summarize, paraphrase, or interpret the note. Just produce a slug that hints at the topic.
- Prefer the most specific concrete nouns from the input.

## Examples

Input: "Pick up dry cleaning before Tuesday"
Output: {"slug":"pick-up-dry-cleaning"}

Input: "Idea for fynos: surface a per-customer cost trend on the dashboard so we can spot anomalies before invoicing"
Output: {"slug":"per-customer-cost-trend-idea"}

Input: "Re-read Eisenhower decision matrix essay; the urgent vs important framing keeps coming back when I prioritize"
Output: {"slug":"eisenhower-matrix-revisit"}
`;
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
```

**Create `src/llm/slug.service.ts`:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import slugify from 'slug';
import { LlmService } from './llm.service';
import { SlugResultSchema } from './llm.types';
import { buildSlugPrompt } from './prompts/slug.prompt';

@Injectable()
export class SlugService {
  private readonly logger = new Logger(SlugService.name);
  // Slug regex matches what we send to the LLM and what we accept after normalization.
  private static readonly SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+){2,5}$/;

  constructor(private readonly llm: LlmService) {}

  /**
   * Generate a 4-6 word kebab-case slug for `body`.
   * Falls back to a date-time-only slug if the LLM returns something unusable.
   * NEVER throws — always returns a valid slug or the fallback.
   */
  async generate(body: string): Promise<string> {
    const sample = body.slice(0, 500); // slug only needs first ~500 chars
    try {
      const response = await this.llm.createMessage(
        'slug-generation',
        buildSlugPrompt(),
        [{ role: 'user', content: sample }],
        z.toJSONSchema(SlugResultSchema) as Record<string, unknown>,
        64,
      );

      // Try the LLM's slug as-is (it should already be kebab-case).
      const raw = JSON.parse(response.content)?.slug as string | undefined;
      if (raw && SlugService.SLUG_REGEX.test(raw)) return raw;

      // Defense in depth: normalize via the slug library and re-check.
      if (raw) {
        const normalized = slugify(raw, { lower: true });
        if (SlugService.SLUG_REGEX.test(normalized)) return normalized;
      }

      this.logger.warn(`Sonnet returned unusable slug, falling back. Raw: ${raw}`);
    } catch (err) {
      this.logger.warn(`Slug generation failed (${err}), falling back to date-time slug`);
    }
    return SlugService.dateTimeFallback(new Date());
  }

  /** Public for testability. e.g. 2026-04-26-1432-note (we prefix the date in the filename, so this returns just the time-tail). */
  static dateTimeFallback(now: Date): string {
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    return `${hh}${mm}-note`;
  }
}
```

Note: `slug` (npm) default export is the slugify function — `import slugify from 'slug';` — installed in plan 07a-01.

**Create `src/llm/slug.service.spec.ts`:**

Mirror `classification.service.spec.ts`. Tests:
1. Valid Sonnet response → returns slug as-is.
2. Sonnet response with leading/trailing hyphens → normalizes via `slug` library and returns clean slug.
3. Sonnet returns junk (single-word, "—-—", empty) → falls back to `HHMM-note` format (assert regex `^\d{4}-note$`).
4. LlmService.createMessage throws → falls back to `HHMM-note` (does NOT propagate the error).
5. Calls LlmService with `'slug-generation'` operation, maxTokens=64, and the cache-controlled system prompt array shape.

**Update `src/llm/llm.module.ts`:**

Add `SlugService` to providers and exports:
```typescript
import { SlugService } from './slug.service';
// ...
providers: [..., SlugService],
exports: [..., SlugService],
```
  </action>
  <verify>
    <automated>npm test -- src/llm/slug.service.spec 2>&amp;1 | tail -20 && npm run build 2>&amp;1 | tail -10</automated>
  </verify>
  <done>SlugService tests pass (valid slug pass-through, normalization, fallback on junk, fallback on LlmService error, correct LLM call shape); `npm run build` succeeds; LlmModule exports SlugService.</done>
</task>

<task type="auto">
  <name>Task 2: Extend OrchestratorService + MessageFormatterService + telegram.constants for the note flow</name>
  <files>src/telegram/services/orchestrator.service.ts, src/telegram/services/message-formatter.service.ts, src/telegram/telegram.constants.ts</files>
  <action>
**Update `src/telegram/telegram.constants.ts`:**

Add a NOTE callback prefix (mirrors existing patterns like `task:`, `tb:`, etc.):
```typescript
// Existing exports unchanged...
export const NOTE_CALLBACK_PREFIX = 'note:undo';  // full key shape: note:undo:{noteId}
```
(Use whatever export name format already exists in this file — match it.)

**Update `src/telegram/services/message-formatter.service.ts`:**

Add three new public methods (and rely on the existing private `escapeHtml`):

```typescript
// Note: `noteId` is used to wire the inline-keyboard callback.
formatNoteSaved(input: {
  noteId: string;
  vaultPath: string;
  commitSha: string;
}): { text: string; extra: Record<string, unknown> } {
  const shortSha = input.commitSha.slice(0, 7);
  const text =
    `📝 <b>Note saved</b>\n` +
    `<code>${this.escapeHtml(input.vaultPath)}</code>\n` +
    `commit <code>${this.escapeHtml(shortSha)}</code>`;
  const extra = {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      Markup.button.callback('↩️ Undo', `note:undo:${input.noteId}`),
    ]),
  };
  return { text, extra };
}

formatNoteReverted(): string {
  return '↩️ <b>Reverted.</b>';
}

formatVaultRecent(rows: Array<{
  createdAt: Date;
  kind: 'note' | 'meeting';
  vaultPath: string;
  succeeded: boolean;
}>): string {
  if (rows.length === 0) return '<i>No vault writes yet.</i>';
  const lines = rows.map((r) => {
    const status = r.succeeded ? '✅' : '❌';
    const when = r.createdAt.toISOString().slice(0, 16).replace('T', ' ');
    return `${status} <code>${when}</code> ${this.escapeHtml(r.vaultPath)}`;
  });
  return `📜 <b>Recent vault writes</b>\n\n${lines.join('\n')}`;
}
```

**Update `src/telegram/services/orchestrator.service.ts`:**

This is the meat of the plan. Add the following pieces (do NOT touch the existing handleText/handleVoice/classifyAndRoute logic except where explicitly noted):

1. **New imports at the top:**
   ```typescript
   import { Markup } from 'telegraf';
   import { VaultService } from '../../vault/vault.service';
   import { NoteService } from '../../note/note.service';
   import { SlugService } from '../../llm/slug.service';
   ```

2. **New state map** (alongside existing `pendingContactResolutions`):
   ```typescript
   private pendingNoteVoiceSessions = new Map<
     string,  // chatId
     { workspaceId: string; expiresAt: Date }
   >();
   private static readonly NOTE_VOICE_TTL_MS = 5 * 60 * 1000;  // 5 min
   private static readonly NOTE_VOICE_MAX_DURATION_S = 600;     // 10 min hard cap (NOTE-08)
   private static readonly UNDO_WINDOW_MS = 60 * 1000;          // 60 sec (NOTE-06, NOTE-07)
   ```

3. **Add to constructor injection list:**
   ```typescript
   private readonly vault: VaultService,
   private readonly noteService: NoteService,
   private readonly slugService: SlugService,
   ```

4. **MODIFY `handleVoice(ctx)`** — add a short-circuit at the very top, BEFORE the try/catch that calls `getFileLink` and Whisper:
   ```typescript
   async handleVoice(ctx: Context): Promise<void> {
     const chatId = String(ctx.chat!.id);
     const message = ctx.message as Record<string, any>;
     const voice = message.voice;

     // 10-min cap (NOTE-08): check BEFORE Whisper to avoid burning $$ on rejected audio.
     // We enforce this for note voices only — task voice flow uses its own existing path.
     const noteSession = this.pendingNoteVoiceSessions.get(chatId);
     if (noteSession && noteSession.expiresAt > new Date()) {
       this.pendingNoteVoiceSessions.delete(chatId);
       if (voice?.duration && voice.duration > OrchestratorService.NOTE_VOICE_MAX_DURATION_S) {
         await ctx.reply(
           '⏱️ Voice notes are capped at 10 minutes. Please send a shorter clip.',
         );
         return;
       }
       return this.handleNoteVoice(ctx, chatId, noteSession.workspaceId);
     }

     // (existing handleVoice body unchanged below this point)
     // ...
   }
   ```

5. **NEW: `async handleNoteCommand(ctx: Context): Promise<void>`** — routes the three forms:

   ```typescript
   async handleNoteCommand(ctx: Context): Promise<void> {
     try {
       const chatId = String(ctx.chat!.id);
       const message = ctx.message as Record<string, any>;
       const rawText: string = (message.text ?? '').replace(/^\/note(@\w+)?\s*/, '');

       // Form 3: reply to a previously transcribed voice message
       const replyTo = message.reply_to_message;
       if (replyTo?.from?.is_bot && typeof replyTo.text === 'string') {
         // Existing transcription format from MessageFormatterService.formatTranscription:
         //   "🎤 I heard:\n<i>...</i>\n\nProcessing..."
         // The plain-text version of `replyTo.text` strips HTML tags but preserves the body.
         const transcript = this.extractTranscriptFromTranscriptionMessage(replyTo.text);
         if (transcript) {
           const { workspace, body } = this.parseWorkspacePrefix(transcript);
           const wsId = workspace
             ? (await this.workspace.findByName(workspace))?.id
             : (await this.workspace.getDefault()).id;
           if (!wsId) {
             await ctx.reply('Could not resolve workspace for note.');
             return;
           }
           await this.persistNote(ctx, { workspaceId: wsId, source: 'voice', body });
           return;
         }
       }

       // Form 1: /note <text>
       if (rawText.length > 0) {
         const { workspace, body } = this.parseWorkspacePrefix(rawText);
         const wsId = workspace
           ? (await this.workspace.findByName(workspace))?.id
           : (await this.workspace.getDefault()).id;
         if (!wsId) {
           await ctx.reply('Could not resolve workspace for note.');
           return;
         }
         await this.persistNote(ctx, { workspaceId: wsId, source: 'text', body });
         return;
       }

       // Form 2: bare /note → arm pending voice session
       const ws = await this.workspace.getDefault();
       this.pendingNoteVoiceSessions.set(chatId, {
         workspaceId: ws.id,
         expiresAt: new Date(Date.now() + OrchestratorService.NOTE_VOICE_TTL_MS),
       });
       await ctx.reply('🎤 Send your voice message — I\'ll save it as a note. (5-min window)');
     } catch (error) {
       this.logger.error(`Error handling /note: ${error}`);
       await ctx.reply(this.formatProcessingError(error));
     }
   }
   ```

6. **NEW: `private async handleNoteVoice(ctx, chatId, workspaceId)`** — invoked from handleVoice when a pending note session matched:

   ```typescript
   private async handleNoteVoice(ctx: Context, chatId: string, workspaceId: string): Promise<void> {
     try {
       await ctx.sendChatAction('typing');
       const message = ctx.message as Record<string, any>;
       const fileLink = await ctx.telegram.getFileLink(message.voice.file_id);
       const transcript = await this.voice.transcribe(fileLink);
       await this.persistNote(ctx, { workspaceId, source: 'voice', body: transcript });
     } catch (error) {
       this.logger.error(`Error handling note voice: ${error}`);
       await ctx.reply('Sorry, I couldn\'t process that voice note. Please try again.');
     }
   }
   ```

7. **NEW: `private async persistNote(ctx, input)`** — the shared core (slug → vault write → DB row → Telegram reply with [Undo]):

   ```typescript
   private async persistNote(
     ctx: Context,
     input: { workspaceId: string; source: 'text' | 'voice'; body: string },
   ): Promise<void> {
     const { workspaceId, source, body } = input;
     const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });

     // 1. Generate slug (Sonnet — falls back internally on failure, never throws).
     const slug = await this.slugService.generate(body);

     // 2. Build vault path + body.
     const dateStr = new Date().toISOString().slice(0, 10);  // UTC YYYY-MM-DD
     const vaultPath = `raw/inbox/${dateStr}-${slug}.md`;
     const fileBody =
       `Source: Telegram (${source})\n` +
       `Captured: ${new Date().toISOString()}\n` +
       `Workspace: ${ws.name === 'work' ? 'Work' : 'Personal'}\n` +
       `\n---\n\n` +
       body;

     // 3. Pre-create Note row with placeholder commit sha so we have an ID for the [Undo] callback
     //    AND the vault write's audit log can reference it. We update vaultCommitSha after the push.
     const noteId = randomUUID();
     // Pass sourceId=noteId into vault.writeFile so the VaultWrite audit row links to this note.
     try {
       const writeResult = await this.vault.writeFile({
         vaultPath,
         body: fileBody,
         commitMessage: `note: capture ${slug}`,
         kind: 'note',
         sourceId: noteId,
       });

       // Persist the Note row with the actual commit sha + post-collision vault path.
       await this.prisma.note.create({
         data: {
           id: noteId,
           workspaceId,
           source,
           body,
           slug,
           vaultPath: writeResult.vaultPath,
           vaultCommitSha: writeResult.commitSha,
         },
       });

       // Reply with [Undo] inline keyboard.
       const { text, extra } = this.formatter.formatNoteSaved({
         noteId,
         vaultPath: writeResult.vaultPath,
         commitSha: writeResult.commitSha,
       });
       const sentMsg = await ctx.reply(text, extra);

       // Schedule keyboard removal at 60s (NOTE-06).
       const timer = setTimeout(() => {
         ctx.telegram
           .editMessageReplyMarkup(
             sentMsg.chat.id,
             sentMsg.message_id,
             undefined,
             { inline_keyboard: [] },  // NOT empty object — Telegram returns 400 (RESEARCH.md anti-pattern)
           )
           .catch((err) => {
             const msg = String(err);
             if (!msg.includes('message is not modified')) {
               this.logger.warn(`Failed to clear undo keyboard: ${msg}`);
             }
           });
       }, OrchestratorService.UNDO_WINDOW_MS);
       timer.unref();
     } catch (err) {
       this.logger.error(`Vault write failed for note ${noteId}: ${err}`);
       await ctx.reply(`❌ Failed to save note: ${String(err).slice(0, 200)}`);
     }
   }
   ```

   Note: `randomUUID` is already imported in this file. Do not re-import.

8. **NEW: `async handleNoteUndoCallback(ctx: Context): Promise<void>`** — handles the `note:undo:{noteId}` callback:

   ```typescript
   async handleNoteUndoCallback(ctx: Context): Promise<void> {
     try {
       const data = (ctx.callbackQuery as any)?.data as string | undefined;
       const match = data?.match(/^note:undo:(.+)$/);
       if (!match) {
         await ctx.answerCbQuery('Bad callback');
         return;
       }
       const noteId = match[1];
       const note = await this.noteService.findById(noteId);
       if (!note) {
         await ctx.answerCbQuery('Note not found');
         return;
       }
       if (note.deletedAt) {
         await ctx.answerCbQuery('Already undone');
         return;
       }
       const ageMs = Date.now() - note.createdAt.getTime();
       if (ageMs > OrchestratorService.UNDO_WINDOW_MS) {
         await ctx.answerCbQuery('Undo window expired');
         return;
       }
       if (!note.vaultCommitSha) {
         await ctx.answerCbQuery('No commit to revert');
         return;
       }

       await this.vault.revertLastCommit(note.vaultCommitSha);
       await this.noteService.softDelete(noteId);

       await ctx.answerCbQuery('Reverted');
       await ctx.editMessageReplyMarkup({ inline_keyboard: [] });  // remove the [Undo] button
       await ctx.reply(this.formatter.formatNoteReverted(), { parse_mode: 'HTML' });
     } catch (error) {
       this.logger.error(`Error handling note undo: ${error}`);
       await ctx.answerCbQuery('Undo failed — vault may have moved on');
     }
   }
   ```

9. **NEW: `async handleVaultRecentCommand(ctx: Context): Promise<void>`** — `/vault recent` (and bare `/vault`) shows the last 10 vault writes:

   ```typescript
   async handleVaultRecentCommand(ctx: Context): Promise<void> {
     try {
       const rows = await this.prisma.vaultWrite.findMany({
         orderBy: { createdAt: 'desc' },
         take: 10,
       });
       const text = this.formatter.formatVaultRecent(rows);
       await ctx.reply(text, { parse_mode: 'HTML' });
     } catch (error) {
       this.logger.error(`Error fetching vault recent: ${error}`);
       await ctx.reply(this.formatProcessingError(error));
     }
   }
   ```

10. **Helper methods** (private, on OrchestratorService):

    ```typescript
    /** Strip Telegram HTML and the formatTranscription chrome to recover the original transcript. */
    private extractTranscriptFromTranscriptionMessage(text: string): string | null {
      // Telegram's reply_to_message.text is already the plain-text rendering (HTML tags stripped),
      // but the chrome from formatTranscription remains: "🎤 I heard:\n<body>\n\nProcessing..."
      const match = text.match(/I heard:\s*\n([\s\S]+?)\n\nProcessing\.\.\./);
      return match ? match[1].trim() : null;
    }

    /** Parse @work / @personal prefix from the start of a note body. Returns the workspace name (if any) and the stripped body. */
    private parseWorkspacePrefix(text: string): {
      workspace: 'work' | 'personal' | null;
      body: string;
    } {
      const m = text.match(/^@(work|personal)\s+([\s\S]+)$/i);
      if (m) return { workspace: m[1].toLowerCase() as 'work' | 'personal', body: m[2].trim() };
      return { workspace: null, body: text.trim() };
    }
    ```

**NOTE-09 (side-channel) compliance:** `handleNoteCommand` MUST NOT call `this.session.refreshTtl`, `this.session.getOrCreate`, or modify any pending follow-up state. It also MUST NOT call `classifyAndRoute`. The `@Command('note')` decorator firing before `@On('text')` ensures handleText is never called for /note messages.

**Quick sanity tests** (add to `src/telegram/services/orchestrator.service.spec.ts` if it exists; else add a small `note-handlers.spec.ts` next to it):
- `parseWorkspacePrefix("@work go to lunch")` → `{ workspace: 'work', body: 'go to lunch' }`
- `parseWorkspacePrefix("regular note")` → `{ workspace: null, body: 'regular note' }`
- `extractTranscriptFromTranscriptionMessage("🎤 I heard:\nfoo bar\n\nProcessing...")` → `"foo bar"`
- `extractTranscriptFromTranscriptionMessage("not a transcript")` → `null`

(These two helpers are pure functions — no mocking needed.)
  </action>
  <verify>
    <automated>npm run build 2>&amp;1 | tail -10 && npm test -- src/telegram src/llm/slug 2>&amp;1 | tail -20</automated>
  </verify>
  <done>OrchestratorService compiles with new handlers and constructor injections; pendingNoteVoiceSessions Map and 10-min cap are in handleVoice (BEFORE Whisper); persistNote does slug → vault.writeFile → noteService.create → reply-with-[Undo] → setTimeout-clear-keyboard; handleNoteUndoCallback checks age + deletedAt + missing-sha defensively; handleVaultRecentCommand returns formatted last-10 list; helper unit tests for parseWorkspacePrefix and extractTranscriptFromTranscriptionMessage pass.</done>
</task>

<task type="auto">
  <name>Task 3: Wire telegram.update.ts decorators + telegram.module.ts imports + smoke-test on Fly</name>
  <files>src/telegram/telegram.update.ts, src/telegram/telegram.module.ts</files>
  <action>
**Update `src/telegram/telegram.module.ts`:**

Add VaultModule and NoteModule to imports so OrchestratorService can resolve VaultService, NoteService, and SlugService (SlugService comes via the existing LlmModule import):

```typescript
import { VaultModule } from '../vault/vault.module';
import { NoteModule } from '../note/note.module';

@Module({
  imports: [
    TelegrafModule.forRootAsync(...),
    ConfigModule,
    PrismaModule,
    LlmModule,            // already exports SlugService after plan 07a-02 task 1
    SessionModule,
    forwardRef(() => TaskModule),
    WorkspaceModule,
    CommentModule,
    CalendarModule,
    VaultModule,          // NEW
    NoteModule,           // NEW
  ],
  providers: [...],       // unchanged
  exports: [...],         // unchanged
})
```

**Update `src/telegram/telegram.update.ts`:**

Add `@Command('note')`, `@Command('vault')`, and `@Action(/^note:undo:(.+)$/)` decorators. Place the @Command decorators BEFORE the existing `@On('text')` (line ~48) — preserve the existing ordering invariant documented in the file's class comment.

```typescript
// (Add these methods between the existing @Command('settings') and the existing @On('text'))

@Command('note')
async onNote(@Ctx() ctx: Context) {
  await this.orchestrator.handleNoteCommand(ctx);
}

@Command('vault')
async onVault(@Ctx() ctx: Context) {
  await this.orchestrator.handleVaultRecentCommand(ctx);
}

// (Add this @Action method alongside the other @Action methods at the bottom of the class)

@Action(/^note:undo:(.+)$/)
async onNoteUndo(@Ctx() ctx: Context) {
  await this.orchestrator.handleNoteUndoCallback(ctx);
}
```

The `/vault recent` command per the planning context: telegraf's `@Command('vault')` matches both `/vault` and `/vault <args>`. Our handler ignores args and always returns the recent-10 list — sufficient for v1. (When Phase 7b adds `/vault writes`, `/vault status`, etc., the handler will branch on args.)

**Build, test, and deploy:**

```bash
npm run build
npm test
fly deploy -a cortex-hindole
```

Watch the deploy logs for any DI errors at boot (`Nest can't resolve dependencies of OrchestratorService` would mean a module import is missing — most likely VaultModule or NoteModule not added to TelegramModule).

**End-to-end smoke test from your phone (the only way to genuinely prove the loop closes):**

1. Send `/note testing one two three` to the bot.
2. Within ~6s expect: `📝 Note saved` reply with `raw/inbox/YYYY-MM-DD-<slug>.md`, a 7-char commit sha, and an `↩️ Undo` button.
3. Visit https://github.com/hindole/nirvana-wiki/tree/main/raw/inbox — verify the file exists with the exact body `Source: Telegram (text)\nCaptured: ...\nWorkspace: ...\n\n---\n\ntesting one two three`.
4. Verify the commit author is `cortex-bot <bot@cortex.local>` in `git log` on GitHub.
5. Tap `↩️ Undo` within 60s. Expect: `↩️ Reverted.` reply, the file disappears from GitHub (a revert commit is added).
6. Tap `↩️ Undo` AGAIN after the first undo succeeded. Expect a callback toast `Already undone` and no second revert.
7. Send bare `/note`. Expect prompt: `🎤 Send your voice message — I'll save it as a note. (5-min window)`.
8. Send a short voice message (~10s). Expect the same `📝 Note saved` reply, file body should contain `Source: Telegram (voice)` and the verbatim transcript.
9. Send `/vault recent`. Expect a list of the writes you just made, status ✅.
10. (Side-channel proof) Trigger an active task follow-up: send a brain dump like "I need to ship the new feature by Friday". When the bot asks a follow-up question, send `/note random thought` instead of answering. Expect: note saved (step 2 reply), then send the actual answer to the follow-up — the session should still be alive and the answer should land as expected on the original task.
11. (Cost-guard proof) Try a voice longer than 10 minutes after `/note`. Expect: `⏱️ Voice notes are capped at 10 minutes...`. Verify in OpenAI billing dashboard that NO Whisper call was made for that voice.

If any step fails, capture the bot reply and `fly logs -a cortex-hindole` output and stop — investigate before declaring success.
  </action>
  <verify>
    <automated>npm run build 2>&amp;1 | tail -5 &amp;&amp; npm test 2>&amp;1 | tail -15 &amp;&amp; grep -q "@Command('note')" src/telegram/telegram.update.ts &amp;&amp; grep -q "@Action(/\^note:undo" src/telegram/telegram.update.ts &amp;&amp; grep -q "VaultModule" src/telegram/telegram.module.ts &amp;&amp; grep -q "NoteModule" src/telegram/telegram.module.ts</automated>
  </verify>
  <done>Build succeeds; all unit tests pass (existing + new SlugService + new helper tests); telegram.update.ts has @Command('note'), @Command('vault'), and @Action(note:undo); telegram.module.ts imports VaultModule + NoteModule; `fly deploy` succeeds with no DI errors at boot; the 11-step smoke test from a real phone confirms all six phase-level success criteria.</done>
</task>

</tasks>

<verification>
- `npm test` passes (SlugService tests + parseWorkspacePrefix/extractTranscript helpers + existing suite still green).
- `npm run build` produces zero TypeScript errors.
- `fly deploy` succeeds; app boots; no DI errors in `fly logs`.
- All 11 manual smoke-test steps in Task 3 pass on the real Telegram bot against the real nirvana-wiki repo.
- VaultWrite rows accumulate in Postgres for every note write (`SELECT * FROM vault_writes ORDER BY created_at DESC LIMIT 10` shows them).
- For each smoke-test note: a corresponding Note row exists in Postgres with non-null vaultCommitSha; for each `[Undo]` tap: deletedAt is set on that Note row.
- Phase 7a success criteria from ROADMAP.md, all 6, are verifiable end-to-end.
</verification>

<success_criteria>
- NOTE-01: `/note <text>` writes raw/inbox/YYYY-MM-DD-{slug}.md within ~6s ✅
- NOTE-02: `/note` then voice writes the same path with the transcript within ~10s ✅
- NOTE-03: replying `/note` to a transcribed voice creates a note (the original task is left untouched per researcher recommendation 1) ✅
- NOTE-04: file body has Source/Captured/Workspace header + verbatim body ✅
- NOTE-05: 4-6 word kebab-case slug from Sonnet, with HHMM-note fallback ✅
- NOTE-06: bot reply has vault path, 7-char commit sha, [Undo] button valid 60s ✅
- NOTE-07: [Undo] within 60s reverts the commit (new revert commit), pushes, soft-deletes the Note ✅
- NOTE-08: voice >10 min rejected BEFORE Whisper (cost guard verified) ✅
- NOTE-09: `/note` during active task follow-up does not interrupt the session (handler bypasses classifyAndRoute and session.refreshTtl entirely) ✅
- Bonus: `/vault recent` returns the last 10 vault writes with status emoji (this builds VAULT-06's surface ahead of Phase 7b — Phase 7b will extend it for meeting writes).
</success_criteria>

<output>
After completion, create `.planning/phases/07a-note-capture/07a-02-SUMMARY.md` summarizing:
- New SlugService (Sonnet operation, normalizer, fallback) and where the existing LLM patterns guided the shape
- OrchestratorService extensions (handleNoteCommand, handleNoteVoice, persistNote, handleNoteUndoCallback, handleVaultRecentCommand) with the pendingNoteVoiceSessions Map
- The three forms of /note and how reply-to-transcription is detected (regex against the existing formatTranscription output)
- The 60-second undo timer pattern (setTimeout + .unref() + defensive age/deletedAt check on the callback)
- The 10-min voice cap implementation site (handleVoice short-circuit, BEFORE Whisper) and OpenAI bill verification
- Side-channel posture: list of orchestrator methods touched, confirmation that none call session.refreshTtl in the note path
- Workspace prefix parsing (@work/@personal) — implemented per researcher recommendation 2
- /vault recent: built ahead of Phase 7b for early visibility; VAULT-06 will be marked satisfied when 7b ships meeting writes
- Deviations from RESEARCH.md (if any) and rationale
- Any pitfalls hit during smoke testing and how they were resolved
</output>
