import { loadConfig } from './config.js';
import { startWatcher } from './watcher.js';
import { startHeartbeat } from './heartbeat.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  console.log(`[cortex-local] starting; host=${config.host}; watching=${config.meetilyOutputDir}`);
  await startWatcher(config);
  await startHeartbeat(config);
}

main().catch((err: unknown) => {
  console.error('[cortex-local] FATAL:', err);
  process.exit(1);
});
