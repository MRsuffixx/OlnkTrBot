import { injectable, inject } from 'tsyringe';
import { DatabaseService } from './DatabaseService.js';
import { CacheService } from './CacheService.js';
import { LoggerService } from './LoggerService.js';
import { BlacklistError } from '../errors/index.js';

export interface BlacklistEntry {
  id: string;
  type: 'USER' | 'GUILD';
  targetId: string;
  reason: string;
  moderatorId: string;
  expiresAt: Date | null;
  createdAt: Date;
  active: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@injectable()
export class BlacklistService {
  private readonly logger: ReturnType<LoggerService['child']>;
  private readonly cacheTtl = 300; // 5 minutes in seconds

  constructor(
    @inject(DatabaseService) private readonly databaseService: DatabaseService,
    @inject(CacheService) private readonly cacheService: CacheService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('BlacklistService');
  }

  public async isUserBlacklisted(userId: string): Promise<BlacklistEntry | null> {
    const cacheKey = this.getUserCacheKey(userId);
    
    // Check cache first
    const cached = await this.getCachedResult(cacheKey);
    if (cached !== undefined) {
      return cached === 'none' ? null : cached as BlacklistEntry;
    }

    // Query database
    const entry = await this.databaseService.client.blacklistEntry.findFirst({
      where: {
        type: 'USER',
        targetId: userId,
        active: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    // Cache the result
    await this.cacheResult(cacheKey, entry);

    return entry as BlacklistEntry | null;
  }

  public async isGuildBlacklisted(guildId: string): Promise<boolean> {
    const cacheKey = this.getGuildCacheKey(guildId);
    
    // Check cache first
    const cached = await this.getCachedResult(cacheKey);
    if (cached !== undefined) {
      return cached === 'none' ? false : true;
    }

    // Query database
    const entry = await this.databaseService.client.blacklistEntry.findFirst({
      where: {
        type: 'GUILD',
        targetId: guildId,
        active: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    const isBlacklisted = !!entry;
    
    // Cache the result
    await this.cacheResult(cacheKey, isBlacklisted ? entry : 'none');

    return isBlacklisted;
  }

  public async addUser(
    userId: string,
    reason: string,
    moderatorId: string,
    expiresAt?: Date,
  ): Promise<BlacklistEntry> {
    const prisma = this.databaseService.client;

    // Check if already blacklisted
    const existing = await prisma.blacklistEntry.findFirst({
      where: {
        type: 'USER',
        targetId: userId,
        active: true,
      },
    });

    if (existing) {
      // Update existing entry
      const updated = await prisma.blacklistEntry.update({
        where: { id: existing.id },
        data: {
          reason,
          moderatorId,
          expiresAt,
          active: true,
        },
      });

      // Invalidate cache
      await this.invalidateUserCache(userId);

      this.logger.info('Updated user blacklist entry', {
        userId,
        moderatorId,
        reason,
        expiresAt,
      });

      return updated as BlacklistEntry;
    }

    // Create new entry
    const entry = await prisma.blacklistEntry.create({
      data: {
        type: 'USER',
        targetId: userId,
        reason,
        moderatorId,
        expiresAt,
        active: true,
      },
    });

    // Invalidate cache
    await this.invalidateUserCache(userId);

    this.logger.info('Added user to blacklist', {
      userId,
      moderatorId,
      reason,
      expiresAt,
    });

    return entry as BlacklistEntry;
  }

  public async removeUser(userId: string): Promise<void> {
    const prisma = this.databaseService.client;

    // Deactivate all active entries for this user
    await prisma.blacklistEntry.updateMany({
      where: {
        type: 'USER',
        targetId: userId,
        active: true,
      },
      data: {
        active: false,
      },
    });

    // Invalidate cache
    await this.invalidateUserCache(userId);

    this.logger.info('Removed user from blacklist', { userId });
  }

  public async addGuild(
    guildId: string,
    reason: string,
    moderatorId: string,
  ): Promise<BlacklistEntry> {
    const prisma = this.databaseService.client;

    // Check if already blacklisted
    const existing = await prisma.blacklistEntry.findFirst({
      where: {
        type: 'GUILD',
        targetId: guildId,
        active: true,
      },
    });

    if (existing) {
      // Update existing entry
      const updated = await prisma.blacklistEntry.update({
        where: { id: existing.id },
        data: {
          reason,
          moderatorId,
          active: true,
      },
      });

      // Invalidate cache
      await this.invalidateGuildCache(guildId);

      this.logger.info('Updated guild blacklist entry', {
        guildId,
        moderatorId,
        reason,
      });

      return updated as BlacklistEntry;
    }

    // Create new entry
    const entry = await prisma.blacklistEntry.create({
      data: {
        type: 'GUILD',
        targetId: guildId,
        reason,
        moderatorId,
        active: true,
      },
    });

    // Invalidate cache
    await this.invalidateGuildCache(guildId);

    this.logger.info('Added guild to blacklist', {
      guildId,
      moderatorId,
      reason,
    });

    return entry as BlacklistEntry;
  }

  public async removeGuild(guildId: string): Promise<void> {
    const prisma = this.databaseService.client;

    // Deactivate all active entries for this guild
    await prisma.blacklistEntry.updateMany({
      where: {
        type: 'GUILD',
        targetId: guildId,
        active: true,
      },
      data: {
        active: false,
      },
    });

    // Invalidate cache
    await this.invalidateGuildCache(guildId);

    this.logger.info('Removed guild from blacklist', { guildId });
  }

  public async listUsers(
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<BlacklistEntry>> {
    const prisma = this.databaseService.client;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      prisma.blacklistEntry.findMany({
        where: {
          type: 'USER',
          active: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.blacklistEntry.count({
        where: {
          type: 'USER',
          active: true,
        },
      }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: items as BlacklistEntry[],
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public async listGuilds(
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedResult<BlacklistEntry>> {
    const prisma = this.databaseService.client;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      prisma.blacklistEntry.findMany({
        where: {
          type: 'GUILD',
          active: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.blacklistEntry.count({
        where: {
          type: 'GUILD',
          active: true,
        },
      }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: items as BlacklistEntry[],
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public async getBlacklistEntry(
    type: 'USER' | 'GUILD',
    targetId: string,
  ): Promise<BlacklistEntry | null> {
    const prisma = this.databaseService.client;

    const entry = await prisma.blacklistEntry.findFirst({
      where: {
        type,
        targetId,
        active: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    return entry as BlacklistEntry | null;
  }

  private getUserCacheKey(userId: string): string {
    return `blacklist:user:${userId}`;
  }

  private getGuildCacheKey(guildId: string): string {
    return `blacklist:guild:${guildId}`;
  }

  private async getCachedResult(cacheKey: string): Promise<unknown> {
    try {
      const cached = await this.cacheService.get<string | BlacklistEntry>(cacheKey);
      return cached;
    } catch (error) {
      this.logger.warn('Failed to read from cache', {
        error: error instanceof Error ? error.message : String(error),
        cacheKey,
      });
      return undefined;
    }
  }

  private async cacheResult(cacheKey: string, value: unknown): Promise<void> {
    try {
      if (value === null || value === 'none') {
        // Cache null results as 'none' sentinel value
        await this.cacheService.set(cacheKey, 'none', this.cacheTtl);
      } else {
        await this.cacheService.set(cacheKey, value, this.cacheTtl);
      }
    } catch (error) {
      this.logger.warn('Failed to write to cache', {
        error: error instanceof Error ? error.message : String(error),
        cacheKey,
      });
    }
  }

  private async invalidateUserCache(userId: string): Promise<void> {
    const cacheKey = this.getUserCacheKey(userId);
    try {
      await this.cacheService.delete(cacheKey);
    } catch (error) {
      this.logger.warn('Failed to invalidate user cache', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  private async invalidateGuildCache(guildId: string): Promise<void> {
    const cacheKey = this.getGuildCacheKey(guildId);
    try {
      await this.cacheService.delete(cacheKey);
    } catch (error) {
      this.logger.warn('Failed to invalidate guild cache', {
        error: error instanceof Error ? error.message : String(error),
        guildId,
      });
    }
  }
}