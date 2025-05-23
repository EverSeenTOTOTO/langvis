import { createClient, RedisClientType } from 'redis';

export const redisInjectToken = Symbol('redis');

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const redis: RedisClientType<any> = createClient({
  url: `redis://${import.meta.env.REDIS_HOST}:${import.meta.env.REDIS_PORT}`,
}).on('error', err => console.log('Redis Client Error', err));

if (!redis.isReady) {
  await redis.connect();
}

export default redis;
