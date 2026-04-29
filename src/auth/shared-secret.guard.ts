import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Guard that authenticates requests from the cortex-local daemon using a shared Bearer token.
 *
 * Unlike ChatIdGuard (which silently drops unauthorized Telegram noise), this guard
 * THROWS UnauthorizedException on any auth failure so the daemon knows its token is wrong
 * and can surface a clear error to the operator.
 *
 * Uses node:crypto.timingSafeEqual to prevent timing-based token oracle attacks.
 */
@Injectable()
export class SharedSecretGuard implements CanActivate {
  private readonly logger = new Logger(SharedSecretGuard.name);
  private readonly expectedSecret: Buffer;

  constructor(private readonly config: ConfigService) {
    const secret = this.config.getOrThrow<string>('CORTEX_LOCAL_SHARED_SECRET');
    if (secret.length < 32) {
      throw new Error(
        'CORTEX_LOCAL_SHARED_SECRET must be at least 32 characters (use `openssl rand -hex 32`)',
      );
    }
    this.expectedSecret = Buffer.from(secret, 'utf8');
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = (req.headers.authorization as string | undefined) ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/);
    if (!m) {
      this.logger.warn(`SharedSecretGuard: missing Bearer header (path=${req.path})`);
      throw new UnauthorizedException('Missing bearer token');
    }
    const provided = Buffer.from(m[1], 'utf8');
    if (provided.length !== this.expectedSecret.length) {
      this.logger.warn(`SharedSecretGuard: token length mismatch (path=${req.path})`);
      throw new UnauthorizedException('Invalid token');
    }
    if (!timingSafeEqual(provided, this.expectedSecret)) {
      this.logger.warn(`SharedSecretGuard: token mismatch (path=${req.path})`);
      throw new UnauthorizedException('Invalid token');
    }
    return true;
  }
}
