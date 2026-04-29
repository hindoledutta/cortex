# cortex-local

## What it does

cortex-local is a lightweight TypeScript daemon that runs on your Mac mini under launchd. It watches the directory where Meetily (via meetily-exporter) writes meeting transcripts as markdown files, waits for each file to be fully written (5-second stability window), parses the YAML frontmatter, and POSTs the verbatim transcript to the `POST /api/meetings/ingest` endpoint on your Cortex server — authenticated via a Bearer token stored in macOS Keychain. After a successful upload the source file is atomically moved to `_ingested/` so it is never re-processed. The daemon also pings `POST /api/heartbeat` once per day at 9 UTC; if it goes silent for more than 26 hours, Cortex sends you a Telegram DM. Terminal upload failures (after all retries are exhausted) are surfaced via the heartbeat's `last_error` field — no Telegram bot token is needed on the Mac side.

Pending uploads survive daemon crashes: they are persisted to `queue.json` and drained on the next boot, so no transcript is ever lost to a launchd restart.

This daemon is part of the Cortex Phase 7b (Meeting Capture) pipeline. See also: ROADMAP Phase 7b and the [High-Level Design §3.8](../docs/hld.md).

## Prerequisites

- **Node.js >= 20** on the Mac mini (`node --version`)
- **Meetily** installed and recording Google Meet calls. See https://github.com/Zackriya-Solutions/meetily for the macOS app; grant microphone and screen-recording permissions.
- **meetily-exporter** (recommended adapter) or any tool that writes Meetily transcripts as `*.md` files with YAML frontmatter to a known directory:
  ```bash
  npm i -g meetily-exporter
  mkdir -p ~/Documents/Meetily/exports
  meetily-exporter --watch --output ~/Documents/Meetily/exports
  ```
- **`CORTEX_LOCAL_SHARED_SECRET`** already set on Fly.io (done in plan 07b-01):
  ```bash
  fly secrets set CORTEX_LOCAL_SHARED_SECRET=$(openssl rand -hex 32) -a cortex-hindole
  ```

## Install

```bash
cd cortex-local
bash scripts/install.sh
```

The installer prompts for:
- **Cortex API URL** — e.g. `https://cortex-hindole.fly.dev`
- **Meetily/exporter output directory** — e.g. `~/Documents/Meetily/exports` (`~` is expanded)
- **Hostname label** — e.g. `mac-mini-home` (used in heartbeat payloads)
- **Shared secret** — paste the same value you set for `CORTEX_LOCAL_SHARED_SECRET` on Fly.io; stored in macOS Keychain, never in plaintext

Where things land:
| Item | Path |
|------|------|
| Daemon binary | `~/.cortex-local/dist/index.js` |
| Config (chmod 600) | `~/Library/Application Support/cortex-local/config.json` |
| Queue + state | `~/Library/Application Support/cortex-local/state/` |
| launchd plist | `~/Library/LaunchAgents/com.cortex.local.plist` |
| Logs | `~/Library/Logs/cortex-local.{out,err}.log` |

## Verify

After install, confirm the agent is running:

```bash
launchctl print gui/$(id -u)/com.cortex.local | head -20
tail -f ~/Library/Logs/cortex-local.out.log
```

Expected first log lines:
```
[cortex-local] starting; host=mac-mini-home; watching=/Users/.../Meetily/exports
[watcher] watching /Users/.../Meetily/exports (stable after 5s)
[heartbeat] cron registered: "0 9 * * *" UTC
```

If `~/Library/Logs/cortex-local.err.log` shows `node: command not found`, the `__NODE_BIN__` substitution failed — re-run `install.sh`.

## Dry-run

Before going live, validate that cortex-local can parse a real Meetily export correctly:

```bash
cd cortex-local
npm run dry-run -- /absolute/path/to/sample-meeting.md
```

This prints the parsed frontmatter and the would-be POST body (transcript truncated to 200 chars). **No POST is made.** Use this to verify that all expected frontmatter fields (title, started_at, ended_at, attendees, meeting-id) are present and correctly mapped before capturing a real meeting.

## Custom frontmatter field names

