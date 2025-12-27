import OpenAI from 'openai';
import logger from '../service/logger';

export { OpenAI };

const openai = new OpenAI({
  baseURL: process.env.OPENAI_API_BASE,
  apiKey: process.env.OPENAI_API_KEY,
  logger,
});

export default openai;
