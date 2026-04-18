# Stack Research

**Domain:** Intelligent Telegram bot with LLM-powered task management, voice transcription, and calendar integration
**Researched:** 2026-02-27
**Confidence:** HIGH

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| NestJS | 11.x (latest 11.1.14) | Backend framework | Module system maps directly to domain boundaries (Telegram, LLM, Task, Calendar, Scheduler). Decorator-based DI, guards, interceptors, pipes all built-in. Mature ecosystem with first-party integrations for BullMQ, config, and scheduling. The HLD already maps to NestJS modules. | HIGH |
| TypeScript | 5.7+ | Language | Type safety across LLM structured outputs, Prisma models, and Telegram message types. NestJS requires it. | HIGH |
| Node.js | 22 LTS | Runtime | Current LTS (active until April 2027). Required for `--experimental-require-module` flag that helps with ESM-only packages in NestJS's CJS environment. | HIGH |
| grammY | 1.40.x | Telegram Bot framework | Actively maintained (last release: 10 days ago, weekly releases). Telegraf's last publish was 2+ years ago (4.16.3) -- effectively in maintenance mode. grammY has better TypeScript types, plugin ecosystem, webhook support, and documentation. 136K weekly downloads vs Telegraf's declining trajectory. | HIGH |
| Prisma ORM | 7.x (latest 7.2.0) | Database ORM | Prisma 7 removed the Rust engine -- now pure TypeScript. 3.4x faster queries, 9x faster serverless cold starts. Type-safe queries generated from schema. Best-in-class migration workflow (`prisma migrate dev`). Official NestJS guide exists. Must use `moduleFormat = "cjs"` in generator config for NestJS compatibility. | HIGH |
| PostgreSQL | 16+ (Neon) | Primary database | Relational model fits task hierarchies (parent/sub-task self-referential FK). JSONB for session context. Neon free tier: 0.5 GB storage, connection pooling, auto-suspend. | HIGH |
| Redis | 7.x (Upstash) | Queue + sessions + cache | BullMQ requires Redis. Session context is ephemeral (30-min TTL) -- Redis is the natural fit. Upstash free tier: 10K commands/day, sufficient for solo use (~100-500 cmds/day). | HIGH |
| BullMQ | 5.70.x | Job queue + scheduling | Delayed jobs for reminders, repeatable jobs for check-ins, deferred task resurfacing. First-party NestJS integration via `@nestjs/bullmq@11.0.4`. Persistent, retryable, rate-limited jobs on Redis. | HIGH |

### AI / LLM Services

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| @anthropic-ai/sdk | 0.78.x | Claude API client | Official TypeScript SDK. Supports structured output (JSON mode), streaming, message batching. Used for both Opus 4.6 (decomposition) and Sonnet 4.6 (classification/follow-up). | HIGH |
| openai (npm) | 6.25.x | Whisper transcription | Official TypeScript SDK. Only needed for transcription endpoint (`/v1/audio/transcriptions`). Use `gpt-4o-mini-transcribe` model instead of `whisper-1` -- half the price ($0.003/min vs $0.006/min) with 89% fewer hallucinations. | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| @nestjs/config | 4.x | Environment config | Always. Load `.env`, validate with Zod schemas, type-safe ConfigService. | HIGH |
| zod | 3.24.x | Schema validation | Validate environment variables, LLM structured outputs, incoming webhook payloads. Replaces class-validator for config -- better type inference, `z.infer` auto-types. Keep class-validator only for DTO pipe validation where NestJS has built-in integration. | MEDIUM |
| class-validator | 0.14.x | Request DTO validation | NestJS `ValidationPipe` integration. Use for REST API DTOs (dashboard API in Phase 3). Not for config or LLM output validation -- Zod is better there. | HIGH |
| class-transformer | 0.5.x | DTO transformation | Paired with class-validator for NestJS pipe integration. | HIGH |
| ioredis | 5.9.x | Redis client | Required by BullMQ. Also used for direct session read/write with TTL. Upstash is wire-compatible with standard Redis protocol -- ioredis works directly with Upstash connection strings. Do NOT use `@upstash/redis` (HTTP-based) -- BullMQ requires a TCP Redis client. | HIGH |
| @googleapis/calendar | 14.x | Google Calendar API | Phase 2. Dedicated calendar package (lighter than full `googleapis`). OAuth 2.0 with offline refresh token. Create events, add attendees, query free/busy. | MEDIUM |
| googleapis | 171.x | Google OAuth helper | Phase 2. Use only for OAuth2 flow setup. Once authenticated, use `@googleapis/calendar` for operations. | MEDIUM |
| helmet | 8.x | HTTP security headers | Always. Standard Express middleware for security headers. | HIGH |
| @nestjs/throttler | 6.x | Rate limiting | Protect webhook endpoint and future dashboard API. | HIGH |

