import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { IngestPayload, QueuedItem } from './types.js';

const QUEUE_FILE = 'queue.json';

async function readQueue(stateDir: string): Promise<QueuedItem[]> {
  try {
    const raw = await fs.readFile(path.join(stateDir, QUEUE_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as QueuedItem[];
    return [];
  } catch {
    // Missing file or corrupted JSON — start with empty queue
    return [];
  }
}

async function writeQueue(stateDir: string, items: QueuedItem[]): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, QUEUE_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2));
  await fs.rename(tmp, target);
}

export async function enqueue(
  stateDir: string,
  filePath: string,
  payload: IngestPayload,
): Promise<void> {
  const items = await readQueue(stateDir);
  // Deduplicate by filePath — don't add if already pending
  if (items.some((item) => item.filePath === filePath)) {
    return;
  }
  items.push({
    filePath,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
  });
  await writeQueue(stateDir, items);
}

export async function dequeue(stateDir: string, filePath: string): Promise<void> {
  const items = await readQueue(stateDir);
  const filtered = items.filter((item) => item.filePath !== filePath);
  await writeQueue(stateDir, filtered);
}

export async function depth(stateDir: string): Promise<number> {
  const items = await readQueue(stateDir);
  return items.length;
}

export async function drain(
  stateDir: string,
  retry: (item: QueuedItem) => Promise<void>,
): Promise<void> {
  const items = await readQueue(stateDir);
  for (const item of items) {
    try {
      await retry(item);
      await dequeue(stateDir, item.filePath);
    } catch (err) {
      console.error(`[queue] drain failed for ${item.filePath}: ${String(err)}`);
      // Continue with other items — don't let one failure abort the drain
    }
  }
}
