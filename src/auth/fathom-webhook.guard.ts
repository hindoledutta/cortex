import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class FathomWebhookGuard implements CanActivate {
  private readonly logger = new Logger(FathomWebhookGuard.name);
  private readonly secret: Buffer;
  private static readonly TOLERANCE_MS = 5 * 60 * 1000;

  constructor(private readonly config: ConfigService) {
    this.secret = Buffer.from(
      this.config.getOrThrow<string>('FATHOM_WEBHOOK_SECRET'),
      'utf8',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { rawBody?: Buffer }>();

    const id = req.headers['webhook-id'] as string | undefined;
    const ts = req.headers['webhook-timestamp'] as string | undefined;
    const sig = req.headers['webhook-signature'] as string | undefined;

    if (!id || !ts || !sig) {
      throw new UnauthorizedException('Missing webhook headers');
    }

    // Replay protection: reject if timestamp is outside 5-minute window.
    if (
      Math.abs(Date.now() - parseInt(ts, 10) * 1000) >
      FathomWebhookGuard.TOLERANCE_MS
    ) {
      throw new UnauthorizedException('Webhook timestamp out of tolerance');
    }

    if (!req.rawBody) {
      this.logger.error(
        'rawBody unavailable — check main.ts path-scoped json verify middleware',
      );
      throw new UnauthorizedException('Raw body unavailable');
    }

    // Signature header format: "v1,<base64>" (space-separated if multiple; take first v1).
    const v1 = sig.split(' ').find((s) => s.startsWith('v1,'));
    if (!v1) throw new UnauthorizedException('No v1 signature found');

    const toSign = `${id}.${ts}.${req.rawBody.toString('utf8')}`;
    const computed = createHmac('sha256', this.secret)
      .update(toSign)
      .digest('base64');

    const expectedBuf = Buffer.from(v1.slice(3), 'base64');
    const computedBuf = Buffer.from(computed, 'base64');
    if (
      expectedBuf.length !== computedBuf.length ||
      !timingSafeEqual(expectedBuf, computedBuf)
    ) {
      this.logger.warn('FathomWebhookGuard: HMAC mismatch');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
