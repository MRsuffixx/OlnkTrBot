import { injectable, inject } from 'tsyringe';
import { ConfigService } from '../config/ConfigService.js';
import { LoggerService } from './LoggerService.js';
import { CacheService } from './CacheService.js';
import { RateLimitError } from '../errors/index.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  limit: number;
  reset: number;
}

@injectable()
export class RateLimiterService {
  private readonly logger: ReturnType<LoggerService['child']>;
  private readonly inMemoryBuckets = new Map<string, { count: number; resetTime: number }>();

  constructor(
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
    @inject(CacheService) private readonly cacheService: CacheService,
  ) {
    this.logger = this.loggerService.child('RateLimiterService');
  }

  public async checkAndConsume(
    userId: string,
    guildId: string | null,
    commandName: string,
  ): Promise<void> {
    try {
      // Check global bucket first
      await this.checkBucket('global', 'global', 'global');

      // Check guild bucket if guildId is provided
      if (guildId) {
        await this.checkBucket('guild', guildId, 'guild');
      }

      // Check user bucket
      await this.checkBucket('user', userId, 'user');
    } catch (error) {
      if (error instanceof RateLimitError) {
        this.logger.warn('Rate limit hit', {
          userId,
          guildId,
          commandName,
          retryAfter: error.retryAfter,
          scope: error.context.scope as string,
        });

        // TODO: Call AuditService.log with RATE_LIMIT_HIT action
        // This will be implemented after AuditService is created
      }
      throw error;
    }
  }

  private async checkBucket(
    scope: 'global' | 'guild' | 'user',
    identifier: string,
    bucketType: string,
  ): Promise<void> {
    const max = this.getLimit(scope);
    const windowSeconds = this.getWindowSeconds(scope);
    const key = this.getKey(scope, identifier);

    try {
      // Try Redis first
      const result = await this.checkRedisBucket(key, max, windowSeconds);
      if (!result.allowed) {
        throw new RateLimitError(
          `Rate limit exceeded for ${scope} scope`,
          result.retryAfter,
          { scope, identifier, bucketType },
        );
      }
    } catch (redisError) {
      // If Redis is unavailable, fall back to in-memory
      this.logger.warn('Redis unavailable, falling back to in-memory rate limiting', {
        error: redisError instanceof Error ? redisError.message : String(redisError),
        scope,
      });

      const result = this.checkInMemoryBucket(key, max, windowSeconds);
      if (!result.allowed) {
        throw new RateLimitError(
          `Rate limit exceeded for ${scope} scope (in-memory fallback)`,
          result.retryAfter,
          { scope, identifier, bucketType, fallback: true },
        );
      }
    }
  }

  private async checkRedisBucket(
    key: string,
    max: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const reset = now + windowSeconds;

    const redisClient = this.cacheService.getRedisClient();
    if (!redisClient) {
      throw new Error('Redis client not available');
    }

    // Use Redis pipeline for atomic operations
    const pipeline = redisClient.pipeline();

    // Increment the counter
    pipeline.incr(key);
    // Set expiry on first increment
    pipeline.expire(key, windowSeconds, 'NX');
    // Get TTL to calculate retryAfter
    pipeline.ttl(key);

    const results = await pipeline.exec();
    
    if (!results || results.length < 3) {
      throw new Error('Redis pipeline execution failed');
    }

    const count = results[0][1] as number;
    const ttl = results[2][1] as number;

    const remaining = Math.max(0, max - count);
    const retryAfter = ttl > 0 ? ttl : 0;

    return {
      allowed: count <= max,
      remaining,
      retryAfter,
      limit: max,
      reset: now + ttl,
    };
  }

  private checkInMemoryBucket(
    key: string,
    max: number,
    windowSeconds: number,
  ): RateLimitResult {
    const now = Date.now();
    const bucket = this.inMemoryBuckets.get(key);

    if (!bucket || bucket.resetTime <= now) {
      // Create new bucket
      const newBucket = {
        count: 1,
        resetTime: now + windowSeconds * 1000,
      };
      this.inMemoryBuckets.set(key, newBucket);

      // Clean up old buckets periodically
      this.cleanupInMemoryBuckets();

      return {
        allowed: true,
        remaining: max - 1,
        retryAfter: 0,
        limit: max,
        reset: newBucket.resetTime,
      };
    }

    // Existing bucket
    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetTime - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfter,
        limit: max,
        reset: bucket.resetTime,
      };
    }

    // Increment count
    bucket.count++;
    this.inMemoryBuckets.set(key, bucket);

    return {
      allowed: true,
      remaining: max - bucket.count,
      retryAfter: 0,
      limit: max,
      reset: bucket.resetTime,
    };
  }

  private cleanupInMemoryBuckets(): void {
    const now = Date.now();
    for (const [key, bucket] of this.inMemoryBuckets.entries()) {
      if (bucket.resetTime <= now) {
        this.inMemoryBuckets.delete(key);
      }
    }
  }

  private getKey(scope: 'global' | 'guild' | 'user', identifier: string): string {
    switch (scope) {
      case 'global':
        return 'rl:global';
      case 'guild':
        return `rl:guild:${identifier}`;
      case 'user':
        return `rl:user:${identifier}`;
      default:
        throw new Error(`Unknown rate limit scope: ${scope}`);
    }
  }

  private getLimit(scope: 'global' | 'guild' | 'user'): number {
    switch (scope) {
      case 'global':
        return this.configService.rateLimitGlobalMax;
      case 'guild':
        return this.configService.rateLimitGuildMax;
      case 'user':
        return this.configService.rateLimitUserMax;
      default:
        throw new Error(`Unknown rate limit scope: ${scope}`);
    }
  }

  private getWindowSeconds(scope: 'global' | 'guild' | 'user'): number {
    switch (scope) {
      case 'global':
        return this.configService.rateLimitGlobalWindowSeconds;
      case 'guild':
        return this.configService.rateLimitGuildWindowSeconds;
      case 'user':
        return this.configService.rateLimitUserWindowSeconds;
      default:
        throw new Error(`Unknown rate limit scope: ${scope}`);
    }
  }

  public async resetBucket(
    scope: 'global' | 'guild' | 'user',
    identifier: string,
  ): Promise<void> {
    const key = this.getKey(scope, identifier);
    
    try {
      await this.cacheService.delete(key);
    } catch (error) {
      this.logger.warn('Failed to reset Redis rate limit bucket', {
        error: error instanceof Error ? error.message : String(error),
        scope,
        identifier,
      });
    }

    // Also clear in-memory bucket
    this.inMemoryBuckets.delete(key);
  }
}