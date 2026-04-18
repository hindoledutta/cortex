# Phase 2: Intelligence Layer - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

LLM decomposition, follow-up questions, session context, and task enrichment — all as callable services without Telegram. Accepts unstructured text input, decomposes into structured tasks, maintains multi-turn session context, and enriches existing tasks through follow-up. Voice transcription (Whisper) is part of this phase but processing is the same text pipeline.

</domain>

<decisions>
## Implementation Decisions

### Decomposition depth
- Target 5-10 actionable sub-tasks per brain dump (each sub-task is a single concrete action)
- No hard cap — soft guidance in the prompt ("aim for 5-10"), LLM adjusts based on input complexity
- LLM infers priorities from context (urgency cues, dependencies, importance signals in the text)
- LLM judges whether input warrants decomposition — simple/clear inputs become a single task, complex inputs get parent + sub-tasks

### Follow-up behavior
- Follow-ups triggered only when gaps detected (missing deadlines, unclear priorities, ambiguous scope, missing context) — not on every decomposition
- Follow-up questions can target any gap: deadlines/timing, priority clarification, missing context, scope refinement
- Casual and brief tone — "When's this due?" not "I noticed no deadline was mentioned"
- Batched delivery: 1-2 questions in a single message, user answers all at once
- Maximum one round of follow-ups per decomposition — no follow-up on the follow-up
- If user's answer is vague (e.g., "soon"), nudge once for clarity then accept whatever comes
- After processing follow-up answers, show a brief summary of what changed ("Updated: deadline set to Friday, equipment task marked high priority")
- If user ignores follow-ups and sends a new dump: process the new dump normally, but include a gentle reminder about the unanswered questions

### Session boundaries
- 30-minute inactivity TTL in Redis (from requirements)
- Topic-scoped context: each new brain dump starts with clean context within the session; follow-ups only see their own dump's context
- Use Sonnet to classify each incoming message as "continuation of current topic" or "new topic" before processing
- Rich session state in Redis: conversation turns, pending follow-ups, active topic ID, last task IDs — session is a mini state machine
- Only substantive input (brain dumps, follow-up answers) resets the TTL; quick commands (/tasks, /help) do not
- After session expires, soft recall from recent tasks if user references something from before ("that office move thing" → search recent tasks to re-establish context)
- On first message after session expiry: "Starting fresh — your previous session timed out"
- /new command available for users to explicitly clear session and start fresh

### Enrichment rules
- Structured fields + description: update structured fields (deadline, priority) when extractable, append freeform details to task description
- Latest answer wins on conflicts — most recent input overwrites previous values without confirmation
- Follow-up answers can add NEW sub-tasks if the answer reveals uncaptured work
- No changelog or audit trail — tasks have current state only, keep it simple

### Claude's Discretion
- Exact prompt engineering for decomposition and follow-up generation
- Token budget management and prompt optimization
- Redis session data structure and serialization format
- Error handling for LLM API failures (retries, fallbacks)
- Sonnet classification prompt design for topic detection

</decisions>

<specifics>
## Specific Ideas

- Model routing is locked: Opus 4.6 for decomposition, Sonnet for classification and follow-up (from requirements)
- Token usage must be logged per LLM call (from success criteria)
- All services must be callable without Telegram — pure service layer
- The system should feel like a quick chat with an assistant, not a form-filling exercise

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-intelligence-layer*
*Context gathered: 2026-02-28*
