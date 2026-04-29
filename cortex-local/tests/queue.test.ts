import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { enqueue, dequeue, depth, drain } from '../src/queue.js';
import type { IngestPayload } from '../src/types.js';

const SAMPLE_PAYLOAD: IngestPayload = {
  title: 'Test Meeting',
  started_at: '2026-04-26T10:00:00Z',
  ended_at: '2026-04-26T10:30:00Z',
  attendees: ['Alice', 'Bob'],
  transcript: 'Hello world',
  source: 'meetily',
  external_id: 'mtg-001',
};

describe('queue', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-queue-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('enqueue then read returns the item with attempts === 0 and enqueuedAt ISO string', async () => {
    const filePath = '/some/meeting.md';
    await enqueue(tmpDir, filePath, SAMPLE_PAYLOAD);
    expect(await depth(tmpDir)).toBe(1);
    // Drain to inspect the item
    let capturedItem: { filePath: string; attempts: number; enqueuedAt: string } | undefined;
    await drain(tmpDir, async (item) => {
      capturedItem = item;
    });
    expect(capturedItem).toBeDefined();
    expect(capturedItem!.filePath).toBe(filePath);
    expect(capturedItem!.attempts).toBe(0);
    // enqueuedAt should be a valid ISO string
    expect(() => new Date(capturedItem!.enqueuedAt).toISOString()).not.toThrow();
  });

  it('enqueue with duplicate filePath does NOT add a second entry', async () => {
    const filePath = '/some/meeting.md';
    await enqueue(tmpDir, filePath, SAMPLE_PAYLOAD);
    await enqueue(tmpDir, filePath, SAMPLE_PAYLOAD);
    expect(await depth(tmpDir)).toBe(1);
  });

  it('dequeue removes matching filePath, other entries unaffected', async () => {
    const fileA = '/some/a.md';
    const fileB = '/some/b.md';
    await enqueue(tmpDir, fileA, SAMPLE_PAYLOAD);
    await enqueue(tmpDir, fileB, SAMPLE_PAYLOAD);
    expect(await depth(tmpDir)).toBe(2);
    await dequeue(tmpDir, fileA);
    expect(await depth(tmpDir)).toBe(1);
    // B still there
    let remaining: string | undefined;
    await drain(tmpDir, async (item) => {
      remaining = item.filePath;
    });
    expect(remaining).toBe(fileB);
  });

  it('drain: when retry resolves, item is removed; when retry throws, item stays', async () => {
    const goodFile = '/some/good.md';
    const badFile = '/some/bad.md';
    await enqueue(tmpDir, goodFile, SAMPLE_PAYLOAD);
    await enqueue(tmpDir, badFile, SAMPLE_PAYLOAD);

    await drain(tmpDir, async (item) => {
      if (item.filePath === badFile) throw new Error('upload failed');
    });

    // goodFile removed, badFile still present
    expect(await depth(tmpDir)).toBe(1);
    let remaining: string | undefined;
    await drain(tmpDir, async (item) => {
      remaining = item.filePath;
    });
    expect(remaining).toBe(badFile);
  });

  it('depth() returns count', async () => {
    expect(await depth(tmpDir)).toBe(0);
    await enqueue(tmpDir, '/a.md', SAMPLE_PAYLOAD);
    expect(await depth(tmpDir)).toBe(1);
    await enqueue(tmpDir, '/b.md', SAMPLE_PAYLOAD);
    expect(await depth(tmpDir)).toBe(2);
  });

  it('atomic-write evidence: .tmp file is absent after write (rename to final path occurred), final queue.json exists and contains valid JSON', async () => {
    // Node.js fs.rename on the same filesystem is atomic — the .tmp file is written then
    // renamed to queue.json. After enqueue() resolves, queue.json must exist and no .tmp
    // file should remain (it was renamed away).
    const queueTarget = path.join(tmpDir, 'queue.json');
    const tmpTarget = `${queueTarget}.tmp`;

    await enqueue(tmpDir, '/atomic.md', SAMPLE_PAYLOAD);

    // Final queue.json exists
    const stat = await fs.stat(queueTarget);
    expect(stat.isFile()).toBe(true);

    // .tmp file was cleaned up by rename
    await expect(fs.access(tmpTarget)).rejects.toThrow();

    // Content is valid JSON with the enqueued item
    const content = JSON.parse(await fs.readFile(queueTarget, 'utf8')) as unknown[];
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(1);
  });
});
