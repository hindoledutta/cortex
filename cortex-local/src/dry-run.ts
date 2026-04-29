/**
 * dry-run.ts — validate Meetily frontmatter output without POSTing.
 * Usage: npm run dry-run -- /absolute/path/to/sample.md
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import matter from 'gray-matter';
import { loadConfig } from './config.js';
import type { IngestPayload } from './types.js';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npm run dry-run -- /absolute/path/to/sample.md');
    process.exit(2);
  }

  let config;
  try {
    config = await loadConfig();
  } catch (err) {
    console.error(`Failed to load config: ${String(err)}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    console.error(`Cannot read file "${filePath}": ${String(err)}`);
    process.exit(1);
  }

  const { data, content } = matter(raw);
  const ff = config.frontmatterFields;
  const d = data as Record<string, unknown>;

  console.log('\n--- Parsed frontmatter ---');
  console.log(JSON.stringify(data, null, 2));

  const payload: IngestPayload = {
    title: String(d[ff.title] ?? path.basename(filePath, '.md')),
    started_at: new Date((d[ff.startedAt] as string | undefined) ?? Date.now()).toISOString(),
    ended_at: new Date((d[ff.endedAt] as string | undefined) ?? Date.now()).toISOString(),
    attendees: Array.isArray(d[ff.attendees]) ? (d[ff.attendees] as string[]) : [],
    transcript: content.trim(),
    source: 'meetily',
    external_id: (d[ff.externalId] as string | undefined) || undefined,
  };

  const TRANSCRIPT_PREVIEW_LEN = 200;
  const transcriptFull = payload.transcript;
  const previewPayload = {
    ...payload,
    transcript:
      transcriptFull.length > TRANSCRIPT_PREVIEW_LEN
        ? `${transcriptFull.slice(0, TRANSCRIPT_PREVIEW_LEN)} ... [${transcriptFull.length} chars total]`
        : transcriptFull,
  };

  console.log('\n--- Would-be POST body (/api/meetings/ingest) ---');
  console.log(JSON.stringify(previewPayload, null, 2));
  console.log('\nDry-run complete. No POST was made.');
}

main().catch((err) => {
  console.error('dry-run FATAL:', err);
  process.exit(1);
});
