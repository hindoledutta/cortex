# Pitfalls Research

**Domain:** LLM-powered Telegram bot task management (NestJS + Prisma + Redis + Claude API + Whisper)
**Researched:** 2026-02-27
**Confidence:** HIGH (critical pitfalls verified across multiple sources; moderate pitfalls at MEDIUM confidence)

## Critical Pitfalls

### Pitfall 1: BullMQ Is Incompatible with Upstash Redis

**What goes wrong:**
BullMQ, the job queue library planned for scheduled reminders and background processing, is fundamentally incompatible with Upstash Redis. Upstash is not a standard Redis implementation -- it is a custom HTTP-based REST proxy over Redis. BullMQ relies on Redis features (blocking commands like `BRPOPLPUSH`, Lua scripting, pub/sub) that Upstash either does not support or implements differently. Jobs silently fail, queues hang, or the worker never picks up jobs.

**Why it happens:**
The HLD specifies "Redis (Upstash free) + BullMQ for scheduled jobs." This pairing looks reasonable on paper -- both are Redis-adjacent. But Upstash's REST-over-HTTP protocol breaks BullMQ's assumptions about persistent connections and blocking operations. The BullMQ maintainers themselves have flagged this incompatibility.

**How to avoid:**
- **Option A (recommended for free tier):** Replace BullMQ with a Postgres-based job queue like `graphile-worker` or `pg-boss`. Since Neon Postgres is already in the stack, this eliminates the need for a separate Redis-compatible queue service. NestJS has good integration patterns for both.
- **Option B:** Use Upstash Redis only for session/cache and run a real Redis instance (e.g., Fly.io Redis sidecar or Railway Redis) for BullMQ. This adds infrastructure complexity and cost.
- **Option C:** Use `@nestjs/schedule` (cron-based) for simple scheduled tasks like reminders. Suitable if job persistence across restarts is not required.
- Keep Upstash Redis for its intended use: session context cache (simple GET/SET with TTL).

**Warning signs:**
- BullMQ worker processes start but never pick up jobs
- `ECONNRESET` or timeout errors in BullMQ connection logs
- Jobs created but stuck in "waiting" state indefinitely
- Upstash command count spiking from BullMQ's aggressive polling

**Phase to address:**
Phase 1 (foundation) -- this is an architecture decision that must be made before any code is written. Choosing the wrong queue affects the entire scheduler module design.

---

### Pitfall 2: Neon Postgres Free Tier Cold Start Kills Webhook Response Time

**What goes wrong:**
Neon free-tier databases auto-suspend after 5 minutes of inactivity. When a Telegram webhook arrives and the database is suspended, Prisma's connection attempt times out (default 5 seconds) before Neon's compute wakes up (can take 2-5 seconds). The webhook handler returns an error or hangs, and Telegram retries the update -- potentially causing duplicate processing. For a solo user who may go hours between messages, cold starts will be the norm, not the exception.

**Why it happens:**
Neon's free tier is optimized for serverless workloads with many short-lived connections, not always-on services. The 5-minute auto-suspend is not configurable on the free plan. Prisma's default connection timeout is too short for cold starts.

**How to avoid:**
- Use Neon's **connection pooler** endpoint (PgBouncer) for all application queries -- it maintains warm connections that mask many cold starts.
- Increase Prisma's `connect_timeout` to 15-20 seconds in the connection string: `?connect_timeout=20`.
- Use a **separate direct connection** string for Prisma migrations (`prisma migrate deploy`) since PgBouncer does not support DDL operations properly.
- Implement a lightweight keep-alive ping (every 4 minutes) to prevent auto-suspend during active hours. This can be a simple `SELECT 1` cron job.
- Monitor Neon's 100 compute-unit hours/month limit -- a keep-alive during work hours (~10h/day) consumes roughly 75 CU-hours/month, leaving headroom.

**Warning signs:**
- Intermittent `P1001: Can't reach database server` errors from Prisma
- First message after a gap always takes 5-8 seconds; subsequent messages are fast
- Telegram sending duplicate updates (retry after webhook timeout)

