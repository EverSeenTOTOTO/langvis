import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig, ToolEvent } from '@/shared/types';
import { promises as fs } from 'fs';
import path from 'path';
import { Tool } from '..';

export interface TextToSpeechInput {
  text: string;
  reqId: string;
  voice: string;
  emotion?: string;
  speedRatio?: number;
}

export interface TextToSpeechOutput {
  voice: string;
  filePath: string;
}

@tool(ToolIds.TEXT_TO_SPEECH)
export default class TextToSpeechTool extends Tool<
  TextToSpeechInput,
  TextToSpeechOutput
> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  private readonly ttsDir: string;

  constructor() {
    super();
    this.ttsDir = path.join(process.cwd(), 'upload', 'tts');
  }

  private async ensureDirectoryExists(): Promise<void> {
    try {
      await fs.access(this.ttsDir);
    } catch {
      await fs.mkdir(this.ttsDir, { recursive: true });
      this.logger.info(`Created TTS directory: ${this.ttsDir}`);
    }
  }

  async *call(
    @input() params: TextToSpeechInput,
    signal?: AbortSignal,
  ): AsyncGenerator<ToolEvent<TextToSpeechOutput>, TextToSpeechOutput, void> {
    signal?.throwIfAborted();

    const { text, reqId, voice, emotion, speedRatio } = params;

    const apiBase = process.env.OPENAI_API_BASE;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiBase || !apiKey) {
      throw new Error('OPENAI_API_BASE and OPENAI_API_KEY must be configured');
    }

    await this.ensureDirectoryExists();

    this.logger.info(
      `Processing TTS request: ${reqId}, voice: ${voice}, text_length: ${text.length}`,
    );

    const url = `${apiBase.replace(/\/v1$/, '')}/doubao/tts_hd`;
    const payload = {
      audio: {
        voice_type: voice,
        emotion: emotion || 'hate',
        encoding: 'mp3',
        speed_ratio: speedRatio || 1.2,
      },
      request: {
        reqid: reqId,
        text: text,
        operation: 'query',
      },
    };

    this.logger.debug(`TTS API request url: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    signal?.addEventListener('abort', () => {
      controller.abort(signal.reason);
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    if (!response.ok) {
      const responseText = await response.text();
      this.logger.error(
        `TTS API failed - Status: ${response.status}, Response: ${responseText.slice(0, 500)}`,
      );
      throw new Error(
        `TTS API request failed with status ${response.status}: ${responseText.slice(0, 200)}`,
      );
    }

    const data = await response.json();

    if (data.error) {
      const errorMsg =
        data.error.message_cn || data.error.message || 'Unknown error';
      this.logger.error(`TTS API error for ${reqId}: ${errorMsg}`);
      throw new Error(`TTS API error: ${errorMsg}`);
    }

    if (data.code !== 3000) {
      const errorMsg = data.message || `Unknown error, code: ${data.code}`;
      this.logger.error(`TTS API failed for ${reqId}: ${errorMsg}`);
      throw new Error(`TTS API failed: ${errorMsg}`);
    }

    if (!data.data) {
      this.logger.error(`No audio data in response for ${reqId}`);
      throw new Error('No audio data received from TTS API');
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = Buffer.from(data.data, 'base64');
      if (audioBuffer.length === 0) {
        throw new Error('Decoded audio data is empty');
      }
    } catch (error) {
      this.logger.error(
        `Failed to decode base64 audio data for ${reqId}: ${error}`,
      );
      throw new Error(`Failed to decode audio data: ${error}`);
    }

    const filename = `${reqId}.mp3`;
    const filePath = path.join(this.ttsDir, filename);

    try {
      await fs.writeFile(filePath, audioBuffer);

      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        throw new Error('Failed to write audio file or file is empty');
      }

      this.logger.info(
        `TTS completed successfully: ${reqId}, file: ${filePath}, size: ${audioBuffer.length} bytes`,
      );

      const output: TextToSpeechOutput = {
        voice,
        filePath: `tts/${filename}`,
      };

      yield { type: 'result', result: output };
      return output;
    } catch (error) {
      this.logger.error(`Failed to write MP3 file for ${reqId}: ${error}`);
      throw new Error(`Failed to save audio file: ${error}`);
    }
  }
}
