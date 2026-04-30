import chokidar from 'chokidar';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Config } from './config.js';
import type { IngestPayload } from './types.js';
import { uploadWithRetry } from './client.js';
import { drain, enqueue, dequeue } from './queue.js';

const METADATA_FILE = 'metadata.json';
const INGESTED_MARKER = '.ingested';

interface MeetilyMetadata {
  meeting_id: string | null;
  meeting_name: string;
  created_at: string;
  completed_at: string | null;
  status: string;
}

interface MeetilySegment {
  text: string;
  audio_start_time: number;
  sequence_id: number;
}

interface MeetilyTranscripts {
  segments: MeetilySegment[];
}

export function buildPayload(
  folderPath: string,
  metadata: MeetilyMetadata,
  transcripts: MeetilyTranscripts,
): IngestPayload {
  const segments = [...transcripts.segments].sort((a, b) => a.sequence_id - b.sequence_id);
  const transcript = segments
    .map((s) => {
      const mins = Math.floor(s.audio_start_time / 60);
      const secs = Math.floor(s.audio_start_time % 60);
      return `[${mins}:${secs.toString().padStart(2, '0')}] ${s.text}`;
    })
    .join('\n');

  return {
    title: metadata.meeting_name || path.basename(folderPath),
    started_at: new Date(metadata.created_at).toISOString(),
    ended_at: new Date(metadata.completed_at ?? metadata.created_at).toISOString(),
    attendees: [],
    transcript,
    source: 'meetily',
    external_id: metadata.meeting_id ?? undefined,
  };
}

export async function processFolder(config: Config, folderPath: string): Promise<void> {
  const markerPath = path.join(folderPath, INGESTED_MARKER);
  try {
    await fs.access(markerPath);
    return; // already ingested
  } catch {
    // not yet ingested — continue
  }

  const metadataPath = path.join(folderPath, METADATA_FILE);
  const rawMetadata = await fs.readFile(metadataPath, 'utf8').catch((err: unknown) => {
    console.error(`[watcher] cannot read ${metadataPath}: ${String(err)}`);
    return null;
  });
  if (rawMetadata === null) return;

  let metadata: MeetilyMetadata;
  try {
    metadata = JSON.parse(rawMetadata) as MeetilyMetadata;
  } catch (err) {
    console.error(`[watcher] invalid JSON in ${metadataPath}: ${String(err)}`);
    return;
  }

  if (metadata.status !== 'completed') return;

  const transcriptsPath = path.join(folderPath, 'transcripts.json');
  const rawTranscripts = await fs.readFile(transcriptsPath, 'utf8').catch((err: unknown) => {
    console.warn(`[watcher] cannot read transcripts.json in ${folderPath}: ${String(err)}`);
    return null;
  });

  let transcripts: MeetilyTranscripts = { segments: [] };
  if (rawTranscripts !== null) {
    try {
      transcripts = JSON.parse(rawTranscripts) as MeetilyTranscripts;
    } catch {
      // leave as empty
    }
  }

  if (!transcripts.segments || transcripts.segments.length === 0) {
    console.warn(`[watcher] empty transcript in ${folderPath}; skipping`);
    return;
  }

  const payload = buildPayload(folderPath, metadata, transcripts);
  await enqueue(config.stateDir, folderPath, payload);

  try {
    const result = await uploadWithRetry(config, payload);
    await dequeue(config.stateDir, folderPath);
    await fs.writeFile(markerPath, new Date().toISOString());
    console.log(`[watcher] ingested ${folderPath} (meeting=${result.meeting_id})`);
  } catch (err) {
    console.error(`[watcher] terminal upload failure for ${folderPath}: ${String(err)}`);
  }
}

export async function processMetadataFile(config: Config, filePath: string): Promise<void> {
  if (path.basename(filePath) !== METADATA_FILE) return;
  await processFolder(config, path.dirname(filePath));
}

export async function startWatcher(config: Config): Promise<void> {
  await drain(config.stateDir, async (item) => {
    await uploadWithRetry(config, item.payload);
    const markerPath = path.join(item.filePath, INGESTED_MARKER);
    await fs.writeFile(markerPath, new Date().toISOString()).catch((err: unknown) => {
      console.warn(`[watcher] drain marker write failed for ${item.filePath}: ${String(err)}`);
    });
  });

  const watcher = chokidar.watch(config.meetilyOutputDir, {
    ignored: (p: string) =>
      path.basename(p).startsWith('.') || path.basename(p) === INGESTED_MARKER,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 },
    ignoreInitial: false,
    depth: 1,
  });

  watcher.on('add', (filePath: string) => {
    processMetadataFile(config, filePath).catch((err: unknown) =>
      console.error(`[watcher] error processing ${filePath}: ${String(err)}`),
    );
  });
  watcher.on('change', (filePath: string) => {
    processMetadataFile(config, filePath).catch((err: unknown) =>
      console.error(`[watcher] error on change ${filePath}: ${String(err)}`),
    );
  });
  watcher.on('error', (err: unknown) => console.error('[chokidar]', err));

  console.log(`[watcher] watching ${config.meetilyOutputDir} (stable after 5s)`);
}
