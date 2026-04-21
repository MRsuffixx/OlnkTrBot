import { injectable, inject } from 'tsyringe';
import IORedis, { type RedisOptions, type Redis as IRedis } from 'ioredis';
import { ConfigService } from '../config/ConfigService.js';
import { LoggerService } from './LoggerService.js';
import { ExternalServiceError } from '../errors/index.js';

@injectable()
export class CacheService {
  private readonly redisClient: IRedis | null = null;
  private readonly inMemoryCache = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly logger: ReturnType<LoggerService['child']>;
  private readonly keyPrefix: string;

  constructor(
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('CacheService');
    this.keyPrefix = `bot:${this.configService.clientId}:`;

    try {
      const options: RedisOptions = {
        retryStrategy: (times) => {
          if (times >= 5) {
            this.logger.warn('Redis connection failed after 5 attempts, falling back to in-memory cache');
            return null; // Stop retrying
          }
          return Math.min(times * 1000, 10000);
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      };

      this.redisClient = new IORedis(this.configService.redisUrl, options);

      this.redisClient.on('connect', () => {
        this.logger.info('Redis client connected');
      });

      this.redisClient.on('error', (error) => {
        this.logger.error('Redis client error', { error: error.message });
      });

      this.redisClient.on('close', () => {
        this.logger.warn('Redis connection closed');
      });

      this.logger.info('Redis client initialized');
    } catch (error) {
      this.logger.error('Failed to create Redis client, falling back to in-memory cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.redisClient = null;
    }
  }

  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  // ========== Basic Operations ==========

  public async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);

    if (this.redisClient) {
      try {
        const value = await this.redisClient.get(fullKey);
        if (value === null) {
          return null;
        }
        return JSON.parse(value) as T;
      } catch (error) {
        this.logger.warn('Redis get failed, checking in-memory cache', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to in-memory cache
      }
    }

    // In-memory fallback
    const cached = this.inMemoryCache.get(fullKey);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt && Date.now() > cached.expiresAt) {
      this.inMemoryCache.delete(fullKey);
      return null;
    }

    return cached.value as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const serialized = JSON.stringify(value);

    if (this.redisClient) {
      try {
        if (ttlSeconds) {
          await this.redisClient.setex(fullKey, ttlSeconds, serialized);
        } else {
          await this.redisClient.set(fullKey, serialized);
        }
        return;
      } catch (error) {
        this.logger.warn('Redis set failed, using in-memory cache', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // In-memory fallback
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0;
    this.inMemoryCache.set(fullKey, { value, expiresAt });

    // Auto-cleanup for expired entries (for memory management)
    if (ttlSeconds) {
      setTimeout(() => {
        this.inMemoryCache.delete(fullKey);
      }, ttlSeconds * 1000);
    }
  }

  public async delete(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);

    if (this.redisClient) {
      try {
        await this.redisClient.del(fullKey);
      } catch (error) {
        this.logger.warn('Redis delete failed, deleting from in-memory cache', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.inMemoryCache.delete(fullKey);
  }

  public async exists(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);

    if (this.redisClient) {
      try {
        const result = await this.redisClient.exists(fullKey);
        return result === 1;
      } catch (error) {
        this.logger.warn('Redis exists failed, checking in-memory cache', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const cached = this.inMemoryCache.get(fullKey);
    if (!cached) {
      return false;
    }

    if (cached.expiresAt && Date.now() > cached.expiresAt) {
      this.inMemoryCache.delete(fullKey);
      return false;
    }

    return true;
  }

  public async expire(key: string, ttlSeconds: number): Promise<void> {
    const fullKey = this.getFullKey(key);

    if (this.redisClient) {
      try {
        await this.redisClient.expire(fullKey, ttlSeconds);
      } catch (error) {
        this.logger.warn('Redis expire failed, updating in-memory cache', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const cached = this.inMemoryCache.get(fullKey);
    if (cached) {
      cached.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }

  // ========== Advanced Operations ==========

  public async increment(key: string, by = 1): Promise<number> {
    const fullKey = this.getFullKey(key);

    if (this.redisClient) {
      try {
        return await this.redisClient.incrby(fullKey, by);
      } catch (error) {
        this.logger.warn('Redis increment failed, falling back to in-memory', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // In-memory fallback
    const current = this.inMemoryCache.get(fullKey);
    const numericValue = current ? Number(current.value) : 0;
    const newValue = numericValue + by;
    
    const expiresAt = current?.expiresAt || 0;
    this.inMemoryCache.set(fullKey, { value: newValue, expiresAt });
    
    return newValue;
  }

  public async getOrSet<T>(key: string, fetchFn: () => Promise<T>, ttlSeconds?: number): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  public async invalidate(pattern: string): Promise<void> {
    const fullPattern = this.getFullKey(pattern);

    if (this.redisClient) {
      try {
        const keys = await this.redisClient.keys(fullPattern);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      } catch (error) {
        this.logger.warn('Redis invalidate failed, clearing in-memory cache', {
          pattern,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Clear in-memory cache entries matching pattern (simplistic approach)
    for (const key of this.inMemoryCache.keys()) {
      if (key.startsWith(fullPattern)) {
        this.inMemoryCache.delete(key);
      }
    }
  }

  // ========== Health & Connection Management ==========

  public async healthCheck(): Promise<boolean> {
    if (!this.redisClient) {
      // In-memory mode is always healthy
      return true;
    }

    try {
      await this.redisClient.ping();
      return true;
    } catch (error) {
      this.logger.error('Redis health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        this.logger.info('Redis connection closed');
      } catch (error) {
        this.logger.error('Error while disconnecting from Redis', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get the underlying Redis client for advanced operations.
   * Use with caution - prefer using the typed methods of this service.
   */
  public getRedisClient(): IRedis | null {
    return this.redisClient;
  }
}
