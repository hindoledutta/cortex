import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../src/config.js';

const VALID_CONFIG = {
  cortexApiUrl: 'https://cortex.example.com',
  sharedSecret: 'a'.repeat(32),
  meetilyOutputDir: '/Users/test/Documents/Meetily/exports',
  host: 'mac-mini-home',
  stateDir: '/Users/test/Library/Application Support/cortex-local/state',
};

describe('loadConfig', () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-config-test-'));
    originalEnv = process.env['CORTEX_LOCAL_CONFIG'];
    delete process.env['CORTEX_LOCAL_CONFIG'];
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env['CORTEX_LOCAL_CONFIG'] = originalEnv;
    } else {
      delete process.env['CORTEX_LOCAL_CONFIG'];
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws on missing path (no env var, no arg)', async () => {
    await expect(loadConfig()).rejects.toThrow(/CORTEX_LOCAL_CONFIG/);
  });

  it('throws on invalid JSON', async () => {
    const file = path.join(tmpDir, 'config.json');
    await fs.writeFile(file, 'not json { bad');
    await expect(loadConfig(file)).rejects.toThrow(/not valid JSON/);
  });

  it('throws on missing required fields', async () => {
    const file = path.join(tmpDir, 'config.json');
    await fs.writeFile(file, JSON.stringify({}));
    await expect(loadConfig(file)).rejects.toThrow(/Config validation failed/);
  });

  it('throws if sharedSecret is shorter than 32 chars', async () => {
    const file = path.join(tmpDir, 'config.json');
    await fs.writeFile(
      file,
      JSON.stringify({ ...VALID_CONFIG, sharedSecret: 'tooshort' }),
    );
    await expect(loadConfig(file)).rejects.toThrow(/Config validation failed/);
  });

  it('throws if cortexApiUrl is not a valid URL', async () => {
    const file = path.join(tmpDir, 'config.json');
    await fs.writeFile(
      file,
      JSON.stringify({ ...VALID_CONFIG, cortexApiUrl: 'not-a-url' }),
    );
    await expect(loadConfig(file)).rejects.toThrow(/Config validation failed/);
  });

  it('parses valid config and applies defaults', async () => {
    const file = path.join(tmpDir, 'config.json');
    await fs.writeFile(file, JSON.stringify(VALID_CONFIG));
    const config = await loadConfig(file);
    expect(config.heartbeatCron).toBe('0 9 * * *');
    expect(config.frontmatterFields.externalId).toBe('meeting-id');
    expect(config.frontmatterFields.title).toBe('title');
    expect(config.frontmatterFields.startedAt).toBe('started_at');
    expect(config.frontmatterFields.endedAt).toBe('ended_at');
    expect(config.frontmatterFields.attendees).toBe('attendees');
  });

  it('honors explicit frontmatterFields overrides', async () => {
    const file = path.join(tmpDir, 'config.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        ...VALID_CONFIG,
        frontmatterFields: {
          title: 'meeting_name',
          startedAt: 'started',
          endedAt: 'ended',
          attendees: 'participants',
          externalId: 'uid',
        },
      }),
    );
    const config = await loadConfig(file);
    expect(config.frontmatterFields.title).toBe('meeting_name');
    expect(config.frontmatterFields.startedAt).toBe('started');
    expect(config.frontmatterFields.endedAt).toBe('ended');
    expect(config.frontmatterFields.attendees).toBe('participants');
    expect(config.frontmatterFields.externalId).toBe('uid');
  });
});
