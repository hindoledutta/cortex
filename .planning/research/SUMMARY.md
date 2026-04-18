# Project Research Summary

**Project:** Cortex — Intelligent Task Capture & Management System
**Domain:** LLM-powered Telegram bot for single-user task management
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

Cortex is a single-user, Telegram-native task management system whose core value proposition is multi-turn conversational capture: the user speaks or types a brain dump, the system decomposes it into structured tasks, then asks contextual follow-up questions to enrich those tasks — a flow no competitor offers today. Todoist Ramble (launched January 2026) is the closest analog, but it is capture-only with no follow-up conversation. The justified approach is a NestJS monolith with grammY, Prisma 7 (Rust-free), PostgreSQL on Neon, Redis on Upstash (sessions only), and Claude as the LLM backbone with tiered Opus/Sonnet routing. The architecture maps cleanly to NestJS modules, and the dependency graph dictates a clear bottom-up build order: infrastructure first, domain layer second, intelligence layer third, Telegram interface last.

The two defining architectural decisions are: (1) use a Postgres-based job queue (pg-boss or graphile-worker) instead of BullMQ, because BullMQ is fundamentally incompatible with Upstash Redis's HTTP-based protocol; and (2) make the Telegram webhook handler async-first, acknowledging the update immediately and processing LLM calls in the background, to prevent Telegram's aggressive retry mechanism from triggering duplicate processing or cost spirals. Both decisions must be made before any code is written — retrofitting them is expensive.

The primary ongoing risk is LLM cost. With Opus at ~$15/MTok input and unbounded session context, a heavy brain dump session can cost $0.50-$1.00. Tiered routing (Opus for initial decomposition only, Sonnet for all follow-up and classification), system prompt caching, and a hard token cap on session context (target: 4,000 tokens) keep monthly costs under $20. These controls must be built into the LLM module from day one, not bolted on later.

---

## Key Findings

### Recommended Stack

The stack is modern, well-integrated, and opinionated. NestJS 11 on Node 22 LTS with TypeScript 5.7+ provides the module system that maps directly to domain boundaries. grammY 1.40 replaces Telegraf (stale since 2024) and any NestJS wrapper (all stale); a custom thin wrapper is 50-100 lines and provides full control. Prisma 7 removed its Rust engine and is now pure TypeScript — faster cold starts, same great migration workflow. PostgreSQL on Neon provides relational storage with JSONB for session context. Redis on Upstash provides ephemeral session cache only. Testing with Vitest + unplugin-swc (required for NestJS decorator metadata) aligns with NestJS 12's planned official adoption of Vitest.

