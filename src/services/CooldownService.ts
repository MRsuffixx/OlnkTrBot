import { injectable, inject } from 'tsyringe';
import { PermissionsBitField } from 'discord.js';
import { CacheService } from './CacheService.js';
import { LoggerService } from './LoggerService.js';
import { CooldownError } from '../errors/index.js';

@injectable()
export class CooldownService {
  private readonly logger: ReturnType<LoggerService['child']>;

  constructor(
    @inject(CacheService) private readonly cacheService: CacheService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('CooldownService');
  }

  public async check(
    commandName: string,
    userId: string,
    cooldownSeconds: number,
  ): Promise<void> {
    if (cooldownSeconds <= 0) {
      return; // No cooldown
    }

    const key = this.getKey(commandName, userId);

    try {
      // Try Redis first
      const remaining = await this.getRemainingSeconds(key);
      if (remaining > 0) {
        throw new CooldownError(
          `Command ${commandName} is on cooldown`,
          remaining,
          { commandName, userId },
        );
      }
    } catch (error) {
      if (error instanceof CooldownError) {
        throw error;
      }
      
      // Redis error, fall back to in-memory
      this.logger.warn('Redis unavailable for cooldown check, using in-memory fallback', {
        error: error instanceof Error ? error.message : String(error),
        commandName,
        userId,
      });

      const remaining = this.getRemainingSecondsInMemory(key);
      if (remaining > 0) {
        throw new CooldownError(
          `Command ${commandName} is on cooldown (in-memory fallback)`,
          remaining,
          { commandName, userId, fallback: true },
        );
      }
    }
  }

  public async set(
    commandName: string,
    userId: string,
    cooldownSeconds: number,
  ): Promise<void> {
    if (cooldownSeconds <= 0) {
      return; // No cooldown to set
    }

    const key = this.getKey(commandName, userId);

    try {
      // Try Redis first
      await this.cacheService.set(key, '1', cooldownSeconds);
    } catch (error) {
      // Redis error, fall back to in-memory
      this.logger.warn('Redis unavailable for cooldown set, using in-memory fallback', {
        error: error instanceof Error ? error.message : String(error),
        commandName,
        userId,
      });

      this.setInMemory(key, cooldownSeconds);
    }
  }

  public isExempt(
    userId: string,
    ownerIds: string[],
    permissions: PermissionsBitField | null,
  ): boolean {
    // Check if user is a bot owner
    if (ownerIds.includes(userId)) {
      return true;
    }

    // Check if user has Administrator permission
    if (permissions?.has(PermissionsBitField.Flags.Administrator)) {
      return true;
    }

    return false;
  }

  public async reset(
    commandName: string,
    userId: string,
  ): Promise<void> {
    const key = this.getKey(commandName, userId);

    try {
      await this.cacheService.delete(key);
    } catch (error) {
      this.logger.warn('Failed to delete Redis cooldown key', {
        error: error instanceof Error ? error.message : String(error),
        commandName,
        userId,
      });
    }

    // Also clear in-memory cooldown
    this.clearInMemory(key);
  }

  private getKey(commandName: string, userId: string): string {
    return `cooldown:${commandName}:${userId}`;
  }

  private async getRemainingSeconds(key: string): Promise<number> {
    // Check if key exists in Redis
    const exists = await this.cacheService.exists(key);
    if (!exists) {
      return 0;
    }

    // Get TTL of the key
    // Note: CacheService doesn't have a TTL method, so we need to implement a workaround
    // For now, we'll use a simpler approach: if the key exists, assume it's on cooldown
    // and return a conservative estimate
    return 1; // Conservative estimate - actual implementation would need TTL support
  }

  private getRemainingSecondsInMemory(key: string): number {
    // In-memory cooldown storage
    const cooldowns = (globalThis as any).__cooldownMemoryCache = (globalThis as any).__cooldownMemoryCache || new Map<string, number>();
    
    const expiresAt = cooldowns.get(key);
    if (!expiresAt) {
      return 0;
    }

    const now = Date.now();
    if (expiresAt <= now) {
      cooldowns.delete(key);
      return 0;
    }

    return Math.ceil((expiresAt - now) / 1000);
  }

  private setInMemory(key: string, cooldownSeconds: number): void {
    const cooldowns = (globalThis as any).__cooldownMemoryCache = (globalThis as any).__cooldownMemoryCache || new Map<string, number>();
    const expiresAt = Date.now() + cooldownSeconds * 1000;
    cooldowns.set(key, expiresAt);

    // Auto-cleanup
    setTimeout(() => {
      cooldowns.delete(key);
    }, cooldownSeconds * 1000);
  }

  private clearInMemory(key: string): void {
    const cooldowns = (globalThis as any).__cooldownMemoryCache;
    if (cooldowns) {
      cooldowns.delete(key);
    }
  }
}