import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

/**
 * Manages the Google OAuth2 client lifecycle.
 * Configures credentials from environment variables and provides
 * the authenticated client for Google Calendar API calls.
 *
 * The OAuth2Client automatically refreshes access tokens when they expire.
 */
@Injectable()
export class GoogleAuthService implements OnModuleInit {
  private readonly logger = new Logger(GoogleAuthService.name);
  private oauth2Client!: OAuth2Client;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    const refreshToken = this.config.get<string>('GOOGLE_REFRESH_TOKEN');

    if (!clientId || !clientSecret) {
      this.logger.warn(
        'Google OAuth credentials not configured. Calendar features will be unavailable.',
      );
    }

    this.oauth2Client = new OAuth2Client(clientId, clientSecret);

    if (refreshToken) {
      this.oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });
      this.logger.log('Google OAuth2 client initialized with refresh token');
    } else {
      this.logger.warn(
        'GOOGLE_REFRESH_TOKEN not set. Run `npx tsx scripts/google-oauth-setup.ts` to obtain one.',
      );
    }
  }

  /**
   * Returns the configured OAuth2Client for use with Google APIs.
   */
  getClient(): OAuth2Client {
    return this.oauth2Client;
  }
}
