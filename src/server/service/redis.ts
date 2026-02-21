import { createClient, RedisClientType } from 'redis';
import logger from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const redis: RedisClientType<any> = createClient({
  url: `redis://${import.meta.env.VITE_REDIS_HOST}:${import.meta.env.VITE_REDIS_PORT}`,
}).on('error', err => logger.error('Redis Client Error', err));

// Separate client for Pub/Sub subscriptions (Redis requirement)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const redisSubscriber: RedisClientType<any> = createClient({
  url: `redis://${import.meta.env.VITE_REDIS_HOST}:${import.meta.env.VITE_REDIS_PORT}`,
}).on('error', err => logger.error('Redis Subscriber Error', err));

export default redis;
export { redisSubscriber };
