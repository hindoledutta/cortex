/**
 * One-time registration of the Cortex Fathom webhook.
 *
 * Prerequisites:
 *   FATHOM_API_KEY      — from Fathom Settings → API Access
 *   CORTEX_PUBLIC_URL   — e.g. https://cortex-hindole.fly.dev
 *
 * Usage:
 *   npx tsx scripts/fathom-register-webhook.ts
 *
 * After running: copy the `secret` from the response and set it on Fly.io:
 *   fly secrets set FATHOM_WEBHOOK_SECRET=<secret>
 */
import 'dotenv/config';

async function main() {
  const apiKey = process.env.FATHOM_API_KEY;
  const cortexUrl = process.env.CORTEX_PUBLIC_URL?.replace(/\/$/, '');

  if (!apiKey || !cortexUrl) {
    console.error('ERROR: FATHOM_API_KEY and CORTEX_PUBLIC_URL must be set');
    process.exit(1);
  }

  const destinationUrl = `${cortexUrl}/api/meetings/fathom-webhook`;

  const res = await fetch('https://api.fathom.ai/external/v1/webhooks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      destination_url: destinationUrl,
      triggered_for: ['my_recordings'],
      include_transcript: true,
      include_summary: true,
      include_action_items: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`ERROR: Fathom API returned ${res.status}: ${text}`);
    process.exit(1);
  }

  const data = (await res.json()) as Record<string, unknown>;

  console.log('\n=== Fathom webhook registered ===\n');
  console.log(`Destination: ${destinationUrl}`);
  console.log(`Webhook ID:  ${data['id'] ?? '(see response below)'}`);
  console.log(`\nFull response:\n${JSON.stringify(data, null, 2)}`);
  console.log('\n=== Next step ===');
  console.log(
    `Copy the "secret" field above and run:\n  fly secrets set FATHOM_WEBHOOK_SECRET=${data['secret'] ?? '<secret>'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
