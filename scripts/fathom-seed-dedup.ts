/**
 * Seed Meeting dedup rows for Fathom recordings that already exist in nirvana-wiki.
 *
 * Purpose: after migrating to a fresh DB, prevent `fathom-backfill --ingest` from
 * re-writing wiki files that are already committed. Without this seed, VaultService's
 * collision resolution would create `<slug>-2.md`, `<slug>-3.md` duplicates.
 *
 * Pairs Fathom meetings to wiki files by chronological order within each base-slug group,
 * so collision-suffixed files (foo.md, foo-2.md, ...) match Fathom meetings in
 * recording order.
 *
 * Prerequisites:
 *   FATHOM_API_KEY            — Fathom Settings → API Access
 *   DATABASE_URL              — Supabase or any Postgres
 *   NIRVANA_WIKI_LOCAL_PATH   — local clone path (default /Users/hindole/work/nirvana-wiki)
 *
 * Usage:
 *   npx tsx scripts/fathom-seed-dedup.ts              # dry-run (default)
 *   npx tsx scripts/fathom-seed-dedup.ts --commit     # actually insert rows
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import slugify from 'slug';
import { PrismaClient } from '../prisma/generated/prisma/client/client';
import { PrismaPg } from '@prisma/adapter-pg';

const FATHOM_BASE = 'https://api.fathom.ai/external/v1';
const WIKI_PATH = process.env.NIRVANA_WIKI_LOCAL_PATH ?? '/Users/hindole/work/nirvana-wiki';

async function fathomGet(p: string, apiKey: string): Promise<any> {
  const res = await fetch(`${FATHOM_BASE}${p}`, { headers: { 'X-Api-Key': apiKey } });
  if (!res.ok) throw new Error(`Fathom ${res.status}: ${await res.text()}`);
  return res.json();
}

function computeBasePath(title: string, startedAtIso: string): { dateStr: string; slug: string } {
  // Mirrors meetings.service.ts lines 46-53 exactly.
  const baseSlug = slugify(title, { lower: true }).slice(0, 80);
  const slug = baseSlug.length > 0 ? baseSlug : 'untitled-meeting';
  const dateStr = new Date(startedAtIso).toISOString().slice(0, 10);
  return { dateStr, slug };
}

async function listExistingFiles(dateStr: string, slug: string): Promise<string[]> {
  const dir = path.join(WIKI_PATH, 'raw', 'meetings');
  const all = await fs.readdir(dir);
  const base = `${dateStr}-${slug}`;
  // Match base.md AND base-N.md, sort by suffix number (base = 1).
  const matches: { name: string; n: number }[] = [];
  for (const f of all) {
    if (f === `${base}.md`) matches.push({ name: f, n: 1 });
    else {
      const m = f.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.md$`));
      if (m) matches.push({ name: f, n: parseInt(m[1], 10) });
    }
  }
  matches.sort((a, b) => a.n - b.n);
  return matches.map((m) => m.name);
}

async function main() {
  const apiKey = process.env.FATHOM_API_KEY;
  if (!apiKey) { console.error('ERROR: FATHOM_API_KEY not set'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }

  const doCommit = process.argv.includes('--commit');

  // Verify wiki path exists.
  try { await fs.access(path.join(WIKI_PATH, 'raw', 'meetings')); }
  catch { console.error(`ERROR: wiki not found at ${WIKI_PATH}/raw/meetings`); process.exit(1); }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  // Need workspaceId for inserts.
  const workspace = await prisma.workspace.findUnique({ where: { name: 'work' } });
  if (!workspace) { console.error('ERROR: work workspace missing — run prisma/seed.ts first'); process.exit(1); }

  // Fetch all Fathom meetings (paginated).
  console.log('Fetching Fathom meetings...');
  const meetings: any[] = [];
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
  console.log(`Fetched ${meetings.length} Fathom meetings.\n`);

  // Group meetings by computed base path.
  type Group = { dateStr: string; slug: string; items: any[] };
  const groups = new Map<string, Group>();
  for (const m of meetings) {
    const title = m.title ?? m.meeting_title ?? `Fathom Meeting ${m.recording_id}`;
    const startedAtIso = m.recording_start_time ?? m.scheduled_start_time ?? m.started_at ?? m.created_at;
    if (!startedAtIso) continue;
    const { dateStr, slug } = computeBasePath(title, startedAtIso);
    const key = `${dateStr}-${slug}`;
    if (!groups.has(key)) groups.set(key, { dateStr, slug, items: [] });
    groups.get(key)!.items.push({ ...m, _title: title, _startedAtIso: startedAtIso });
  }

  // Pair each group's items (chronological) with wiki files (suffix order).
  const toSeed: { meeting: any; vaultPath: string }[] = [];
  const toBackfill: any[] = [];
  for (const g of groups.values()) {
    g.items.sort((a, b) => new Date(a._startedAtIso).getTime() - new Date(b._startedAtIso).getTime());
    const files = await listExistingFiles(g.dateStr, g.slug);
    for (let i = 0; i < g.items.length; i++) {
      if (i < files.length) {
        toSeed.push({ meeting: g.items[i], vaultPath: `raw/meetings/${files[i]}` });
      } else {
        toBackfill.push(g.items[i]);
      }
    }
  }

  console.log(`Plan:`);
  console.log(`  ${toSeed.length} Fathom meetings will be SEEDED as dedup rows (already in wiki)`);
  console.log(`  ${toBackfill.length} Fathom meetings have NO wiki file → backfill will ingest them`);
  console.log(`\nMeetings that will be backfilled:`);
  for (const m of toBackfill) {
    console.log(`  - [${m._startedAtIso.slice(0,10)}] ${m._title} (recording_id=${m.recording_id})`);
  }

  if (!doCommit) {
    console.log(`\n[dry-run] Re-run with --commit to insert ${toSeed.length} dedup rows.`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\nInserting ${toSeed.length} dedup rows...`);
  let inserted = 0;
  let skipped = 0;
  for (const { meeting, vaultPath } of toSeed) {
    const externalId = String(meeting.recording_id);
    const existing = await prisma.meeting.findFirst({ where: { source: 'fathom', externalId } });
    if (existing) { skipped++; continue; }
    const startedAt = new Date(meeting._startedAtIso);
    const endedAtIso = meeting.recording_end_time ?? meeting.scheduled_end_time ?? meeting.ended_at ?? meeting._startedAtIso;
    const endedAt = new Date(endedAtIso);
    const attendees: string[] = (meeting.calendar_invitees ?? []).map((i: any) => i.email).filter(Boolean);
    const transcript = '(seeded — original transcript in Fathom recording_id=' + externalId + ')';
    await prisma.meeting.create({
      data: {
        workspaceId: workspace.id,
        title: meeting._title,
        startedAt,
        endedAt,
        attendeeEmails: attendees,
        transcript,
        source: 'fathom',
        externalId,
        vaultPath,
        vaultCommitSha: '',
      },
    });
    inserted++;
  }
  console.log(`Done. Inserted ${inserted} rows, skipped ${skipped} (already present).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