### Development Tools

| Tool | Version | Purpose | Notes | Confidence |
|------|---------|---------|-------|------------|
| Vitest | 3.x | Test runner | NestJS 12 (Q3 2026) will officially adopt Vitest. Start with Vitest now to avoid migration. 10-20x faster than Jest. Use `unplugin-swc` for decorator metadata support. CI runtime drops from ~15min to ~4min. | HIGH |
| unplugin-swc | 1.x | SWC plugin for Vitest | Required for NestJS decorator metadata (reflect-metadata) in Vitest. Without this, DI-based tests fail silently. | HIGH |
| @swc/core | 1.x | TypeScript compilation | Fast compilation for both build and test. NestJS CLI supports SWC as alternative to tsc. | HIGH |
| ESLint | 9.x | Linting | Flat config format (eslint.config.mjs). Use `@typescript-eslint/eslint-plugin` for TypeScript rules. | HIGH |
| Prettier | 3.x | Code formatting | Consistent formatting. Integrate with ESLint via `eslint-config-prettier`. | HIGH |
| tsx | 4.x | Dev runner | Fast TypeScript execution for scripts and dev mode. Faster than ts-node. | MEDIUM |
| Docker | -- | Containerization | Fly.io deploys Docker images. Multi-stage build: Node 22 Alpine base, SWC compile, production image. | HIGH |
| Prisma CLI | 7.x | Database tooling | Schema management, migrations, seeding, studio (local DB browser). Install as devDependency. | HIGH |

---

## Architecture Decisions

### NestJS stays on CommonJS (for now)

NestJS 11 defaults to CommonJS. NestJS 12 (Q3 2026) will add ESM-first project scaffolding. For this project, **stay on CJS**:
- Prisma 7 ships as ESM but supports `moduleFormat = "cjs"` in generator config
- grammY works in both CJS and ESM
- BullMQ works in CJS
- Avoids the pain of ESM-only package workarounds in NestJS 11

Configure Prisma generator:
```prisma
generator client {
  provider     = "prisma-client-js"
  output       = "../node_modules/.prisma/client"
  moduleFormat = "cjs"
}
```

### grammY over Telegraf (and over nestjs-telegraf)

**Decision:** Use grammY directly with a thin custom NestJS module wrapper. Do NOT use `nestjs-telegraf` or `@grammyjs/nestjs`.

**Rationale:**
- **Telegraf is stale.** Last npm publish: 2+ years ago (v4.16.3). grammY publishes weekly (v1.40.0, 10 days ago).
- **nestjs-telegraf wraps Telegraf.** It inherits Telegraf's staleness. Last publish: 10 months ago (v2.9.1).
- **@grammyjs/nestjs is immature.** Official package at v0.3.4, last published 3 years ago. Community forks exist but are fragmented.
- **A custom wrapper is trivial.** grammY's webhook handler is ~10 lines. Create a `TelegramModule` that initializes a grammY `Bot` instance, registers a webhook route via NestJS controller, and exposes the bot as an injectable service. This gives full control over webhook setup, voice file downloads, and inline keyboard handling without depending on a third-party wrapper's update cadence.