**Phase to address:**
Phase 1 (foundation) -- connection string configuration and pooler setup are day-one infrastructure decisions.

---

### Pitfall 3: LLM Session Context Grows Unbounded, Costs Explode

**What goes wrong:**
The conversational follow-up system (B-LLM-3) stores full LLM message history in Redis sessions. As a brain dump conversation progresses (user dumps, system decomposes, user answers follow-ups, system enriches), the context array grows rapidly. Each subsequent LLM call re-sends the entire conversation history. A 10-message exchange can easily reach 5,000-10,000 tokens of context. With Opus at ~$15/MTok input + $75/MTok output, a single complex brain dump session could cost $0.50-$1.00. At several sessions per day, the $20/month budget is blown in a week.

**Why it happens:**
LLMs are stateless -- every call requires the full conversation history. Developers pass the entire session context array to every LLM call without token budgeting. The system prompt alone (Cortex behavior rules, task schema, workspace rules) might consume 2,000-3,000 tokens before any conversation history is added.

**How to avoid:**
- **Token budget per session:** Cap session context at ~4,000 tokens. When exceeded, summarize older messages into a compact context block before the next LLM call.
- **Tiered routing aggressively:** Use Sonnet (not Opus) for follow-up questions, status parsing, and single-task classification. Reserve Opus strictly for the initial brain dump decomposition. The HLD already plans this, but enforce it rigorously.
- **System prompt optimization:** Minimize system prompt token count. Use concise instructions. Measure token count of system prompts and set a budget (target: under 1,500 tokens).
- **Track token usage per call:** Log input/output token counts from every Claude API response. Set up daily cost alerts.
- Use Claude's **prompt caching** -- the system prompt and early conversation turns can be cached, reducing input costs by ~90% on cache hits.

**Warning signs:**
- Session context JSON in Redis growing beyond 10KB
- Individual LLM API calls exceeding 8,000 input tokens
- Monthly Anthropic bill trending above $15 by mid-month
- Follow-up questions taking longer than 3 seconds (large context = slower inference)

**Phase to address:**
Phase 1 -- token budgeting and tiered routing must be designed into the LLM module from the start. Retrofitting token management is painful.

---

### Pitfall 4: Telegram Webhook Retry Storm from Slow LLM Responses

**What goes wrong:**
Telegram requires webhook handlers to respond with HTTP 200 within 60 seconds. Claude Opus brain dump decomposition can take 3-8 seconds. If the webhook handler waits for the full LLM response before acknowledging, and the LLM call fails or times out, Telegram retries the update. If the retry also triggers a slow LLM call that also fails, you enter a retry storm: Telegram keeps re-sending the same update, each triggering an expensive LLM call that may fail again. Even without failures, slow processing blocks the webhook from receiving new updates.

**Why it happens:**
Developers implement webhook handlers synchronously: receive update, call LLM, send response, return 200. This couples acknowledgement to LLM processing. Telegram's retry mechanism is aggressive -- if no 200 is received, it retries with increasing delays.

**How to avoid:**
- **Acknowledge immediately, process asynchronously.** The webhook handler should: (1) validate the update, (2) return HTTP 200 immediately, (3) process the message in a background task (in-process queue or job). This is the standard pattern for Telegram webhook bots.
- **Idempotency:** Track `update_id` from Telegram. Before processing, check if this update_id was already processed. Skip duplicates.
- **Timeout the LLM call:** Set a 15-second timeout on Claude API calls. If exceeded, send the user a "still thinking..." message and retry once with a simpler prompt.
- In NestJS, use a simple in-process event emitter or a micro-task queue for async processing rather than blocking the webhook handler.

**Warning signs:**
- The same message appearing multiple times in logs
- User receiving duplicate task creation confirmations
- Webhook handler response times exceeding 5 seconds in monitoring
- Telegram showing "retry" in webhook info (`getWebhookInfo` shows pending_update_count climbing)

