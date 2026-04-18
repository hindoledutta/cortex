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
 * After running, add the printed GOOGLE_REFRESH_TOKEN to your .env file.
 */

import 'dotenv/config';
import * as readline from 'readline';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
];
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

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
  console.log('2. Sign in and grant calendar access');
  console.log('3. Copy the authorization code and paste it below\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const code = await new Promise<string>((resolve) => {
    rl.question('Authorization code: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!code) {
    console.error('ERROR: No authorization code provided');
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.error(
        'ERROR: No refresh token received. Make sure you used prompt: "consent" and access_type: "offline".',
      );
      console.error(
        'Try revoking access at https://myaccount.google.com/permissions and running again.',
      );
      process.exit(1);
    }

    console.log('\n=== Success! ===\n');
    console.log('Add this to your .env file:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log(
      'You can now use the Calendar Integration features in Cortex.',
    );
  } catch (error) {
    console.error('ERROR: Failed to exchange authorization code for tokens');
    console.error(
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

main();
