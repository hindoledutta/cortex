/**
 * dry-run.ts — validate a Meetily recording folder without POSTing.
 * Usage: npm run dry-run -- /path/to/meetily/recording-folder
 */
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { loadConfig } from './config.js';
import { buildPayload } from './watcher.js';

async function main(): Promise<void> {
  const folderPath = process.argv[2];
  if (!folderPath) {
    console.error('Usage: npm run dry-run -- /path/to/meetily/recording-folder');
    process.exit(2);
  }

  try {
    await loadConfig();
  } catch (err) {
    console.error(`Failed to load config: ${String(err)}`);
    process.exit(1);
  }

  const metadataPath = path.join(folderPath, 'metadata.json');
  const transcriptsPath = path.join(folderPath, 'transcripts.json');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let metadata: any;
  try {
    metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read metadata.json at "${metadataPath}": ${String(err)}`);
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let transcripts: { segments: any[] } = { segments: [] };
  try {
    transcripts = JSON.parse(await fs.readFile(transcriptsPath, 'utf8'));
  } catch (err) {
    console.warn(`Cannot read transcripts.json (continuing with empty transcript): ${String(err)}`);
  }

  console.log('\n--- metadata.json ---');
  console.log(JSON.stringify(metadata, null, 2));
  console.log(`\n--- transcripts.json (${(transcripts.segments ?? []).length} segments) ---`);
  if (transcripts.segments && transcripts.segments.length > 0) {
    console.log(JSON.stringify(transcripts.segments.slice(0, 3), null, 2), '... (first 3 shown)');
  }

  const payload = buildPayload(folderPath, metadata, transcripts);
  const PREVIEW_LEN = 300;
  const preview = {
    ...payload,
    transcript:
      payload.transcript.length > PREVIEW_LEN
        ? `${payload.transcript.slice(0, PREVIEW_LEN)} ... [${payload.transcript.length} chars total]`
        : payload.transcript,
  };

  console.log('\n--- Would-be POST body (/api/meetings/ingest) ---');
  console.log(JSON.stringify(preview, null, 2));
  console.log('\nDry-run complete. No POST was made.');
}

main().catch((err) => {
  console.error('dry-run FATAL:', err);
  process.exit(1);
});
