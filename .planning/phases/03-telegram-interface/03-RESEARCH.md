# Phase 3: Telegram Interface - Research

**Researched:** 2026-02-28
**Domain:** Telegram Bot API integration, voice transcription, inline keyboards, command handling
**Confidence:** HIGH

## Summary

Phase 3 wires the existing domain layer (Phase 1: TaskService, WorkspaceService) and intelligence layer (Phase 2: DecompositionService, ClassificationService, FollowUpService, EnrichmentService, SessionService) to a Telegram bot interface. The user will interact exclusively through Telegram -- sending text or voice messages, receiving structured task breakdowns, managing tasks via inline keyboard buttons, running slash commands, and adding comments to tasks.

The standard approach is `nestjs-telegraf` (v2.9.1), which wraps the `telegraf` (v4.16.x) Telegram bot framework with NestJS-native decorators, guards, and module integration. Voice transcription uses the OpenAI SDK (`openai` npm package) with the `whisper-1` model, which natively accepts OGG files (Telegram's voice format). The architecture requires a new `TelegramModule` that orchestrates the end-to-end flow: receive update -> classify intent -> route to handler -> call domain/intelligence services -> format and send response with inline keyboards.

**Primary recommendation:** Use `nestjs-telegraf` 2.9.1 + `telegraf` 4.16.x for the Telegram bot with webhook mode. Use `openai` npm package for Whisper transcription. Add a `Comment` model to the Prisma schema. Implement a `ChatIdGuard` for single-user authentication. Structure handlers by concern (text, voice, callbacks, commands) as separate NestJS providers decorated with `@Update()`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CAP-01 | User can send text message to Telegram bot and have it processed as task input | nestjs-telegraf `@On('text')` decorator routes text messages to handler; ClassificationService determines intent; DecompositionService creates tasks; response sent with `ctx.reply()` and inline keyboards |
| CAP-02 | User can send voice message; system transcribes via Whisper, shows transcription, and auto-processes | `@On('voice')` captures voice messages; `ctx.telegram.getFileLink()` downloads OGG; OpenAI `audio.transcriptions.create()` with `whisper-1` model accepts OGG natively; transcription shown then auto-processed through same pipeline as text |
| TASK-04 | User can manage tasks via inline keyboard buttons (Done, Start, Defer, Edit) | `Markup.inlineKeyboard()` creates button rows; callback_data encodes `action:taskId`; `@Action(/regex/)` handles callbacks; `ctx.editMessageText()` updates the message after state change |
| TASK-05 | User can run /tasks, /workspace, /help, /settings commands | `@Command('tasks')`, `@Command('workspace')`, `@Command('help')`, `@Command('settings')` decorators handle each command; TaskService.findAll() and WorkspaceService provide data |
| TASK-06 | User can add comments to tasks by replying to bot messages or referencing task ID | `ctx.message.reply_to_message` detects replies; store `telegram_msg_id` on tasks to map replies back to tasks; new Comment model in Prisma stores comment content and source |
| INTL-04 | System extracts action items from task comments and suggests new sub-tasks | New `CommentProcessingService` uses Sonnet via LlmService to extract action items from comment text; suggests sub-tasks via inline keyboard confirmation; reuses EnrichmentService pattern for task creation |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| nestjs-telegraf | 2.9.1 | NestJS wrapper for Telegraf with decorators, guards, DI | Official NestJS-Telegraf bridge; v2.9.1 explicitly supports NestJS 11 peer dependency; provides `@Update`, `@On`, `@Command`, `@Action` decorators |
| telegraf | 4.16.3 | Telegram Bot API framework for Node.js | Most mature Node.js Telegram library; 16K+ GitHub stars; webhook support built-in; TypeScript types; `Markup` API for keyboards |
| openai | ^6 | OpenAI API client for Whisper transcription | Official SDK; `audio.transcriptions.create()` with `toFile()` helper for buffer-to-file conversion; accepts OGG natively |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All other dependencies already in project: `@anthropic-ai/sdk`, `ioredis`, `@prisma/client`, `@nestjs/config` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nestjs-telegraf + telegraf | @grammyjs/nestjs + grammy | grammY has better TypeScript types and 137K weekly downloads vs telegraf's larger ecosystem; however nestjs-telegraf is more battle-tested with NestJS, has explicit NestJS 11 support, and the project already uses decorator-heavy patterns that align well |
| openai (whisper-1) | gpt-4o-transcribe | gpt-4o-transcribe is newer and potentially more accurate, but whisper-1 at $0.006/min is cheaper; can upgrade later by changing model string |
| Webhook mode | Long polling | Polling is simpler for development but wastes resources on always-on Fly.io; webhook is the project's locked decision (PROJECT.md) |

**Installation:**
```bash
npm install nestjs-telegraf telegraf openai
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── telegram/                    # New TelegramModule
│   ├── telegram.module.ts       # Module: imports TelegrafModule, LlmModule, TaskModule, etc.
│   ├── telegram.update.ts       # @Update() class: routes to handlers
│   ├── handlers/
│   │   ├── text.handler.ts      # @On('text') - brain dump / follow-up / comment detection
│   │   ├── voice.handler.ts     # @On('voice') - download, transcribe, process
│   │   ├── callback.handler.ts  # @Action() - inline keyboard button presses
│   │   └── command.handler.ts   # @Command() - /tasks, /workspace, /help, /settings
│   ├── guards/
│   │   └── chat-id.guard.ts     # CanActivate guard: checks ctx.chat.id against OWNER_CHAT_ID
│   ├── services/
│   │   ├── voice.service.ts     # Downloads voice file, calls Whisper, returns transcription
│   │   ├── message-formatter.service.ts  # Formats task breakdowns into Telegram messages with keyboards
│   │   └── orchestrator.service.ts       # End-to-end flow: classify -> route -> process -> respond
│   └── telegram.constants.ts   # Callback data prefixes, command names, message templates
├── comment/                     # New CommentModule (or extend TaskModule)
│   ├── comment.service.ts       # CRUD for comments + action item extraction
│   └── comment.module.ts
├── llm/                         # Existing - add comment-processing prompt
│   ├── prompts/
│   │   └── comment-extraction.prompt.ts  # New: extract action items from comments
│   └── ...existing files
├── task/                        # Existing - add telegram_msg_id field handling
├── session/                     # Existing - used as-is
└── ...existing modules
```

### Pattern 1: TelegrafModule Setup with Webhook
**What:** Configure nestjs-telegraf with async factory for environment-based config and webhook mode
**When to use:** Always -- this is the entry point for the Telegram bot

```typescript
// src/telegram/telegram.module.ts
import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        token: config.getOrThrow<string>('TELEGRAM_BOT_TOKEN'),
        launchOptions: {
          webhook: {
            domain: config.getOrThrow<string>('WEBHOOK_DOMAIN'),
            hookPath: `/bot/${config.getOrThrow<string>('TELEGRAM_BOT_TOKEN')}`,
          },
        },
      }),
      inject: [ConfigService],
    }),
    // ...other module imports
  ],
})
export class TelegramModule {}
```

```typescript
// src/main.ts - webhook middleware setup
import { getBotToken } from 'nestjs-telegraf';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const bot = app.get(getBotToken());
  app.use(bot.webhookCallback(`/bot/${process.env.TELEGRAM_BOT_TOKEN}`));
  await app.listen(process.env.PORT ?? 3000);
}
```

### Pattern 2: Update Handler with Decorators
**What:** NestJS provider decorated with `@Update()` that uses `@On`, `@Command`, `@Action` to handle Telegram updates
**When to use:** For all Telegram event handling

```typescript
// src/telegram/telegram.update.ts
import { Update, On, Command, Action, Ctx, Start } from 'nestjs-telegraf';
import { UseGuards } from '@nestjs/common';
import { Context } from 'telegraf';
import { ChatIdGuard } from './guards/chat-id.guard';

@Update()
@UseGuards(ChatIdGuard)
export class TelegramUpdate {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply('Welcome to Cortex! Send me a brain dump or voice message.');
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    // Delegate to orchestrator which classifies and routes
    await this.orchestrator.handleText(ctx);
  }

  @On('voice')
  async onVoice(@Ctx() ctx: Context) {
    await this.orchestrator.handleVoice(ctx);
  }

  @Action(/^task:(done|start|defer|edit):(.+)$/)
  async onTaskAction(@Ctx() ctx: Context) {
    await this.orchestrator.handleCallback(ctx);
  }

  @Command('tasks')
  async onTasks(@Ctx() ctx: Context) { /* ... */ }

  @Command('workspace')
  async onWorkspace(@Ctx() ctx: Context) { /* ... */ }

  @Command('help')
  async onHelp(@Ctx() ctx: Context) { /* ... */ }

  @Command('settings')
  async onSettings(@Ctx() ctx: Context) { /* ... */ }
}
```

### Pattern 3: ChatId Guard for Single-User Auth
**What:** NestJS guard that restricts bot to the owner's chat_id
**When to use:** Applied globally to all handlers via `@UseGuards()`

```typescript
// src/telegram/guards/chat-id.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegrafExecutionContext } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Injectable()
export class ChatIdGuard implements CanActivate {
  private readonly ownerChatId: number;

  constructor(config: ConfigService) {
    this.ownerChatId = config.getOrThrow<number>('OWNER_CHAT_ID');
  }

  canActivate(context: ExecutionContext): boolean {
    const ctx = TelegrafExecutionContext.create(context);
    const telegrafCtx = ctx.getContext<Context>();
    return telegrafCtx.chat?.id === this.ownerChatId;
  }
}
```

### Pattern 4: Voice Message Pipeline
**What:** Download OGG from Telegram, send to Whisper, return transcription
**When to use:** When `@On('voice')` fires

```typescript
// src/telegram/services/voice.service.ts
import OpenAI, { toFile } from 'openai';

@Injectable()
export class VoiceService {
  private readonly openai: OpenAI;

  constructor() {
    this.openai = new OpenAI(); // Uses OPENAI_API_KEY env var
  }

  async transcribe(ctx: Context): Promise<string> {
    const voice = (ctx.message as any).voice;
    const fileLink = await ctx.telegram.getFileLink(voice.file_id);

    // Download OGG to buffer
    const response = await fetch(fileLink.href);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Send to Whisper -- OGG accepted natively, no conversion needed
    const transcription = await this.openai.audio.transcriptions.create({
      file: await toFile(buffer, 'voice.ogg', { contentType: 'audio/ogg' }),
      model: 'whisper-1',
    });

    return transcription.text;
  }
}
```

### Pattern 5: Inline Keyboard for Task Management
**What:** Create action buttons on task messages, handle callbacks to update state
**When to use:** Every task display message

```typescript
// src/telegram/services/message-formatter.service.ts
import { Markup } from 'telegraf';

@Injectable()
export class MessageFormatterService {
  formatTaskWithKeyboard(task: any): { text: string; keyboard: any } {
    const statusEmoji = { captured: '📥', active: '📋', in_progress: '🔄', done: '✅', blocked: '🚫', deferred: '⏸️' };
    const text = `${statusEmoji[task.status]} *${this.escapeMarkdown(task.title)}*\n` +
      (task.description ? `${this.escapeMarkdown(task.description)}\n` : '') +
      `Priority: ${task.priority} | Status: ${task.status}`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Done', `task:done:${task.id}`),
        Markup.button.callback('▶️ Start', `task:start:${task.id}`),
      ],
      [
        Markup.button.callback('⏸️ Defer', `task:defer:${task.id}`),
        Markup.button.callback('✏️ Edit', `task:edit:${task.id}`),
      ],
    ]);

    return { text, keyboard };
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }
}
```

### Pattern 6: Callback Data Encoding
**What:** Encode action and task ID in callback_data string, decode with regex
**When to use:** For all inline keyboard interactions

```
Format: "action:subaction:entityId"
Examples:
  "task:done:550e8400-e29b-41d4-a716-446655440000"
  "task:start:550e8400-e29b-41d4-a716-446655440000"
  "task:defer:550e8400-e29b-41d4-a716-446655440000"
  "task:edit:550e8400-e29b-41d4-a716-446655440000"
  "confirm:subtask:550e8400-e29b-41d4-a716-446655440000"

Decoding: @Action(/^task:(done|start|defer|edit):(.+)$/)
  ctx.match[1] = action (e.g., "done")
  ctx.match[2] = taskId (UUID)
```

**Important:** Telegram callback_data is limited to 64 bytes. UUIDs are 36 chars, prefix adds ~10 chars, well within limit.

### Pattern 7: Orchestrator Service (End-to-End Flow)
**What:** Central service that coordinates the full message processing pipeline
**When to use:** Called by the Update handler for every incoming message

```typescript
// src/telegram/services/orchestrator.service.ts
@Injectable()
export class OrchestratorService {
  constructor(
    private readonly classification: ClassificationService,
    private readonly decomposition: DecompositionService,
    private readonly followUp: FollowUpService,
    private readonly enrichment: EnrichmentService,
    private readonly session: SessionService,
    private readonly task: TaskService,
    private readonly workspace: WorkspaceService,
    private readonly voice: VoiceService,
    private readonly formatter: MessageFormatterService,
  ) {}

  async handleText(ctx: Context): Promise<void> {
    const chatId = String(ctx.chat.id);
    const text = (ctx.message as any).text;

    // 1. Get or create session
    const { session } = await this.session.getOrCreate(chatId);

    // 2. Classify intent
    const pendingFollowUps = session.activeTopic?.pendingFollowUps ?? [];
    const classification = await this.classification.classify(text, pendingFollowUps);

    // 3. Route based on intent
    switch (classification.intent) {
      case 'new_brain_dump':
        await this.handleBrainDump(ctx, chatId, text, session);
        break;
      case 'follow_up_answer':
        await this.handleFollowUpAnswer(ctx, chatId, text, session);
        break;
      case 'command':
        // Commands handled by @Command decorators, this is fallback
        await ctx.reply('Use /tasks, /workspace, /help, or /settings');
        break;
      case 'unclear':
        await ctx.reply('I didn\'t quite understand that. Try sending a brain dump or use /help.');
        break;
    }
  }

  async handleVoice(ctx: Context): Promise<void> {
    // 1. Show "processing" indicator
    await ctx.sendChatAction('typing');

    // 2. Transcribe
    const transcription = await this.voice.transcribe(ctx);

    // 3. Show transcription to user
    await ctx.reply(`🎤 I heard: "${transcription}"\n\nProcessing...`);

    // 4. Process as text (auto-proceed per project decision)
    // ... same flow as handleText with transcription as input
  }
}
```

### Pattern 8: Reply-to-Message Comment Detection
**What:** Detect when user replies to a bot task message and create a comment
**When to use:** In text handler when `ctx.message.reply_to_message` exists

```typescript
// Inside orchestrator or text handler
async handleText(ctx: Context): Promise<void> {
  const message = ctx.message as any;

  // Check if this is a reply to a bot message (comment flow)
  if (message.reply_to_message?.from?.is_bot) {
    const replyMsgId = message.reply_to_message.message_id;
    // Look up task by telegram_msg_id
    const task = await this.task.findByTelegramMsgId(replyMsgId);
    if (task) {
      await this.handleComment(ctx, task, message.text);
      return;
    }
  }

  // Normal message classification flow...
}
```

### Anti-Patterns to Avoid
- **Monolithic update handler:** Do not put all logic in a single `@Update()` class. Split into orchestrator + specialized handlers/services.
- **Blocking on LLM calls without typing indicator:** Always call `ctx.sendChatAction('typing')` before LLM operations to show the user the bot is working.
- **Storing full Telegram context in session:** Store only essential data (chat_id, message_id) -- Context objects are not serializable.
- **Using polling in production:** Webhook mode is the project decision (PROJECT.md). Polling wastes Fly.io resources.
- **Ignoring answerCbQuery:** Always call `ctx.answerCbQuery()` after handling a callback query, or Telegram shows a loading spinner indefinitely.
- **Hardcoded bot token in code:** Use ConfigService / environment variables.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram Bot API client | Custom HTTP wrapper for Bot API | telegraf 4.16.x | Handles update types, serialization, file uploads, rate limiting, webhook verification |
| NestJS-Telegram integration | Custom module with middleware wiring | nestjs-telegraf 2.9.1 | Provides decorators, guards integration, module lifecycle management, multi-bot support |
| Voice transcription | Custom speech-to-text pipeline | OpenAI Whisper via `openai` npm package | $0.006/min, accepts OGG natively, >95% accuracy for English |
| Inline keyboard builder | Manual JSON construction | `telegraf` `Markup.inlineKeyboard()` API | Type-safe, handles button layout, callback_data encoding |
| Webhook secret verification | Custom header validation | telegraf's built-in `secretToken` option | Automatically validates X-Telegram-Bot-Api-Secret-Token header |
| OGG to other format conversion | ffmpeg/sox conversion pipeline | Direct OGG to Whisper | Whisper API accepts OGG natively -- no conversion needed |

**Key insight:** The Telegram Bot API has many subtle behaviors (markdown escaping, callback query timeouts, file link expiry, message size limits). Telegraf handles all of these. The OpenAI SDK's `toFile()` helper eliminates the need to write temp files to disk for Whisper transcription.

## Common Pitfalls

### Pitfall 1: Telegram Message Length Limit
**What goes wrong:** Task breakdown messages exceed Telegram's 4096 character limit for text messages, causing the send to fail silently or error.
**Why it happens:** Brain dumps with many sub-tasks produce long formatted messages.
**How to avoid:** Implement message splitting in MessageFormatterService. Check text length before sending; if > 4000 chars, split into multiple messages. Only the last message gets the inline keyboard.
**Warning signs:** `Bad Request: message is too long` errors in logs.

### Pitfall 2: Callback Data 64-Byte Limit
**What goes wrong:** Callback data exceeds 64 bytes, causing Telegram to reject the inline keyboard.
**Why it happens:** Encoding too much information in callback_data (e.g., full task titles or descriptions).
**How to avoid:** Use the `action:subaction:uuid` pattern. UUIDs are 36 chars + prefix is well within 64 bytes. Never put variable-length data in callback_data.
**Warning signs:** Keyboards silently fail to appear on messages.

### Pitfall 3: Not Answering Callback Queries
**What goes wrong:** After the user taps an inline button, a loading spinner stays on the button indefinitely.
**Why it happens:** Forgetting to call `ctx.answerCbQuery()` in the `@Action` handler.
**How to avoid:** Always call `ctx.answerCbQuery()` at the end of every callback handler, even on errors. Can include optional notification text: `ctx.answerCbQuery('Task marked as done!')`.
**Warning signs:** Persistent loading spinners on buttons; users think the bot is frozen.

### Pitfall 4: Voice File Link Expiry
**What goes wrong:** Voice file download fails intermittently.
**Why it happens:** Telegram file links from `getFileLink()` expire after ~60 minutes, but processing delays or retries can exceed this.
**How to avoid:** Download the file immediately upon receiving the voice message. Do not queue the file link for later processing -- download first, then process the buffer.
**Warning signs:** 403 errors when fetching file links.

### Pitfall 5: Markdown Escaping in MarkdownV2
**What goes wrong:** Messages with special characters fail to send or render incorrectly.
**Why it happens:** Telegram's MarkdownV2 requires escaping of many characters: `_*[]()~\`>#+=|{}.!-`
**How to avoid:** Use a dedicated escape function for all user-generated content. Alternatively, use HTML parse mode which requires fewer escapes. Consider using HTML mode (parse_mode: 'HTML') instead of MarkdownV2 for simpler escaping.
**Warning signs:** `Bad Request: can't parse entities` errors.

### Pitfall 6: Webhook Path Predictability
**What goes wrong:** Unauthorized requests hit the webhook endpoint.
**Why it happens:** Using a predictable path like `/webhook` instead of including the bot token.
**How to avoid:** Include the bot token in the webhook path: `/bot/${BOT_TOKEN}`. Additionally, use telegraf's `secretToken` option to validate the `X-Telegram-Bot-Api-Secret-Token` header.
**Warning signs:** Unexpected update objects in logs from non-Telegram sources.

### Pitfall 7: Race Conditions on Session State
**What goes wrong:** Two rapid messages from the user cause session state corruption (e.g., lost follow-up context).
**Why it happens:** SessionService uses get-modify-set with Redis, not atomic operations. Two concurrent handlers can read stale state.
**How to avoid:** Use Redis WATCH/MULTI for optimistic locking, or implement a per-user mutex using Redlock. For single-user bot, this is low-risk but should be handled for correctness.
**Warning signs:** Follow-up answers not being linked to the correct topic; lost conversation context.

## Code Examples

Verified patterns from official sources:

### Downloading Voice and Transcribing
```typescript
// Source: OpenAI SDK docs + Telegraf getFileLink API
import OpenAI, { toFile } from 'openai';

const openai = new OpenAI(); // Uses OPENAI_API_KEY

async function transcribeVoice(ctx: Context): Promise<string> {
  const voice = (ctx.message as any).voice;
  const link = await ctx.telegram.getFileLink(voice.file_id);
  const res = await fetch(link.href);
  const buffer = Buffer.from(await res.arrayBuffer());

  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(buffer, 'voice.ogg', { contentType: 'audio/ogg' }),
    model: 'whisper-1',
  });
  return transcription.text;
}
```

### Sending Task with Inline Keyboard
```typescript
// Source: Telegraf Markup API docs
import { Markup } from 'telegraf';

async function sendTaskMessage(ctx: Context, task: any) {
  const text = `📋 *${escapeMarkdownV2(task.title)}*\n` +
    `Status: ${task.status} | Priority: ${task.priority}`;

  const sentMsg = await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Done', `task:done:${task.id}`),
        Markup.button.callback('▶️ Start', `task:start:${task.id}`),
      ],
      [
        Markup.button.callback('⏸️ Defer', `task:defer:${task.id}`),
        Markup.button.callback('✏️ Edit', `task:edit:${task.id}`),
      ],
    ]),
  });

  // Store telegram message ID on the task for reply-to tracking
  await taskService.update(task.id, task.workspaceId, {
    telegramMsgId: sentMsg.message_id,
  });
}
```

### Handling Callback Query (Button Press)
```typescript
// Source: nestjs-telegraf + Telegraf action API
import { Action, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Action(/^task:(done|start|defer|edit):(.+)$/)
async onTaskAction(@Ctx() ctx: Context) {
  const match = (ctx as any).match;
  const action = match[1]; // 'done' | 'start' | 'defer' | 'edit'
  const taskId = match[2]; // UUID

  const statusMap: Record<string, string> = {
    done: 'done',
    start: 'in_progress',
    defer: 'deferred',
  };

  if (action === 'edit') {
    await ctx.reply(`Reply to this message with the updated info for task ${taskId}`);
  } else {
    await taskService.update(taskId, workspaceId, { status: statusMap[action] });
    await ctx.editMessageText(`✅ Task updated to: ${statusMap[action]}`);
  }

  await ctx.answerCbQuery(`Task ${action}!`);
}
```

### Command Handler
```typescript
// Source: nestjs-telegraf decorator docs
import { Command, Ctx } from 'nestjs-telegraf';
import { Context } from 'telegraf';

@Command('tasks')
async onTasks(@Ctx() ctx: Context) {
  const workspace = await this.workspace.getDefault();
  const tasks = await this.task.findAll(workspace.id);

  if (tasks.length === 0) {
    await ctx.reply('No tasks in your current workspace. Send me a brain dump!');
    return;
  }

  for (const task of tasks.slice(0, 10)) {
    const { text, keyboard } = this.formatter.formatTaskWithKeyboard(task);
    await ctx.reply(text, { parse_mode: 'MarkdownV2', ...keyboard });
  }

  if (tasks.length > 10) {
    await ctx.reply(`...and ${tasks.length - 10} more tasks.`);
  }
}
```

## Schema Changes Required

The existing Prisma schema needs additions for Phase 3:

### New: Comment Model
```prisma
model Comment {
  id            String   @id @default(uuid())
  taskId        String   @map("task_id")
  task          Task     @relation(fields: [taskId], references: [id])
  content       String
  source        CommentSource @default(user)
  telegramMsgId BigInt?  @map("telegram_msg_id")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([taskId])
  @@map("comments")
}

enum CommentSource {
  user
  system
  llm
}
```

### Modified: Task Model
```prisma
model Task {
  // ...existing fields...
  telegramMsgId BigInt?  @map("telegram_msg_id")  // NEW: maps bot message to task for reply-to tracking
  comments      Comment[]                          // NEW: relation to comments

  @@index([telegramMsgId])  // NEW: for reply-to lookup
  // ...existing indexes...
}
```

### New LLM Operation Type
Add `'comment-extraction'` to the `LlmOperation` type in `llm.types.ts` and map it to Sonnet in `MODEL_MAP`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Telegraf v3 (JavaScript) | Telegraf v4 (TypeScript native) | 2022 | Full TS types, improved middleware, `Markup.button.callback()` API |
| `reply_to_message_id` param | `reply_parameters` object | Bot API 7.0 (2024) | More flexible reply handling; old param still works but deprecated |
| whisper-1 only | gpt-4o-transcribe available | 2025 | Better accuracy possible at slightly higher cost; whisper-1 still cheapest |
| openai SDK v3 `createTranscription()` | openai SDK v4+ `audio.transcriptions.create()` | 2023 | Breaking change in method signature; v4+ uses object params |
| nestjs-telegraf v2.8 (NestJS 10) | nestjs-telegraf v2.9.1 (NestJS 11) | April 2025 | Peer dependency update for NestJS 11 compatibility |

**Deprecated/outdated:**
- `reply_to_message_id` parameter: replaced by `reply_parameters` in Bot API 7.0, but Telegraf abstracts this
- `openai.createTranscription()`: renamed to `openai.audio.transcriptions.create()` in SDK v4

## Open Questions

1. **Telegram message edit vs new message for task updates**
   - What we know: `ctx.editMessageText()` can update the original task message in-place; alternatively, can send a new confirmation message
   - What's unclear: Which UX is better -- editing the original (cleaner chat history) or sending new messages (clearer audit trail)?
   - Recommendation: Edit the original message text and keyboard after state change. Send a brief new message only for confirmations that include follow-up questions. This keeps the chat clean.

2. **Task display pagination for /tasks command**
   - What we know: Telegram chats can become noisy if many tasks are listed; inline keyboards support pagination
   - What's unclear: How many tasks to show per page, and whether to use separate messages or a single paginated message
   - Recommendation: Show 5-10 tasks per command invocation. If more exist, add "Next page" / "Previous page" inline buttons. Store page state in callback_data: `tasks:page:2`.

3. **Edit flow UX**
   - What we know: The "Edit" button needs to allow the user to modify task title, description, priority, or deadline
   - What's unclear: Whether to use a multi-step wizard/scene or a simpler reply-based approach
   - Recommendation: Keep it simple -- "Edit" button sends a prompt "Reply with the changes you'd like to make" and the reply is processed by the LLM to extract what to update (reuse EnrichmentService pattern). Avoid wizard scenes for v1.

## Environment Variables (New)

| Variable | Purpose | Example |
|----------|---------|---------|
| TELEGRAM_BOT_TOKEN | Bot token from @BotFather | `7123456789:AAFx...` |
| OWNER_CHAT_ID | Owner's Telegram chat ID (integer) | `123456789` |
| WEBHOOK_DOMAIN | Public HTTPS domain for webhook | `cortex-app.fly.dev` |
| OPENAI_API_KEY | OpenAI API key for Whisper | `sk-...` |

## Sources

### Primary (HIGH confidence)
- [nestjs-telegraf npm](https://www.npmjs.com/package/nestjs-telegraf) - v2.9.1, NestJS 11 peer dependency confirmed
- [nestjs-telegraf GitHub releases](https://github.com/nksmnf/nestjs-telegraf/releases) - v2.9.0 bumped NestJS 11, v2.9.1 fixed peer deps
- [telegraf.js official docs](https://telegraf.js.org/) - v4.16.3, Markup API, webhook setup, Context API
- [OpenAI API Reference - Audio Transcription](https://platform.openai.com/docs/api-reference/audio/createTranscription) - whisper-1, OGG support, file parameter
- [Telegram Bot API](https://core.telegram.org/bots/api) - callback_data limit, reply_to_message, getFile, voice messages
- Existing codebase analysis - Phase 1 & 2 services, Prisma schema, module structure

### Secondary (MEDIUM confidence)
- [DEV.to nestjs-telegraf tutorial](https://dev.to/endykaufman/add-support-telegram-bot-to-nestjs-with-nestjs-telegraf-2p3c) - Module setup, decorator patterns verified against npm docs
- [DEV.to inline keyboard tutorial](https://dev.to/endykaufman/add-support-use-inlinekeyboard-in-telegram-bot-on-nestjs-439i) - Markup.inlineKeyboard patterns
- [Telegraf tips (hanki.dev)](https://hanki.dev/telegraf-tips/) - Callback data regex pattern, editMessageText
- [OpenAI community - buffer transcription](https://community.openai.com/t/creating-readstream-from-audio-buffer-for-whisper-api/534380) - toFile() helper for buffer-to-file
- [DEV.to voice chatbot](https://dev.to/ngviethoang/build-a-telegram-voice-chatbot-using-chatgpt-api-and-whisper-53e2) - End-to-end voice pipeline pattern
- [grammY comparison](https://grammy.dev/resources/comparison) - Telegraf vs grammY tradeoffs

### Tertiary (LOW confidence)
- None -- all findings verified with at least one official or multiple credible sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - nestjs-telegraf 2.9.1 confirmed NestJS 11 support; telegraf 4.16.x is stable and well-documented; openai SDK is official
- Architecture: HIGH - Patterns derived from official nestjs-telegraf docs, verified with multiple tutorial sources, and aligned with existing codebase conventions (NestJS modules, services, DI)
- Pitfalls: HIGH - Pitfalls sourced from Telegraf GitHub issues, Telegram Bot API documentation, and community experience articles
- Schema changes: HIGH - Comment model directly from HLD data model; telegram_msg_id from HLD Task entity spec

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable libraries, no major releases expected)
