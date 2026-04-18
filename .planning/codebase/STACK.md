# Technology Stack

**Analysis Date:** 2026-02-27

## Languages

**Primary:**
- TypeScript - Used across all backend code and future frontend PWA

**Secondary:**
- JavaScript - Build tools and configuration files

## Runtime

**Environment:**
- Node.js (LTS) - Backend execution runtime

**Package Manager:**
- npm - Primary package manager
- Lockfile: `package-lock.json` (to be created)

## Frameworks

**Core:**
- NestJS 11 - Backend framework with module system for domain separation. Selected for modular architecture matching feature boundaries (Telegram, LLM, Calendar, Task, Scheduler modules). Path: `src/` (planned)

**Testing:**
- Jest - Unit and integration test runner (standard with NestJS)

**Build/Dev:**
- TypeScript Compiler - Compile TypeScript to JavaScript
- ts-node - Run TypeScript directly in development
- Docker - Containerization for Fly.io deployment

## Key Dependencies

**Critical:**
- `@nestjs/core` - NestJS core framework
- `@nestjs/common` - NestJS utilities and decorators
- `@nestjs/config` - Environment configuration management
- `prisma` - Type-safe ORM for database operations. Used for task CRUD, comments, contacts, workspace management, conversation sessions. Path: `prisma/schema.prisma` (planned)
- `telegram` or `node-telegram-bot-api` - Telegram Bot API client for webhook handling, message sending, file downloads
- `@anthropic-ai/sdk` - Claude API client for Opus 4.6 and Sonnet 4.6 models
- `openai` - OpenAI API client for Whisper transcription
- `google-auth-library-nodejs` - Google OAuth 2.0 authentication
- `googleapis` - Google Calendar API client for event creation and stakeholder invites

**Infrastructure:**
- `redis` - Redis client for session context caching and job queue
- `bullmq` - Job queue library for scheduled reminders (deadline, check-in, deferred task resurfacing). Runs on Upstash Redis
- `helmet` - Security headers middleware for NestJS
- `class-validator` - Runtime schema validation for DTOs
- `class-transformer` - DTO serialization and transformation
- `dotenv` - Load environment variables from `.env` file (development only)
- `winston` or `pino` - Structured logging library

**Type Definitions:**
- `@types/node` - TypeScript definitions for Node.js

## Configuration

**Environment:**
- `.env` file (development) - Contains Telegram bot token, Claude API key, OpenAI API key, Google OAuth credentials, database URL, Redis URL, Fly.io deployment secrets
- Environment variables required:
  - `TELEGRAM_BOT_TOKEN` - Telegram Bot API token
  - `TELEGRAM_CHAT_ID` - User's Telegram chat ID (auth mechanism)
  - `ANTHROPIC_API_KEY` - Claude API key
  - `OPENAI_API_KEY` - OpenAI API key
  - `DATABASE_URL` - PostgreSQL connection string (Neon)
  - `REDIS_URL` - Redis connection string (Upstash)
  - `GOOGLE_CLIENT_ID` - Google OAuth client ID
  - `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
  - `GOOGLE_REDIRECT_URI` - OAuth callback URL
  - `NODE_ENV` - `development`, `staging`, or `production`

**Build:**
- `nest.json` - NestJS CLI configuration (planned)
- `tsconfig.json` - TypeScript compiler options. Path aliases for: `@modules/`, `@services/`, `@dto/`, `@types/`, `@utils/` (planned)
- `.prettierrc` - Code formatting (planned)
- `.eslintrc.js` - Linting rules (planned)
- `docker/Dockerfile` - Docker build configuration for Fly.io (planned)
- `fly.toml` - Fly.io deployment configuration (planned)

## Platform Requirements

**Development:**
- Node.js LTS version
- npm or yarn
- Docker (for local PostgreSQL + Redis with docker-compose)
- Git

**Production:**
- Deployment target: Fly.io (3 shared VMs, free tier)
- Database: Neon PostgreSQL (free tier: 0.5 GB, auto-suspend/wake)
- Cache/Queue: Upstash Redis (free tier: 10K commands/day)
- Compute: Fly.io (Docker container, always-on with webhook traffic)

## External APIs & Services

**AI/LLM:**
- Claude API (Anthropic) - Opus 4.6 for decomposition, Sonnet 4.6 for structured operations
- Whisper API (OpenAI) - Audio transcription from Telegram voice messages

**Messaging:**
- Telegram Bot API - Webhook-based message handling, inline keyboards, file downloads

**Calendar:**
- Google Calendar API - Event creation, attendee invites, free/busy queries (Phase 2)
- Google OAuth 2.0 - One-time user authentication for calendar access

---

*Stack analysis: 2026-02-27*
