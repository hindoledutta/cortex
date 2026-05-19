/**
 * One-time OAuth2 setup script for obtaining a Google Calendar refresh token.
 *
 * Prerequisites:
 *   1. Create OAuth 2.0 credentials (Desktop app type) at:
 *      Google Cloud Console -> APIs & Services -> Credentials
 *   2. Enable Google Calendar API at:
 *      Google Cloud Console -> APIs & Services -> Library
 *   3. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *
 * Usage:
 *   npx tsx scripts/google-oauth-setup.ts
 *
 * The script spins up a temporary local server on port 8085 to capture the
 * OAuth redirect, so the browser flow completes automatically — no copy-paste
 * of authorization codes required.
 *
 * After running, copy the printed GOOGLE_REFRESH_TOKEN to .env and Fly secrets.
 */

import 'dotenv/config';
import * as http from 'http';
import { URL } from 'url';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];
const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function waitForCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Missing URL');
        return;
      }
      const parsed = new URL(req.url, `http://localhost:${PORT}`);
      if (parsed.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(
          `<h1>OAuth error: ${error}</h1><p>Close this tab and check the terminal.</p>`,
        );
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('Missing code in callback');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<h1>✓ Success</h1><p>You can close this tab and return to the terminal.</p>',
      );
      server.close();
      resolve(code);
    });

    server.on('error', reject);
    server.listen(PORT, () => {
      console.log(`Listening on http://localhost:${PORT} for the OAuth redirect...\n`);
    });
  });
}

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      'ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env',
    );
    console.error(
      'Create OAuth 2.0 credentials at: https://console.cloud.google.com/apis/credentials',
    );
    process.exit(1);
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\n=== Google Calendar OAuth2 Setup ===\n');
  console.log('1. Open this URL in your browser:\n');
  console.log(`   ${authUrl}\n`);
  console.log('2. Sign in with the Google account whose calendar Cortex should book on');
  console.log('3. Grant calendar access — browser will redirect to localhost automatically\n');

  const code = await waitForCode();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.error(
        'ERROR: No refresh token received. Revoke access at https://myaccount.google.com/permissions and retry.',
      );
      process.exit(1);
    }

    console.log('\n=== Success! ===\n');
    console.log('Add this to your .env and Fly secrets:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (error) {
    console.error('ERROR: Failed to exchange authorization code for tokens');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