**Phase to address:**
Phase 1 -- the webhook handler architecture must be async-first from the start. Refactoring from sync to async later requires restructuring the entire request flow.

---

### Pitfall 5: LLM Structured Output Parsing Failures Break Task Creation

**What goes wrong:**
The LLM is expected to return structured JSON (task trees, follow-up questions, intent classification). Without schema enforcement, the LLM may: (a) wrap JSON in markdown code fences, (b) add conversational preamble before the JSON, (c) omit required fields, (d) hallucinate extra fields, (e) truncate output mid-JSON due to max_tokens limit. Any of these causes a JSON.parse error, and the user's brain dump is lost -- the worst possible UX for a "zero-friction capture" system.

**Why it happens:**
Developers prompt the LLM to "return JSON" without using the API's structured output enforcement. Or they use `tool_use` but don't validate the response schema. Or `max_tokens` is set too low, causing truncation before the JSON object closes.

**How to avoid:**
- Use Claude's **structured outputs** feature (beta header: `anthropic-beta: structured-outputs-2025-11-13`) to guarantee schema compliance. Define JSON schemas for every LLM response type (brain dump result, follow-up questions, intent classification, task update).
- Alternatively, use **tool_use** with strict schema definitions -- Claude will conform to the tool's input schema.
- Set `max_tokens` generously for decomposition calls (at least 2,048). A brain dump with 5 sub-tasks and follow-up questions can easily require 800-1,200 output tokens.
- Implement a **fallback path:** if structured parsing fails, save the raw LLM output as a single "captured" task with the original message as the title. Never lose user input.
- Add retry logic with exponential backoff (1 retry max) for parsing failures.

**Warning signs:**
- `SyntaxError: Unexpected token` in JSON.parse logs
- Tasks created with null titles or missing fields
- LLM output containing "Here's the JSON:" preamble text
- Truncated JSON in logs (missing closing braces)

