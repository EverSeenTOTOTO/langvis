import OpenAI from 'openai';
import { logger } from '../middleware/logger';

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
  logger,
});

export default openai;
