import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getBotToken } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

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

  // Set up Telegram webhook middleware
  // The bot token in the path provides security (only Telegram knows the URL)
  const bot = app.get<Telegraf>(getBotToken());
  app.use(bot.webhookCallback(`/bot/${process.env.TELEGRAM_BOT_TOKEN}`));

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