### Prisma 7 over Drizzle

**Decision:** Use Prisma 7.

**Rationale:**
- Prisma 7 eliminated the Rust engine -- performance gap with Drizzle is now much smaller
- Prisma Migrate is the gold standard for schema migrations (critical for iterating on the data model)
- Better DX for the data model complexity here (self-referential tasks, JSONB sessions, enums for status/priority)
- Official NestJS guide and recipe exist
- Drizzle's advantage is in serverless cold starts and raw SQL proximity -- neither is critical for an always-on Fly.io deployment

### Transcription: gpt-4o-mini-transcribe over whisper-1

**Decision:** Use `gpt-4o-mini-transcribe` model via the OpenAI SDK.

**Rationale:**
- Half the cost: $0.003/min vs $0.006/min
- 89% fewer hallucinations than whisper-1
- Same API endpoint (`POST /v1/audio/transcriptions`), same SDK, drop-in replacement
- At ~2-3 voice messages/day averaging 30 seconds each, monthly cost: ~$0.14 vs ~$0.27 (negligible either way, but why pay more for worse quality)

---

## Installation

```bash
# Core framework
npm install @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs

# Telegram bot
npm install grammy

# Database
npm install @prisma/client

# LLM SDKs
npm install @anthropic-ai/sdk openai

# Queue & Redis
npm install @nestjs/bullmq bullmq ioredis

# Configuration & validation
npm install @nestjs/config zod class-validator class-transformer

# Security
npm install helmet @nestjs/throttler

# Google Calendar (Phase 2)
# npm install @googleapis/calendar googleapis

# Dev dependencies
npm install -D typescript @types/node @swc/core
npm install -D prisma
npm install -D vitest unplugin-swc @vitest/coverage-v8
npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-config-prettier
npm install -D tsx
npm install -D @nestjs/testing @nestjs/cli
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not Alternative |
|----------|-------------|-------------|---------------------|
| Bot framework | grammY 1.40 | Telegraf 4.16 | Last published 2+ years ago. Complex TypeScript types. Effectively in maintenance mode. grammY is the successor with better DX. |
| Bot NestJS wrapper | Custom thin wrapper | nestjs-telegraf 2.9 / @grammyjs/nestjs 0.3 | Both are stale. nestjs-telegraf wraps the stale Telegraf. @grammyjs/nestjs is 3 years old. A custom wrapper is 50-100 lines and gives full control. |
| ORM | Prisma 7 | Drizzle ORM | Drizzle is faster for raw queries but Prisma 7 closed the gap by removing Rust. Prisma's migration system, schema DSL, and NestJS integration are significantly more mature. Drizzle's SQL-close approach adds unnecessary complexity for this data model. |
| ORM | Prisma 7 | TypeORM | TypeORM has known issues with complex relations, inconsistent query builder API, and slower development pace. Prisma's schema-first approach is cleaner. |
| Transcription | gpt-4o-mini-transcribe | whisper-1 | Same API, same SDK. gpt-4o-mini-transcribe is cheaper and more accurate. No reason to use whisper-1 in 2026. |
| Transcription | OpenAI API | Local Whisper (whisper.cpp) | Local inference requires GPU or slow CPU processing. API is $0.003/min -- monthly cost for this use case is cents. Adds no deployment complexity. |
| Test runner | Vitest 3.x | Jest 30.x | NestJS 12 officially migrating to Vitest. Vitest is 10-20x faster. Start with Vitest to avoid future migration. Jest is still fine but trending toward legacy in the NestJS ecosystem. |
| Config validation | Zod (config) + class-validator (DTOs) | class-validator everywhere | class-validator + class-transformer packages are inactive (no updates for 2+ years). Zod has superior type inference. But NestJS's ValidationPipe works natively with class-validator, so keep it for DTO validation where the framework integration saves effort. |
| Redis client | ioredis | @upstash/redis | BullMQ requires a TCP Redis client. @upstash/redis is HTTP-based. ioredis works with Upstash via standard Redis connection strings. |
| Google Calendar | @googleapis/calendar | google-calendar (npm) | Community package with 0 recent updates. Official Google package is authoritative and actively maintained. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Telegraf | Last published 2+ years ago. Stale, complex types, no active development. | grammY |
| nestjs-telegraf | Wraps the stale Telegraf library. Inherits all its problems. | Custom grammY NestJS module |
| @grammyjs/nestjs | Official package is 3 years old (v0.3.4). Fragmented community forks. | Custom grammY NestJS module |
| TypeORM | Inconsistent APIs, known relation bugs, slower development. | Prisma 7 |
| Sequelize | Weak TypeScript support, legacy patterns, not schema-first. | Prisma 7 |
| whisper-1 model | More expensive ($0.006/min) and less accurate than gpt-4o-mini-transcribe ($0.003/min). | gpt-4o-mini-transcribe |
| @upstash/redis | HTTP-based client. Incompatible with BullMQ which requires TCP Redis protocol. | ioredis (works with Upstash connection strings) |
| node-telegram-bot-api | Callback-based, weak TypeScript support, no middleware system. | grammY |
| Bull (v4) | Legacy predecessor to BullMQ. BullMQ is the actively maintained successor. | BullMQ |
| @nestjs/bull | Wraps legacy Bull, not BullMQ. | @nestjs/bullmq |
| ts-node | Slow startup, complex ESM configuration. | tsx (for scripts), SWC (for builds) |
| Jest | NestJS migrating away from Jest to Vitest in v12. Starting with Jest now means a migration later. | Vitest + unplugin-swc |
| dotenv (standalone) | NestJS's @nestjs/config already handles .env loading. Adding dotenv separately causes double-loading issues. | @nestjs/config with Zod validation |
| Prisma 6.x | Prisma 7 removed the Rust engine (pure TS now), 3.4x faster, 9x faster cold starts. No reason to use v6 with PostgreSQL. | Prisma 7.x |
| googleapis (full package) for calendar ops | 171MB+ package with every Google API. | @googleapis/calendar (dedicated, lighter) |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| @nestjs/bullmq@11.0.4 | NestJS 11.x, bullmq 5.x | First-party NestJS integration. Major version matches NestJS major. |
| Prisma 7.x + NestJS 11 | Node 22 LTS | Must set `moduleFormat = "cjs"` in Prisma generator. Must create `prisma.config.ts` (new in v7 -- replaces `datasource.url` in schema). |
| grammY 1.40 | Node 18+ | Framework-agnostic. Works in CJS and ESM. |
| ioredis 5.9 | Upstash Redis | Use standard `rediss://` connection string from Upstash dashboard. TLS required. |
| Vitest 3.x + NestJS 11 | unplugin-swc 1.x, @swc/core 1.x | SWC required for decorator metadata. Without it, NestJS DI fails in tests. |
| @anthropic-ai/sdk 0.78 | Node 18+ | Supports Claude Opus 4.6 and Sonnet 4.6 model IDs. |
| openai 6.25 | Node 18+ | Supports gpt-4o-mini-transcribe model for audio transcription. |

