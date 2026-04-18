import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const apiKey = this.config.get<string>('DASHBOARD_API_KEY');

    // If no API key configured, allow all requests (dev mode)
    if (!apiKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headerKey = request.headers['x-api-key'];

    if (headerKey !== apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