**Core technologies:**
- **NestJS 11 / TypeScript 5.7+ / Node 22 LTS:** Framework, language, runtime — the foundational stack with deep integration across all libraries.
- **grammY 1.40:** Telegram bot framework — actively maintained (weekly releases vs. Telegraf's 2+ year gap); custom NestJS wrapper, not a stale third-party adapter.
- **Prisma 7 + PostgreSQL 16 (Neon):** ORM and primary database — Rust-free Prisma with Neon's connection pooler; use `moduleFormat = "cjs"` in the Prisma generator.
- **Redis (Upstash) via ioredis:** Session context cache only — do NOT use BullMQ with Upstash; use pg-boss or graphile-worker for job queuing instead.
- **@anthropic-ai/sdk 0.78 (Claude):** LLM backbone — Opus 4.6 for brain dump decomposition, Sonnet 4.6 for classification and follow-up.
- **openai 6.25 (Whisper):** Voice transcription — use `gpt-4o-mini-transcribe` model, not `whisper-1` (half the cost, 89% fewer hallucinations).
- **Vitest 3 + unplugin-swc:** Test runner — SWC plugin is mandatory for NestJS DI in tests; aligns with NestJS 12 direction.

**Critical version constraints:**
- Prisma generator must include `moduleFormat = "cjs"` — NestJS stays on CommonJS until v12.
- ioredis (TCP) must be used for Upstash, not `@upstash/redis` (HTTP-based, incompatible with queue libraries).
- `@nestjs/bullmq` should NOT be installed — replace with pg-boss or graphile-worker.

### Expected Features

**Must have (table stakes — Phase 1):**
- Text message capture via Telegram — the core input channel.
- Voice message capture + Whisper transcription — show transcription before processing; give user a correction path.
- LLM brain dump decomposition (Opus 4.6) — the entire value proposition; must handle single tasks, multi-task dumps, and ambiguous input.
- Task CRUD + status lifecycle (captured → active → in_progress → done/blocked/deferred) — foundational persistence.
- Sub-tasks, one level deep — decomposition output needs a home; parent status auto-derives from children.
- Inline keyboard management — Done/Start/Defer/Edit via buttons; without this, the bot feels primitive.
- Workspace separation (Personal/Work) — static default with @prefix override.
- Conversational follow-up — the primary differentiator; system asks 1-2 contextual questions after capture.
- Session context (Redis, 30-min TTL) — multi-turn conversation memory without database writes.
- Incremental enrichment — follow-up info merges into existing tasks, not creates new ones.
- Basic commands (/tasks, /workspace, /help).

**Should have (differentiators — Phase 2):**
- Deadline reminders, check-in prompts for stale tasks, deferred task resurfacing — all via BullMQ-equivalent scheduler.
- Google Calendar integration with stakeholder/contact directory and time blocking suggestions.
- Time-based workspace auto-switching.
- Comment action-item extraction (LLM parses task replies for new sub-tasks).

**Defer to v2+ (Phase 3):**
- Web dashboard PWA — defer until API is stable and task volume warrants a visual layer.
- Kanban/list/filter views.
- Offline-first (IndexedDB + service worker).

**Anti-features (do not build):**
- Multi-user/team collaboration — different product category; kills single-user simplicity.
- Recurring tasks — use Google Calendar recurring events instead.
- File attachments — Telegram file storage is temporary; link to Drive.
- Natural language search — simple ILIKE covers 90% of needs for <1,000 tasks.
- Email notifications — Telegram is the notification channel; period.
- Habit tracking — different domain, different data model.
- AI auto-scheduling/auto-prioritization — suggest time blocks, let the user decide.

### Architecture Approach

The system is a layered NestJS monolith deployed on Fly.io. Inbound messages travel: Telegram webhook → Message Router (classify intent via Sonnet) → Intelligence layer (process with Opus/Sonnet) → Domain layer (persist via Prisma) → Telegram response. Outbound proactive messages originate from the Scheduler module. Redis is the session store only — never PostgreSQL for ephemeral context. All LLM calls go through a single `LlmService` for centralized token tracking, model routing, and error handling. The build order follows a strict dependency graph: infrastructure → domain → intelligence → interface.

**Major components:**
1. **Telegram Module (grammY):** Single inbound/outbound interface. Thin handlers; no business logic. Handlers split by concern (messages, commands, callbacks).
2. **LLM Module (Claude API):** Centralized model routing, prompt templates, Zod-validated structured output schemas. Opus for decomposition; Sonnet for classification/follow-up.
3. **Task Module:** Core domain. CRUD, status lifecycle, sub-task derivation, workspace isolation. Most business logic lives here.
4. **Session Module (Redis):** Ephemeral conversation context. 30-minute TTL. Never persisted to PostgreSQL.
5. **Scheduler Module (pg-boss or graphile-worker):** Delayed/repeatable background jobs for reminders, check-ins, and deferred resurfacing. Postgres-backed, not BullMQ.
6. **Whisper Module:** Isolated voice transcription. Separate from LLM Module — different provider, different concern, independently swappable.
7. **Calendar Module (Phase 2):** Google Calendar API, OAuth 2.0 with stored refresh token, stakeholder resolution via Contact Module.

### Critical Pitfalls

1. **BullMQ + Upstash Redis incompatibility** — BullMQ requires blocking Redis commands (BRPOPLPUSH, Lua scripting, pub/sub) that Upstash's HTTP-based implementation does not support. Jobs silently fail or hang. Prevention: use pg-boss or graphile-worker (Postgres-backed) for job queuing; keep Upstash Redis for session cache only. This is a Phase 1 architecture decision — it cannot be deferred.

2. **Telegram webhook retry storm from slow LLM responses** — If the webhook handler waits for LLM processing before returning HTTP 200, any timeout triggers Telegram retries, each spawning another expensive LLM call. Prevention: acknowledge the webhook immediately (within 100ms), process LLM calls asynchronously in a background task, track `update_id` for idempotency.

3. **LLM session context cost explosion** — Passing full conversation history on every LLM call with Opus can cost $0.50-$1.00 per session. Prevention: cap session context at ~4,000 tokens, summarize older turns, use Sonnet for all follow-up/classification, enable prompt caching for the system prompt, log token counts on every API call.

4. **Neon Postgres cold-start timeouts** — Free-tier Neon auto-suspends after 5 minutes of inactivity. Cold starts take 2-5 seconds, causing Prisma's default timeout to fire and Telegram to retry. Prevention: use the Neon connection pooler endpoint (`-pooler` suffix), set `connect_timeout=20` in the connection string, optionally add a `SELECT 1` keep-alive every 4 minutes during active hours.

5. **LLM structured output parsing failures lose user input** — Without schema enforcement, the LLM may return JSON wrapped in markdown fences, omit required fields, or truncate output mid-JSON (if `max_tokens` is too low). Prevention: use Claude's structured outputs beta feature or `tool_use` with strict schema definitions; set `max_tokens` per call type (decomposition: 2048, classification: 100, follow-up: 500); implement a fallback that creates a raw "captured" task on any parse failure.

---

## Implications for Roadmap

Based on the dependency graph from ARCHITECTURE.md and the feature priorities from FEATURES.md, a 3-phase structure is strongly recommended.

### Phase 1: Foundation + Core Capture Loop

**Rationale:** The dependency graph (ARCHITECTURE.md) shows that every conversational feature depends on Task CRUD, which depends on Prisma, which depends on the NestJS scaffold. The Telegram module depends on everything else. Building bottom-up is the only viable order. All 5 critical pitfalls must be addressed in Phase 1 — they are architectural, not incremental.

**Delivers:** A working single-user Telegram bot that captures text and voice, decomposes brain dumps via LLM, manages tasks with inline keyboards, maintains 30-minute session context for multi-turn follow-up, and merges enrichment into existing tasks. This validates the core "zero-friction intelligent capture" thesis.

**Addresses (from FEATURES.md):** All P1 must-haves: text capture, voice capture + transcription, LLM decomposition, task CRUD + status lifecycle, sub-tasks, inline keyboards, workspace separation, conversational follow-up, session context, incremental enrichment, basic commands.

**Avoids:** BullMQ+Upstash incompatibility (use pg-boss from day one), webhook retry storms (async handler architecture), LLM cost explosion (token budgeting in LlmService), Neon cold-start failures (pooler endpoint + connect_timeout), structured output failures (schema enforcement + fallback path).

**Build order within Phase 1 (from ARCHITECTURE.md dependency graph):**
1. Project scaffold + Config + Prisma schema + Neon connection (pooler)
2. Task Module + Workspace Module (core domain, testable without Telegram)
3. Session Module (Redis/Upstash, 30-min TTL)
4. LLM Module (Claude API, model routing, prompt templates, Zod schemas, token logging)
5. Whisper Module (in parallel with LLM Module — different provider, independent)
6. Telegram Module (webhook, async handler, message router, keyboards, guards)
7. Basic scheduler (pg-boss or @nestjs/schedule for stale-task detection)

**Research flag:** This phase has well-documented patterns for NestJS, Prisma, and grammY. The main unknowns are prompt engineering quality and LLM routing thresholds — these are empirical, not research problems. Skip `/gsd:research-phase` for Phase 1 infrastructure; the STACK.md and ARCHITECTURE.md provide sufficient detail.

---

### Phase 2: Intelligence Layer + Scheduling + Calendar

**Rationale:** Once the capture loop is validated and the user relies on the system daily (trigger signals from FEATURES.md: user sets deadlines, tasks go stale, user wants calendar integration), Phase 2 adds the proactive and scheduling features that transform Cortex from a capture tool into a daily task management system. Google Calendar's OAuth setup is a distinct infrastructure concern that should not block Phase 1.

**Delivers:** Deadline reminders, check-in prompts for stale tasks, deferred task resurfacing, Google Calendar event creation with stakeholder resolution, time blocking suggestions, comment action-item extraction, and time-based workspace auto-switching.

**Uses (from STACK.md):** `@googleapis/calendar 14.x`, `googleapis 171.x` (OAuth only), pg-boss or graphile-worker (already in Phase 1), Redis for rate-limiting job frequency.

**Implements (from ARCHITECTURE.md):** Scheduler Module (full producer-consumer pattern), Calendar Module, Contact Module enrichment. Circular notification path: Scheduler processors → TelegramService.

**Avoids:** Google Calendar OAuth pitfall (must use `access_type: offline` + `prompt: consent` to obtain a refresh token; store refresh token encrypted). Separate calendar IDs per workspace.

**Research flag:** Google Calendar OAuth and the free/busy API are well-documented but have sharp edges (refresh token lifetime, scope requirements, service account vs. OAuth for personal calendars). Recommend `/gsd:research-phase` for the Calendar integration milestone before implementation.

---

### Phase 3: Visual Layer (PWA Dashboard)

**Rationale:** Telegram inline keyboards are adequate for quick task management, but a visual overview (kanban, filters, bulk operations) becomes useful once task volume grows and the system is a daily driver. The REST API for the dashboard is independent of the Telegram bot — it shares the database and can be built in parallel without touching Telegram code.

**Delivers:** PWA web dashboard with kanban/list views, task filtering by workspace/status/deadline, bulk operations, and a read-only analytics view of capture patterns and completion rates.

**Uses:** NestJS REST API endpoints (new controllers, same domain services), PWA frontend (framework TBD — React + Vite or Next.js are both reasonable; decision deferred).

**Avoids:** Real-time WebSocket complexity — polling every 30 seconds is sufficient for a single user. No email notifications — Telegram remains the notification channel.

**Research flag:** The frontend framework choice for the PWA is not yet decided. Recommend `/gsd:research-phase` during Phase 3 planning to evaluate React + Vite vs. Next.js vs. SvelteKit for a minimal offline-capable PWA. The NestJS REST API layer follows standard patterns — no research needed there.

---

### Phase Ordering Rationale

- **Dependency-driven:** The architecture's module dependency graph (Levels 0-7 in ARCHITECTURE.md) directly maps to phases. Phase 1 covers Levels 0-5, Phase 2 covers Level 6, Phase 3 covers Level 7.
- **Risk-front-loaded:** All 5 critical pitfalls are Phase 1 concerns. Addressing them first prevents expensive retrofits.
- **Value-gated:** Phase 2 features are gated on Phase 1 validation (trigger signals from FEATURES.md). If the user doesn't set deadlines, Phase 2 scheduler work is premature.
- **Independence preserved:** Phase 3 REST API and dashboard are fully independent of Phase 2 features. They can be started whenever Phase 1's API layer is stable.

### Research Flags Summary

| Phase | Research Needed? | Reason |
|-------|-----------------|--------|
| Phase 1 | No — skip `/gsd:research-phase` | NestJS, Prisma 7, grammY, and ioredis all have official docs and well-documented patterns. STACK.md and ARCHITECTURE.md provide implementation-ready detail. Prompt engineering is empirical. |
| Phase 2 (Calendar) | Yes — run `/gsd:research-phase` before calendar milestone | Google Calendar OAuth edge cases (refresh token, scope, service account vs. OAuth), free/busy API, attendee resolution. Sharp edges documented in PITFALLS.md but need implementation-specific research. |
| Phase 3 (PWA) | Yes — run `/gsd:research-phase` before PWA milestone | Frontend framework choice is unresolved. Service worker + offline-first patterns vary significantly by framework. |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations verified against npm publish dates, official docs, and official release announcements. grammY vs. Telegraf decision is definitive. Prisma 7 Rust removal is confirmed. BullMQ+Upstash incompatibility confirmed by maintainers (GitHub issue #1087). |
| Features | MEDIUM | Table stakes and anti-features are well-supported by competitor analysis. Conversational follow-up differentiation is opinion-informed-by-evidence — no direct data on whether multi-turn enrichment drives retention vs. simpler designs. The prioritization judgments are the synthesizer's, not sourced. |
| Architecture | HIGH | Module boundaries, dependency graph, and data flows are derived from NestJS official docs and established patterns. Build order is deterministic from dependency graph. Anti-patterns are well-documented in community sources. |
| Pitfalls | HIGH | Critical pitfalls are verified from authoritative sources: BullMQ maintainer-confirmed incompatibility, Neon official docs on cold starts, Anthropic structured outputs docs, Telegram webhook official docs. Moderate pitfalls (OGG format issues, Fly.io auto-stop) are at MEDIUM confidence from community sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **Prompt engineering quality:** The LLM decomposition prompts are the highest-risk unknown. The research identifies the architecture and safeguards (schema enforcement, fallback path, token caps), but prompt quality is empirical. Plan for iteration cycles on prompt templates in Phase 1. Budget time for testing edge cases: single-word input, mixed actionable/non-actionable dumps, ambiguous workspace attribution.

- **gpt-4o-mini-transcribe voice accuracy for task context:** The model is confirmed as cheaper and more accurate than whisper-1 in general benchmarks, but real-world accuracy on task-management vocabulary (project names, stakeholder names, technical jargon) is unvalidated. Have an ffmpeg fallback for OGG format edge cases and test with real Telegram voice messages early.

- **Upstash free tier command budget with session workload:** The free tier is documented at 500K commands/month (PITFALLS.md cited 10K/day, which is ~300K/month). For a solo user with ~50-100 messages/day and 2-3 Redis operations per message, daily usage is ~150-300 commands — well within the free tier. However, if the scheduler also uses Redis (even for rate limiting), that budget shrinks. Validate actual command usage in the first week of Phase 1 deployment.

- **Neon compute-unit hours budget with keep-alive:** The research notes that a 4-minute keep-alive during ~10 active hours/day consumes ~75 CU-hours/month against a 100 CU-hour/month free limit. This leaves minimal headroom. Validate actual compute consumption and decide early whether to pay for the Neon Launch tier ($19/mo) or accept cold starts during off-hours.

- **PWA frontend framework:** Deliberately unresolved. Decision deferred to Phase 3 planning. Flag for `/gsd:research-phase` at that time.

---

## Sources

### Primary (HIGH confidence)
- [NestJS 11 Release](https://trilon.io/blog/announcing-nestjs-11-whats-new) — NestJS 11 features and ecosystem status
- [NestJS 12 PR](https://github.com/nestjs/nest/pull/16391) — Vitest adoption, ESM-first scaffolding plans
- [Prisma 7 Release Blog](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0) — Rust-free client, performance improvements
- [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7) — moduleFormat = "cjs", prisma.config.ts
- [grammY Official Site](https://grammy.dev/) and [comparison page](https://grammy.dev/resources/comparison) — grammY vs. Telegraf
- [npm: grammy 1.40.0](https://www.npmjs.com/package/grammy), [npm: telegraf 4.16.3](https://www.npmjs.com/package/telegraf) — publish date evidence
- [BullMQ + Upstash Incompatibility Issue #1087](https://github.com/taskforcesh/bullmq/issues/1087) — maintainer-confirmed incompatibility
- [Neon + Prisma Connection Guide](https://neon.com/docs/guides/prisma) — pooler, cold start mitigation
- [Claude Structured Outputs Documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — schema enforcement, tool_use
- [Telegram Bot API — Webhooks Guide](https://core.telegram.org/bots/webhooks) — retry behavior, port restrictions
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2) — refresh token requirements
- [BullMQ NestJS Guide](https://docs.bullmq.io/guide/nestjs) — WorkerHost pattern
- [NestJS Official Docs — Modules, Queues, Prisma Recipe](https://docs.nestjs.com/)

### Secondary (MEDIUM confidence)
- [Todoist Ramble announcement (TechCrunch, Jan 2026)](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/) — competitive landscape
- [Taskmelt](https://www.taskmelt.app/), [Reclaim.ai](https://reclaim.ai/), [TickTick](https://ticktick.com/) — feature benchmarking
- [OpenAI Transcription Pricing](https://costgoat.com/pricing/openai-transcription) — gpt-4o-mini-transcribe cost
- [Prisma vs Drizzle 2026](https://www.bytebase.com/blog/drizzle-vs-prisma/) — ORM comparison context
- [Neon Free Tier Compute Analysis](https://ishan.page/blog/dbms-neon/) — 100 CU-hours/month constraint
- [LLM Context Management Guide](https://eval.16x.engineer/blog/llm-context-management-guide) — token budgeting strategies
- [Fly.io Community — Telegram Bot Webhook Issues](https://community.fly.io/t/cant-reach-app-by-hostname-so-the-webhook-doesnt-work-telegram-bot/9460) — auto-stop pitfalls
- [Whisper API OGG Compatibility Discussion](https://community.openai.com/t/whisper-api-does-not-support-ogg-vorbis-format/129118) — OGG format edge cases

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