**Phase to address:**
Phase 1 -- the LLM module's response handling must be designed with schema enforcement and fallback from the start. This affects every LLM interaction in the system.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded system prompts in code | Fast iteration on prompts | Cannot tune prompts without redeployment; makes A/B testing impossible | Phase 1 MVP only. Move to config/DB-stored prompts by Phase 2 |
| Storing full conversation history in Redis session (no summarization) | Simple implementation | Session objects grow large; LLM costs scale linearly with conversation length | Phase 1 only if sessions are short (< 5 exchanges). Must add summarization before Phase 2 |
| Single Prisma client without connection pooling config | Works in dev | Connection exhaustion under any concurrent load; cold-start timeouts in production | Never -- configure pooler from day one with Neon |
| No LLM token usage tracking | Ships faster | Cannot detect cost overruns until the monthly bill arrives | Never -- log token counts from day one |
| Sync webhook handler (wait for LLM before 200) | Simpler code flow | Retry storms, duplicate processing, blocked updates | Never -- always acknowledge first, process async |
| No idempotency check on `update_id` | Fewer DB lookups | Duplicate tasks from Telegram retries | Phase 1 only if async webhook is solid. Add by Phase 2 at latest |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Telegram Webhook | Setting webhook on non-standard port (e.g., 3000) | Telegram only supports ports 443, 80, 88, and 8443. Fly.io maps internal port to 443 via `fly.toml` services config |
| Telegram Callback Query | Not calling `answerCallbackQuery` after button press | Always call `answerCallbackQuery` immediately, even with empty params. Failure causes a permanent loading spinner on the user's keyboard button |
| Telegram Voice Messages | Assuming Whisper API accepts Telegram's OGG/Opus directly without issues | While Whisper's API docs list OGG as supported, the Opus codec variant from Telegram can cause issues. Test thoroughly; have ffmpeg available for conversion as fallback |
| Telegram `getFile` | Downloading voice files synchronously in the webhook handler | Files can be up to 20MB. Download asynchronously after acknowledging the webhook. Use streaming download to avoid memory spikes |
| Claude API | Sending conversation history without system prompt caching | Enable prompt caching for the system prompt. Without it, the same 1,500-token system prompt is billed as new input on every call. Cached input is ~90% cheaper |
| Claude API | Not setting `max_tokens` appropriately per call type | Classification calls need ~100 tokens. Decomposition needs ~2,048. Follow-ups need ~500. Overestimating wastes money; underestimating truncates output |
| Whisper API | Not setting the `language` parameter for known-language users | Whisper performs better with explicit language hints. For a known English-speaking solo user, always pass `language: "en"` to improve accuracy and reduce latency |
| Google Calendar OAuth | Not requesting `access_type: offline` and `prompt: consent` during initial auth | Without these, Google does not return a refresh token. The access token expires in 1 hour, and the app permanently loses Calendar access with no way to recover except re-authorizing |
| Google Calendar API | Using primary calendar ID for both workspaces | Each workspace (Personal/Work) should map to a distinct Google Calendar. Using the same calendar defeats workspace isolation |
| Neon Postgres | Using the direct connection string for application queries | Use the pooled connection string (`-pooler` suffix) for application queries. Reserve the direct string for `prisma migrate` and `prisma db push` only |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded session context to LLM | Increasing latency on follow-up messages; cost per session climbing | Cap session context at ~4,000 tokens; summarize older turns | After ~8-10 conversation turns |
| N+1 queries on task list with sub-tasks | `/tasks` command takes 2+ seconds; DB query count scales with task count | Use Prisma `include` for eager loading sub-tasks: `findMany({ include: { children: true } })` | At ~50+ active tasks |
| Fly.io machine auto-stop | Webhook stops receiving updates; bot appears offline | Set `auto_stop_machines = false` and `min_machines_running = 1` in `fly.toml` | After 5+ minutes without webhook traffic (rare for bots, but possible during sleep hours) |
| Redis session serialization/deserialization | Increasing latency as session context grows; parse errors on large sessions | Set max session size (e.g., 50KB). Use MessagePack instead of JSON for serialization if sessions grow large | Sessions exceeding ~100KB |
| Prisma cold-start connection timeout | First query after Neon auto-suspend fails with P1001 | Use pooler endpoint; set `connect_timeout=20`; optional keep-alive ping during active hours | After 5 minutes of database inactivity |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not validating Telegram webhook sender | Anyone can POST to your webhook endpoint, injecting fake messages and commands | Validate the `X-Telegram-Bot-Api-Secret-Token` header (set via `secret_token` parameter in `setWebhook`). Reject requests without a valid token |
| Logging full LLM prompts/responses containing user data | Brain dumps may contain sensitive personal/work information that ends up in log aggregators | Log only metadata (token counts, latency, intent classification). Never log raw user messages or LLM responses in production |
| Storing API keys in code or Docker image | Keys leaked via source control or container registry | Use Fly.io secrets (`fly secrets set`). Access via `process.env`. Never commit `.env` files |
| Not restricting bot to owner's `chat_id` | Anyone who discovers the bot can use it, racking up LLM costs | Check `chat_id` against the configured owner ID as the first step in every webhook handler. Silently ignore all other senders |
| Google OAuth refresh token stored in plaintext DB | Token compromise grants full Calendar access | Encrypt the refresh token at rest. Use a separate encryption key stored in Fly.io secrets, not in the database |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No feedback during LLM processing | User sends brain dump, sees nothing for 5+ seconds, wonders if bot is broken | Send immediate "typing" indicator (`sendChatAction: typing`) and/or a "Processing your message..." response within 1 second |
| LLM asks too many follow-up questions | User wanted quick capture but gets interrogated; defeats "zero-friction" promise | Limit follow-ups to 1-2 questions max. Make them optional with a "Skip" inline keyboard button. Never block task creation on follow-up answers |
| Showing raw task IDs (UUIDs) in Telegram | User sees `Task 3f8a2b1c-...` which is meaningless and ugly | Use sequential short IDs for display (e.g., `#42`) while keeping UUIDs internally. Or reference tasks by title in Telegram messages |
| Voice transcription errors silently accepted | User says "call Sarah" but Whisper hears "call Sara"; wrong contact gets calendar invite | Show transcription prominently: "I heard: [text]. Processing..." Give the user a clear "Correct" button. Auto-proceed but make correction easy (reply to the transcription message) |
| Workspace mismatch on capture | User captures a work task during personal hours (wrong default workspace), doesn't notice until later | Always show workspace in the confirmation: "Captured in **Work**: [task title]". Make workspace correction a single button tap on the confirmation message |
| Inline keyboard buttons disappearing after bot restart | User taps old inline keyboard, gets no response or error | Store callback data with enough context to be self-contained (not relying on in-memory state). Always call `answerCallbackQuery` even for stale callbacks with a helpful message like "This button has expired, use /tasks to manage" |