If your meetily-exporter or adapter uses different frontmatter key names, add a `frontmatterFields` block to `~/Library/Application Support/cortex-local/config.json`:

```json
{
  "cortexApiUrl": "...",
  "sharedSecret": "...",
  "meetilyOutputDir": "...",
  "host": "...",
  "stateDir": "...",
  "frontmatterFields": {
    "title": "meeting_name",
    "startedAt": "started",
    "endedAt": "ended",
    "attendees": "participants",
    "externalId": "uid"
  }
}
```

The defaults (used when this block is absent) map to `title`, `started_at`, `ended_at`, `attendees`, and `meeting-id` — which are meetily-exporter's default output keys.

After editing the config, reload the daemon:
```bash
launchctl bootout gui/$(id -u)/com.cortex.local
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cortex.local.plist
```

## Heartbeat

The daemon POSTs to `POST /api/heartbeat` once per day at 9:00 UTC (configured via `heartbeatCron`, default `0 9 * * *`). It also fires an immediate catch-up ping on boot if the last ping was more than 24 hours ago.

The heartbeat includes:
- `host` — your hostname label
- `version` — daemon version
- `last_ingest_at` — ISO timestamp of the most recent successful upload
- `queue_depth` — number of pending uploads in queue.json
- `last_error` — the most recent terminal upload failure message (null if healthy)

If the Cortex server does not receive a heartbeat for more than 26 hours, it sends a Telegram DM: `cortex-local silent — mac-mini-home hasn't checked in for 30 hours`.

If a terminal upload failure occurs, `last_error` is populated in the next heartbeat. Cortex detects the null → string transition and sends: `cortex-local upload failed — Host: mac-mini-home, Last error: ...`.

To verify on the Cortex side, check the `heartbeats` table in Postgres:
```bash
fly ssh console -a cortex-hindole -C "psql \$DATABASE_URL -c 'SELECT host, last_seen_at, last_error FROM heartbeats;'"
```

## Recovery

**Daemon crashes mid-upload:** The pending upload stays in `queue.json` (enqueued before the upload attempt). On the next launchd restart (ThrottleInterval=30s), the daemon drains the queue before starting the watcher. No transcript is lost.

**File moved out of `_ingested/` accidentally:** If you move a file back to the watch directory, the watcher picks it up again and re-POSTs it. The server's idempotency logic returns the existing `meeting_id` (no duplicate vault commit) when `external_id` matches.

## Uninstall

```bash
bash scripts/uninstall.sh
```

The uninstaller stops the daemon, removes the plist, and optionally removes `~/.cortex-local`. Config, state, and the Keychain entry are preserved. To remove the Keychain entry manually:

```bash
security delete-generic-password -s cortex-local -a shared-secret
```

## Troubleshooting

**`node: command not found` in launchd**
launchd does not inherit your shell's `$PATH`. The plist sets `PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin` explicitly. If your Node.js is installed elsewhere (e.g. nvm), add its path to the plist's `PATH` string and reload.

**Daemon crash-loops (frequent restart in `cortex-local.err.log`)**
The plist uses `ThrottleInterval=30` to prevent CPU burnout on crash loops. Check `cortex-local.err.log` for the crash reason before the next restart.

**`awaitWriteFinish` partial-read failures**
Meetily writes large transcripts. The 5-second `stabilityThreshold` waits until the file size stops changing before firing the `add` event, preventing partial reads.

**401 — wrong shared secret**
```bash
security find-generic-password -s cortex-local -a shared-secret -w
```
Compare to the `CORTEX_LOCAL_SHARED_SECRET` value set on Fly.io. If they differ, re-run `install.sh` (it will overwrite the Keychain entry with `-U`).

**413 — payload too large**
The Cortex server's body parser limit is 5 MB. Very long transcripts (>5 MB of text) will fail with a 400/413. In practice, Meetily transcripts for typical meetings are well under 1 MB.

**LaunchAgent vs LaunchDaemon**
cortex-local runs as a User Agent (`~/Library/LaunchAgents/`), not a system daemon. It starts after login, has access to Keychain, and runs as your user. This is correct — it needs to access the Meetily output directory under `~/Documents/`.
