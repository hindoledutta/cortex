/**
 * Backfill existing Fathom meetings into nirvana-wiki.
 *
 * By default runs in dry-run mode (prints what would be ingested).
 * Pass --ingest to actually POST to Cortex.
 *
 * Prerequisites (set in .env or shell):
 *   FATHOM_API_KEY       — from Fathom Settings → API Access
 *   CORTEX_PUBLIC_URL    — e.g. https://cortex-hindole.fly.dev
 *   CORTEX_LOCAL_SHARED_SECRET — from fly secrets (same value as on server)
 *
 * Usage:
 *   npx tsx scripts/fathom-backfill.ts              # dry-run: list meetings
 *   npx tsx scripts/fathom-backfill.ts --ingest     # actually ingest
 *   npx tsx scripts/fathom-backfill.ts --ingest --id 42   # single meeting by Fathom id
 */
import 'dotenv/config';

const FATHOM_BASE = 'https://api.fathom.ai/external/v1';

async function fathomGet(path: string, apiKey: string) {
  const res = await fetch(`${FATHOM_BASE}${path}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Fathom API ${res.status} for ${path}: ${text}`);
  }
  return res.json() as Promise<any>;
}

function buildTranscript(lines: any[]): string {
  if (!lines?.length) return '(no transcript)';
  return lines
    .map((line: any) => {
      const ts = line.timestamp ? `[${line.timestamp}] ` : '';
      const speaker = line.speaker?.display_name ?? line.speaker?.email ?? '';
      return `${ts}${speaker ? `${speaker}: ` : ''}${line.text ?? ''}`;
    })
    .join('\n');
}

function toIso(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d.toISOString();
}

function buildIngestPayload(meeting: any) {
  const now = new Date().toISOString();
  const title =
    meeting.title ?? meeting.meeting_name ?? `Fathom Meeting ${meeting.id}`;
  const startedAt = toIso(meeting.started_at ?? meeting.created_at, now);
  const endedAt = toIso(meeting.ended_at ?? meeting.updated_at, startedAt);
  const attendees: string[] = (meeting.calendar_invitees ?? [])
    .map((i: any) => i.email)
    .filter(Boolean);
  const transcript = buildTranscript(meeting.transcript);
  const summary: string | undefined = meeting.summary?.markdown_formatted;
  const action_items: string[] | undefined = meeting.action_items?.length
    ? meeting.action_items.map((i: any) =>
        typeof i === 'string' ? i : (i.text ?? String(i)),
      )
    : undefined;

  return {
    source: 'fathom' as const,
    title,
    started_at: startedAt,
    ended_at: endedAt,
    attendees,
    transcript,
    external_id: String(meeting.recording_id ?? meeting.id),
    ...(summary ? { summary } : {}),
    ...(action_items ? { action_items } : {}),
  };
}

async function main() {
  const apiKey = process.env.FATHOM_API_KEY;
  const cortexUrl = process.env.CORTEX_PUBLIC_URL?.replace(/\/$/, '');
  const sharedSecret = process.env.CORTEX_LOCAL_SHARED_SECRET;

  if (!apiKey) { console.error('ERROR: FATHOM_API_KEY not set'); process.exit(1); }

  const args = process.argv.slice(2);
  const doIngest = args.includes('--ingest');
  const idFlag = args.indexOf('--id');
  const targetId = idFlag !== -1 ? parseInt(args[idFlag + 1], 10) : null;

  if (doIngest && (!cortexUrl || !sharedSecret)) {
    console.error('ERROR: CORTEX_PUBLIC_URL and CORTEX_LOCAL_SHARED_SECRET required for --ingest');
    process.exit(1);
  }

  // Fetch meetings from Fathom (all pages or single)
  let meetings: any[] = [];
  if (targetId !== null) {
    // Fetch a specific meeting by listing and filtering
    const data = await fathomGet(
      `/meetings?include_transcript=true&include_summary=true&include_action_items=true`,
      apiKey,
    );
    meetings = (data.items ?? []).filter((m: any) => m.id === targetId);
    if (!meetings.length) {
      console.error(`No meeting found with id=${targetId}`);
      process.exit(1);
    }
  } else {
    // Fetch all pages
    let cursor: string | null = null;
    do {
      const qs = new URLSearchParams({
        include_transcript: 'true',
        include_summary: 'true',
        include_action_items: 'true',
      });
      if (cursor) qs.set('cursor', cursor);
      const data = await fathomGet(`/meetings?${qs}`, apiKey);
      meetings.push(...(data.items ?? []));
      cursor = data.next_cursor ?? null;
    } while (cursor);
  }

  console.log(`\nFound ${meetings.length} meeting(s) in Fathom\n`);

  for (const meeting of meetings) {
    const payload = buildIngestPayload(meeting);
    const durationMin = Math.round(
      (new Date(payload.ended_at).getTime() - new Date(payload.started_at).getTime()) / 60000,
    );

    console.log(`─── Meeting id=${meeting.id} recording_id=${meeting.recording_id}`);
    console.log(`    Title:    ${payload.title}`);
    console.log(`    Date:     ${payload.started_at.slice(0, 10)}  (${durationMin} min)`);
    console.log(`    Attendees: ${payload.attendees.join(', ') || '(none)'}`);
    console.log(`    Transcript: ${payload.transcript.length} chars`);
    console.log(`    Summary:  ${payload.summary ? 'yes' : 'no'}`);
    console.log(`    Actions:  ${payload.action_items?.length ?? 0}`);
    console.log(`    external_id: ${payload.external_id}`);

    if (!doIngest) {
      console.log(`    [dry-run] would POST to ${cortexUrl ?? '<CORTEX_PUBLIC_URL>'}/api/meetings/ingest\n`);
      continue;
    }

    const res = await fetch(`${cortexUrl}/api/meetings/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sharedSecret}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const result = await res.json() as any;
      console.log(`    ✓ Ingested → ${result.vault_path} (commit: ${result.commit_sha?.slice(0, 8)})\n`);
    } else {
      const text = await res.text().catch(() => '');
      console.error(`    ✗ Failed ${res.status}: ${text}\n`);
    }
  }

  if (!doIngest) {
    console.log('\nThis was a dry-run. Re-run with --ingest to actually ingest.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