## "Looks Done But Isn't" Checklist

- [ ] **Webhook setup:** Often missing `secret_token` validation -- verify webhook rejects requests without the correct secret header
- [ ] **Voice transcription:** Often missing `language` parameter -- verify Whisper is called with explicit `language: "en"` for improved accuracy
- [ ] **LLM responses:** Often missing output truncation handling -- verify that `max_tokens` is set per call type and truncation is detected (check `stop_reason === "max_tokens"`)
- [ ] **Task creation:** Often missing idempotency -- verify that the same Telegram `update_id` processed twice does not create duplicate tasks
- [ ] **Inline keyboards:** Often missing `answerCallbackQuery` -- verify every callback handler calls it, even on error paths
- [ ] **Session timeout:** Often missing cleanup -- verify expired Redis sessions are actually deleted (set TTL on the key, don't rely on application-level expiry checks)
- [ ] **Database connection:** Often missing pooler configuration -- verify the application uses the Neon pooler endpoint, not the direct connection string
- [ ] **Error responses to user:** Often missing user-friendly error messages -- verify that LLM failures, DB errors, and API timeouts produce a helpful Telegram message ("Something went wrong, your message was saved. I'll process it shortly.") rather than silence
- [ ] **Cost tracking:** Often missing token logging -- verify every Claude API call logs `usage.input_tokens` and `usage.output_tokens` with the model name
- [ ] **Google Calendar refresh token:** Often missing `access_type: offline` + `prompt: consent` -- verify the OAuth flow returns a refresh token, not just an access token

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| BullMQ + Upstash incompatibility | HIGH | Rewrite scheduler module with a different queue backend (pg-boss, graphile-worker, or @nestjs/schedule). Migrate any existing job definitions. All scheduled job tests must be rewritten |
| Neon cold-start timeouts | LOW | Update connection string to pooler endpoint and increase `connect_timeout`. Can be done with zero code changes -- just env var update |
| LLM cost explosion | MEDIUM | Add token tracking immediately. Implement session context summarization. Audit every LLM call site for prompt size. Switch follow-ups to Sonnet if using Opus. Takes 1-2 days to implement properly |
| Webhook retry storm / duplicates | MEDIUM | Add `update_id` deduplication table or Redis set. Make webhook handler async (acknowledge first). Requires restructuring the webhook controller, ~1 day of work |
| LLM parsing failures losing user input | LOW | Add fallback path: on parse failure, create a raw "captured" task with the original message. Can be added as a try/catch wrapper in ~2 hours |
| Google Calendar refresh token missing | LOW | Re-run OAuth flow with correct parameters. Single manual step. But if the app was deployed without it, every existing session loses Calendar access and users must re-authorize |
| Inline keyboards stop working after deploy | LOW | Ensure callback data is self-contained (includes task ID, action). Handle unknown/expired callbacks gracefully with `answerCallbackQuery("This action has expired")` |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| BullMQ + Upstash incompatibility | Phase 1 (architecture) | Scheduler module uses pg-boss/graphile-worker or @nestjs/schedule; BullMQ is not in dependencies |
| Neon cold-start timeouts | Phase 1 (infrastructure) | Connection string uses `-pooler` suffix; `connect_timeout` >= 15; first query after 10-minute gap succeeds |
| LLM context cost explosion | Phase 1 (LLM module) | Token usage logged per call; session context capped; Opus used only for decomposition; monthly cost tracking dashboard or alert |
| Webhook retry storm | Phase 1 (Telegram module) | Webhook handler returns 200 within 100ms; LLM processing is async; `update_id` deduplication present |
| LLM structured output failures | Phase 1 (LLM module) | Schema enforcement via structured outputs or tool_use; fallback path creates raw task on parse failure; `max_tokens` set per call type |
| Google Calendar OAuth refresh token | Phase 2 (Calendar integration) | OAuth flow uses `access_type: offline` + `prompt: consent`; refresh token persisted encrypted; token refresh tested after 2-hour gap |
| Inline keyboard stale callbacks | Phase 1 (Telegram module) | Callback data includes task ID and action type; expired callbacks handled gracefully; `answerCallbackQuery` called in all code paths |
| Fly.io machine auto-stop | Phase 1 (deployment) | `fly.toml` contains `auto_stop_machines = false` and `min_machines_running = 1` |
| Voice transcription format issues | Phase 1 (voice capture) | Integration test sends real Telegram OGG/Opus file to Whisper; ffmpeg available as fallback; `language: "en"` passed |
| Chat_id auth bypass | Phase 1 (security) | Middleware checks `chat_id` before any processing; non-owner messages return early with no LLM calls |

## Sources

- [Telegram Bot API - Webhooks Guide](https://core.telegram.org/bots/webhooks) -- Webhook port restrictions, SSL requirements, retry behavior (HIGH confidence)
- [Telegram Bot API Reference](https://core.telegram.org/bots/api) -- `answerCallbackQuery` behavior, `getFile` limits, rate limits (HIGH confidence)
- [BullMQ + Upstash Incompatibility Issue #1087](https://github.com/taskforcesh/bullmq/issues/1087) -- Maintainer-confirmed incompatibility (HIGH confidence)
- [Upstash Redis Pricing & Limits](https://upstash.com/docs/redis/overall/pricing) -- Free tier: 500K commands/month, 256MB (HIGH confidence)
- [Neon + Prisma Connection Guide](https://neon.com/docs/guides/prisma) -- Pooler vs direct connection, cold start mitigation (HIGH confidence)
- [Neon Connection Latency Docs](https://neon.com/docs/connect/connection-latency) -- Auto-suspend timing, cold start benchmarks (HIGH confidence)
- [Claude Structured Outputs Documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) -- Schema enforcement beta, tool_use patterns (HIGH confidence)
- [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use) -- Token overhead of tool definitions (HIGH confidence)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2) -- Refresh token requirements, `access_type: offline` (HIGH confidence)
- [Fly.io Community - Telegram Bot Webhook Issues](https://community.fly.io/t/cant-reach-app-by-hostname-so-the-webhook-doesnt-work-telegram-bot/9460) -- Auto-stop and health check pitfalls (MEDIUM confidence)
- [LLM Context Management Guide](https://eval.16x.engineer/blog/llm-context-management-guide) -- Token budgeting strategies, summarization patterns (MEDIUM confidence)
- [LLM Chat History Summarization Guide 2025](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) -- Context window cost analysis, memory systems (MEDIUM confidence)
- [Whisper API + Telegram OGG Compatibility Discussion](https://community.openai.com/t/whisper-api-does-not-support-ogg-vorbis-format/129118) -- OGG format edge cases (MEDIUM confidence)
- [Neon Free Tier Compute Limits Analysis](https://ishan.page/blog/dbms-neon/) -- 100 CU-hours/month constraint, keep-alive implications (MEDIUM confidence)

---
*Pitfalls research for: LLM-powered Telegram bot task management (Cortex)*
*Researched: 2026-02-27*
