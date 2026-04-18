import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegrafExecutionContext } from 'nestjs-telegraf';
import { Context } from 'telegraf';

/**
 * Guard that restricts bot access to a single owner chat ID.
 * Silently ignores messages from non-owner chats (returns false).
 */
@Injectable()
export class ChatIdGuard implements CanActivate {
  private readonly ownerChatId: number;

  constructor(private readonly config: ConfigService) {
    this.ownerChatId = Number(this.config.get<string>('OWNER_CHAT_ID'));
  }

  canActivate(context: ExecutionContext): boolean {
    const ctx = TelegrafExecutionContext.create(context).getContext<Context>();
    return ctx.chat?.id === this.ownerChatId;
  }
}