---

## Stack Patterns by Variant

**If deploying to Fly.io (recommended):**
- Use Docker multi-stage build with Node 22 Alpine
- Webhook mode for Telegram (Fly.io serves HTTPS)
- ioredis with TLS to Upstash
- Prisma with Neon connection pooling (`?pgbouncer=true&connect_timeout=15`)

**If deploying to local/dev:**
- Use `tsx watch` for hot reload
- Polling mode for Telegram (no HTTPS needed locally)
- Local Redis via Docker Compose or `redis-server`
- Local PostgreSQL via Docker Compose
- `prisma studio` for DB browser

**If Fly.io free tier is discontinued:**
- Entire stack is Docker-based, portable to Hetzner ($4/mo), Railway ($5/mo), or Render
- No Fly.io-specific lock-in
- Only change: environment variables and deploy command

---

## Sources

- [NestJS 11 Release Announcement](https://trilon.io/blog/announcing-nestjs-11-whats-new) -- NestJS 11 features and release date (HIGH confidence)
- [NestJS 12 PR (Q3 2026)](https://github.com/nestjs/nest/pull/16391) -- Vitest adoption, ESM-first scaffolding plans (HIGH confidence)
- [Prisma 7 Release Blog](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0) -- Rust-free client, performance improvements (HIGH confidence)
- [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7) -- Breaking changes, prisma.config.ts, moduleFormat (HIGH confidence)
- [Prisma NestJS Guide](https://www.prisma.io/docs/guides/nestjs) -- Official integration patterns (HIGH confidence)
- [grammY Official Site](https://grammy.dev/) -- Features, comparison with Telegraf, documentation (HIGH confidence)
- [grammY vs Other Frameworks](https://grammy.dev/resources/comparison) -- Direct comparison with Telegraf (HIGH confidence)
- [npm: grammy 1.40.0](https://www.npmjs.com/package/grammy) -- Latest version, publish date (HIGH confidence)
- [npm: telegraf 4.16.3](https://www.npmjs.com/package/telegraf) -- Last publish date confirms staleness (HIGH confidence)
- [npm: nestjs-telegraf 2.9.1](https://www.npmjs.com/package/nestjs-telegraf) -- Last publish 10 months ago (HIGH confidence)
- [npm: @grammyjs/nestjs 0.3.4](https://www.npmjs.com/package/@grammyjs/nestjs) -- Last publish 3 years ago (HIGH confidence)
- [npm: @anthropic-ai/sdk 0.78.0](https://www.npmjs.com/package/@anthropic-ai/sdk) -- Latest version (HIGH confidence)
- [npm: openai 6.25.0](https://www.npmjs.com/package/openai) -- Latest version (HIGH confidence)
- [OpenAI Transcription Models](https://platform.openai.com/docs/guides/speech-to-text) -- gpt-4o-mini-transcribe availability and pricing (HIGH confidence)
- [OpenAI Transcription Pricing](https://costgoat.com/pricing/openai-transcription) -- $0.003/min for gpt-4o-mini-transcribe (MEDIUM confidence)
- [npm: bullmq 5.70.1](https://www.npmjs.com/package/bullmq) -- Latest version (HIGH confidence)
- [npm: @nestjs/bullmq 11.0.4](https://www.npmjs.com/package/@nestjs/bullmq) -- NestJS integration version (HIGH confidence)
- [BullMQ NestJS Guide](https://docs.bullmq.io/guide/nestjs) -- Official integration docs (HIGH confidence)
- [npm: ioredis 5.9.3](https://www.npmjs.com/package/ioredis) -- Latest version (HIGH confidence)
- [npm: @googleapis/calendar 14.2.0](https://www.npmjs.com/package/@googleapis/calendar) -- Latest version (HIGH confidence)
- [Vitest vs Jest 2026](https://dev.to/dataformathub/vitest-vs-jest-30-why-2026-is-the-year-of-browser-native-testing-2fgb) -- Testing landscape comparison (MEDIUM confidence)
- [NestJS ESM Support Issue](https://github.com/nestjs/nest/issues/13319) -- CJS default status, ESM roadmap (HIGH confidence)
- [Prisma vs Drizzle 2026](https://www.bytebase.com/blog/drizzle-vs-prisma/) -- ORM comparison with Prisma 7 context (MEDIUM confidence)

---
*Stack research for: Cortex -- Intelligent Task Capture & Management System*
*Researched: 2026-02-27*
