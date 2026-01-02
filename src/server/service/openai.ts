import OpenAI from 'openai';
import logger from '../utils/logger';

export { OpenAI };

export default () => {
  return new OpenAI({
    baseURL: process.env.OPENAI_API_BASE,
    apiKey: process.env.OPENAI_API_KEY,
    logger,
  });
};
