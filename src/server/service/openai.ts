import OpenAI from 'openai';
import { logger } from '../middleware/logger';
import { container } from 'tsyringe';
import { InjectTokens } from '../utils';

export { OpenAI };

const openai = new OpenAI({
  baseURL: process.env.OPENAI_API_BASE,
  apiKey: process.env.OPENAI_API_KEY,
  logger,
});

container.register<typeof openai>(InjectTokens.OPENAI, { useValue: openai });

export default openai;
