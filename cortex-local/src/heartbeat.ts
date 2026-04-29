import cron from 'node-cron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from './config.js';
import type { HeartbeatState } from './types.js';
import { getRuntimeState } from './client.js';
import { depth } from './queue.js';

const HEARTBEAT_FILE = 'heartbeat.json';
const PKG_VERSION = '0.1.0'; // bump alongside package.json on release

async function readState(stateDir: string): Promise<HeartbeatState | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(stateDir, HEARTBEAT_FILE), 'utf8')) as HeartbeatState;
  } catch {
    return null;
  }
}

async function writeState(stateDir: string, state: HeartbeatState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, HEARTBEAT_FILE);
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, target);
}

export async function pingHeartbeat(config: Config): Promise<void> {
  const runtime = await getRuntimeState(config.stateDir);
  const queueDepth = await depth(config.stateDir);
  const url = `${config.cortexApiUrl.replace(/\/$/, '')}/api/heartbeat`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.sharedSecret}`,
    },
    body: JSON.stringify({
      host: config.host,
      version: PKG_VERSION,
      last_ingest_at: runtime.lastIngestAt,
      queue_depth: queueDepth,
      last_error: runtime.lastError,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`heartbeat ${res.status}`);
  await writeState(config.stateDir, { lastHeartbeatAt: new Date().toISOString() });
  console.log(`[heartbeat] ok (queue=${queueDepth}, lastErr=${runtime.lastError ? 'yes' : 'no'})`);
}

export async function startHeartbeat(config: Config): Promise<void> {
  const state = await readState(config.stateDir);
  const lastMs = state ? new Date(state.lastHeartbeatAt).getTime() : 0;
  if (Date.now() - lastMs > 24 * 60 * 60 * 1000) {
    pingHeartbeat(config).catch((err: unknown) =>
      console.error(`[heartbeat] catch-up ping failed: ${String(err)}`),
    );
  }
  cron.schedule(
    config.heartbeatCron,
    () => {
      pingHeartbeat(config).catch((err: unknown) =>
        console.error(`[heartbeat] scheduled ping failed: ${String(err)}`),
      );
    },
    { timezone: 'UTC' },
  );
  console.log(`[heartbeat] cron registered: "${config.heartbeatCron}" UTC`);
}
