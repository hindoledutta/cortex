import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getBotToken } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { json, urlencoded } from 'express';

// BigInt cannot be serialized by JSON.stringify by default.
// Prisma returns BigInt for telegram_msg_id columns; this makes them serializable.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for dashboard requests
  app.enableCors({
    origin: process.env.DASHBOARD_URL ?? 'http://localhost:5173',
    methods: ['GET', 'PATCH', 'POST', 'DELETE'],
    credentials: true,
  });

  // Raise body-parser limit to 5MB so 1h meeting transcripts (50-200KB typical, up to ~1.5MB) do not 413.
  // MUST come BEFORE bot.webhookCallback so Telegraf installs its own parser AFTER ours for the webhook path.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ limit: '5mb', extended: true }));

  // Set up Telegram webhook middleware
  // The bot token in the path provides security (only Telegram knows the URL)
  const bot = app.get<Telegraf>(getBotToken());
  app.use(bot.webhookCallback(`/bot/${process.env.TELEGRAM_BOT_TOKEN}`));

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
