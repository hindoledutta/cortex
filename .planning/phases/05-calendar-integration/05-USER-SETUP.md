# Phase 5: User Setup Required

**Generated:** 2026-02-28
**Phase:** 05-calendar-integration
**Status:** Incomplete

Complete these items for the Google Calendar integration to function. Claude automated everything possible; these items require human access to the Google Cloud Console.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `GOOGLE_CLIENT_ID` | Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client IDs -> Create (Desktop app type) | `.env` |
| [ ] | `GOOGLE_CLIENT_SECRET` | Same credential page as GOOGLE_CLIENT_ID | `.env` |
| [ ] | `GOOGLE_REFRESH_TOKEN` | Run `npx tsx scripts/google-oauth-setup.ts` after setting CLIENT_ID and CLIENT_SECRET | `.env` |

## Account Setup

- [ ] **Create Google Cloud project** (if needed)
  - URL: https://console.cloud.google.com/projectcreate
  - Skip if: Already have a Google Cloud project

## Dashboard Configuration

- [ ] **Enable Google Calendar API**
  - Location: Google Cloud Console -> APIs & Services -> Library
  - Search: "Google Calendar API"
  - Click: Enable

- [ ] **Configure OAuth consent screen**
  - Location: Google Cloud Console -> APIs & Services -> OAuth consent screen
  - User type: External
  - Add your email as a test user
  - Note: Publish the app to avoid 7-day token expiry (or re-run the setup script periodically)

- [ ] **Create OAuth 2.0 credentials**
  - Location: Google Cloud Console -> APIs & Services -> Credentials -> Create Credentials -> OAuth client ID
  - Application type: Desktop app
  - Copy Client ID and Client Secret to `.env`

## Getting the Refresh Token

After setting `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`:

```bash
npx tsx scripts/google-oauth-setup.ts
```

1. The script prints an authorization URL
2. Open it in your browser, sign in, grant calendar access
3. Paste the authorization code back in the terminal
4. Copy the printed `GOOGLE_REFRESH_TOKEN` to `.env`

## Optional Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `USER_TIMEZONE` | `America/New_York` | Your timezone for calendar scheduling |
| `WORKING_HOURS_START` | `9` | Working hours start (24h format) |
| `WORKING_HOURS_END` | `17` | Working hours end (24h format) |

## Verification

After completing setup:

```bash
# Check env vars are set
grep GOOGLE .env

# Verify the app can load (NestJS will log initialization)
npm run start:dev
# Look for: "Google OAuth2 client initialized with refresh token"
```

Expected: GoogleAuthService logs successful initialization with refresh token.

---

**Once all items complete:** Mark status as "Complete" at top of file.
