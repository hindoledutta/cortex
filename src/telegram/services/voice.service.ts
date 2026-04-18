import { Injectable, Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';

/**
 * Transcribes voice messages using OpenAI Whisper API.
 *
 * Accepts a URL (file link from Telegram) rather than a Telegraf Context
 * to keep the service decoupled from the Telegram framework.
 * The orchestrator extracts the file link from Context and passes it here.
 */
@Injectable()
export class VoiceService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(VoiceService.name);

  constructor() {
    this.openai = new OpenAI();
  }

  /**
   * Download an OGG voice file from Telegram and transcribe via Whisper.
   * @param fileLink URL to the voice message file (obtained from Telegraf ctx.telegram.getFileLink)
   * @returns Transcribed text
   */
  async transcribe(fileLink: URL): Promise<string> {
    this.logger.log(`Transcribing voice from ${fileLink.href}`);

    const response = await fetch(fileLink.href);
    const buffer = Buffer.from(await response.arrayBuffer());

    const transcription = await this.openai.audio.transcriptions.create({
      file: await toFile(buffer, 'voice.ogg', {
        type: 'audio/ogg',
      }),
      model: 'whisper-1',
      language: 'en',
    });

    this.logger.log(
      `Transcription complete: ${transcription.text.length} chars`,
    );
    return transcription.text;
  }
}
