import chokidar from 'chokidar';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import matter from 'gray-matter';
import type { Config } from './config.js';
import type { IngestPayload } from './types.js';
import { uploadWithRetry } from './client.js';
import { markIngested } from './ingest-marker.js';
import { drain, enqueue, dequeue } from './queue.js';

const ALLOWED_EXT = '.md';

export function buildPayload(config: Config, filePath: string, raw: string): IngestPayload {
  const { data, content } = matter(raw);
  const ff = config.frontmatterFields;
  const d = data as Record<string, unknown>;
  return {
    title: String(d[ff.title] ?? path.basename(filePath, '.md')),
    started_at: new Date((d[ff.startedAt] as string | undefined) ?? Date.now()).toISOString(),
    ended_at: new Date((d[ff.endedAt] as string | undefined) ?? Date.now()).toISOString(),
    attendees: Array.isArray(d[ff.attendees]) ? (d[ff.attendees] as string[]) : [],
    transcript: content.trim(),
    source: 'meetily',
    external_id: (d[ff.externalId] as string | undefined) || undefined,
  };
}

export async function processFile(config: Config, filePath: string): Promise<void> {
  if (path.extname(filePath).toLowerCase() !== ALLOWED_EXT) return; // MEET-07 hard filter
  const raw = await fs.readFile(filePath, 'utf8').catch((err: unknown) => {
    console.error(`[watcher] cannot read ${filePath}: ${String(err)}`);
    return null;
  });
  if (raw === null) return;
  let payload: IngestPayload;
  try {
    payload = buildPayload(config, filePath, raw);
  } catch (err) {
    console.error(`[watcher] cannot build payload from ${filePath}: ${String(err)}`);
    return;
  }
  if (!payload.transcript || payload.transcript.length === 0) {
    console.warn(`[watcher] empty transcript in ${filePath}; skipping`);
    return;
  }
  await enqueue(config.stateDir, filePath, payload);
  try {
    const result = await uploadWithRetry(config, payload);
    await dequeue(config.stateDir, filePath);
    const newPath = await markIngested(filePath);
    console.log(`[watcher] ingested ${filePath} → ${newPath} (meeting=${result.meeting_id})`);
  } catch (err) {
    console.error(`[watcher] terminal upload failure for ${filePath}: ${String(err)}`);
    // Item stays in queue for next-boot drain attempt.
  }
}

export async function startWatcher(config: Config): Promise<void> {
  await drain(config.stateDir, async (item) => {
    await uploadWithRetry(config, item.payload);
    await markIngested(item.filePath).catch((err: unknown) => {
      console.warn(`[watcher] drain markIngested failed for ${item.filePath}: ${String(err)}`);
    });
  });

  const watcher = chokidar.watch(config.meetilyOutputDir, {
    ignored: (p: string) => p.includes('/_ingested/') || path.basename(p).startsWith('.'),
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 200 },
    ignoreInitial: false,
  });

  watcher.on('add', (filePath: string) => {
    processFile(config, filePath).catch((err: unknown) =>
      console.error(`[watcher] processFile threw for ${filePath}: ${String(err)}`),
    );
  });
  watcher.on('error', (err: unknown) => console.error('[chokidar]', err));

  console.log(`[watcher] watching ${config.meetilyOutputDir} (stable after 5s)`);
}
