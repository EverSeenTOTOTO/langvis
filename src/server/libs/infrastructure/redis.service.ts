import { createClient, RedisClientType } from 'redis';
import { service } from '@/server/decorator/service';
import {
  lifecycleHook,
  type LifecycleHook,
} from '@/server/decorator/lifecycle';
import Logger from '@/server/utils/logger';

@service()
@lifecycleHook
export class RedisService implements LifecycleHook {
  private redis: RedisClientType;
  private redisSubscriber: RedisClientType;
  private connected = false;

  private readonly logger = Logger.child({ source: 'RedisService' });

  constructor() {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.redis = createClient({
      url: `redis://${import.meta.env.VITE_REDIS_HOST}:${import.meta.env.VITE_REDIS_PORT}`,
    }).on('error', err => this.logger.error('Redis Client Error', err));

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    this.redisSubscriber = createClient({
      url: `redis://${import.meta.env.VITE_REDIS_HOST}:${import.meta.env.VITE_REDIS_PORT}`,
    }).on('error', err => this.logger.error('Redis Subscriber Error', err));

    this.connect().catch(e => {
      this.logger.error('Redis Connection Error', e);
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await this.redis.connect();
    this.logger.info('Redis client connected.');

    await this.redisSubscriber.connect();
    this.logger.info('Redis subscriber connected.');

    this.connected = true;
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.set(key, serialized, { EX: ttlSeconds });
    } else {
      await this.redis.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', {
      NX: true,
      EX: ttlSeconds,
    });
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async publish(channel: string, message: unknown): Promise<void> {
    const serialized =
      typeof message === 'string' ? message : JSON.stringify(message);
    await this.redis.publish(channel, serialized);
  }

  async subscribe(
    channel: string,
    handler: (data: unknown) => void,
  ): Promise<void> {
    await this.redisSubscriber.subscribe(channel, raw => {
      try {
        const data = JSON.parse(raw);
        handler(data);
      } catch {
        handler(raw);
      }
    });
  }

  get client(): RedisClientType {
    return this.redis;
  }

  get subscriber(): RedisClientType {
    return this.redisSubscriber;
  }

  async onShutdown(): Promise<void> {
    if (this.connected) {
      await this.redis.quit();
      await this.redisSubscriber.quit();
      this.connected = false;
      this.logger.info('Redis connections closed');
    }
  }
}
