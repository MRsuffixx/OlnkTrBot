import { injectable, inject } from 'tsyringe';
import { DatabaseService } from './DatabaseService.js';
import { CacheService } from './CacheService.js';
import { LoggerService } from './LoggerService.js';
import { AuditService } from './AuditService.js';
import { BADGES, type Badge } from '../modules/profile/badges.js';

export interface LevelUpResult {
  newLevel: number;
  oldLevel: number;
  userId: string;
  guildId: string;
}

export interface FullProfile {
  id: string;
  discordId: string;
  username: string;
  discriminator: string;
  avatarHash: string | null;
  preferredLocale: string | null;
  xp: number;
  level: number;
  totalCommandsUsed: number;
  reputation: number;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
  isBanned: boolean;
  banReason: string | null;
  badges: Array<{
    id: string;
    userId: string;
    badgeId: string;
    awardedAt: Date;
    awardedBy: string | null;
  }>;
  guildStats: Array<{
    id: string;
    userId: string;
    guildId: string;
    guildXp: number;
    guildLevel: number;
    guildJoinedAt: Date;
    messageCount: number;
    commandCount: number;
    lastActiveAt: Date;
  }>;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  guildXp: number;
  guildLevel: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@injectable()
export class ProfileService {
  private readonly logger: ReturnType<LoggerService['child']>;
  private readonly cacheTtl = 300; // 5 minutes in seconds

  constructor(
    @inject(DatabaseService) private readonly databaseService: DatabaseService,
    @inject(CacheService) private readonly cacheService: CacheService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {
    this.logger = this.loggerService.child('ProfileService');
  }

  public async getOrCreate(userId: string, username: string): Promise<FullProfile> {
    const cacheKey = this.getProfileCacheKey(userId);
    
    // Check cache first
    const cached = await this.getCachedProfile(cacheKey);
    if (cached) {
      return cached;
    }

    const prisma = this.databaseService.client;

    // Upsert user profile
    const profile = await prisma.userProfile.upsert({
      where: { discordId: userId },
      update: {
        username,
        lastSeenAt: new Date(),
      },
      create: {
        discordId: userId,
        username,
        discriminator: '0', // Legacy field, keep for compatibility
        xp: 0,
        level: 0,
        totalCommandsUsed: 0,
        reputation: 0,
        lastSeenAt: new Date(),
        isBanned: false,
      },
      include: {
        badges: true,
        guildMemberships: true,
      },
    });

    const fullProfile = this.toFullProfile(profile);
    
    // Cache the result
    await this.cacheProfile(cacheKey, fullProfile);

    return fullProfile;
  }

  public async updateLastSeen(userId: string): Promise<void> {
    // Fire and forget - don't await
    this.updateLastSeenAsync(userId).catch((error) => {
      this.logger.warn('Failed to update last seen', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async updateLastSeenAsync(userId: string): Promise<void> {
    const prisma = this.databaseService.client;

    await prisma.userProfile.update({
      where: { discordId: userId },
      data: {
        lastSeenAt: new Date(),
        totalCommandsUsed: { increment: 1 },
      },
    });

    // Invalidate cache
    await this.invalidateProfileCache(userId);
  }

  public async addXp(
    userId: string,
    guildId: string,
    amount: number,
  ): Promise<LevelUpResult | null> {
    const prisma = this.databaseService.client;

    // Start a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Update global XP
      const updatedProfile = await tx.userProfile.update({
        where: { discordId: userId },
        data: { xp: { increment: amount } },
      });

      // Update or create guild membership
      await tx.guildMembership.upsert({
        where: {
          userId_guildId: {
            userId,
            guildId,
          },
        },
        update: {
          guildXp: { increment: amount },
          lastActiveAt: new Date(),
        },
        create: {
          userId,
          guildId,
          guildXp: amount,
          guildLevel: 0,
          guildJoinedAt: new Date(),
          messageCount: 0,
          commandCount: 0,
          lastActiveAt: new Date(),
        },
      });

      return updatedProfile;
    });

    // Calculate new level
    const oldLevel = this.calculateLevel(result.xp - amount);
    const newLevel = this.calculateLevel(result.xp);

    if (newLevel > oldLevel) {
      const levelUpResult: LevelUpResult = {
        newLevel,
        oldLevel,
        userId,
        guildId,
      };

      // Trigger level-up side effects asynchronously
      this.handleLevelUp(levelUpResult).catch((error) => {
        this.logger.error('Failed to handle level up', {
          userId,
          guildId,
          newLevel,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return levelUpResult;
    }

    return null;
  }

  private async handleLevelUp(result: LevelUpResult): Promise<void> {
    // Send DM congratulating the user
    // TODO: Implement DM sending when we have access to Discord client
    // For now, just log it
    this.logger.info('User leveled up', {
      userId: result.userId,
      guildId: result.guildId,
      oldLevel: result.oldLevel,
      newLevel: result.newLevel,
    });

    // Check and award level-based badges
    await this.checkAndAwardLevelBadges(result.userId, result.newLevel);

    // Log to audit service
    await this.auditService.log({
      guildId: result.guildId,
      userId: result.userId,
      action: 'LEVEL_UP',
      details: {
        oldLevel: result.oldLevel,
        newLevel: result.newLevel,
      },
    });
  }

  public async getProfile(userId: string): Promise<FullProfile | null> {
    const cacheKey = this.getProfileCacheKey(userId);
    
    // Check cache first
    const cached = await this.getCachedProfile(cacheKey);
    if (cached) {
      return cached;
    }

    const prisma = this.databaseService.client;

    const profile = await prisma.userProfile.findUnique({
      where: { discordId: userId },
      include: {
        badges: true,
        guildMemberships: true,
      },
    });

    if (!profile) {
      return null;
    }

    const fullProfile = this.toFullProfile(profile);
    
    // Cache the result
    await this.cacheProfile(cacheKey, fullProfile);

    return fullProfile;
  }

  public async getLeaderboard(
    guildId: string,
    page: number = 1,
    pageSize: number = 10,
  ): Promise<PaginatedResult<LeaderboardEntry>> {
    const prisma = this.databaseService.client;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      prisma.guildMembership.findMany({
        where: { guildId },
        include: {
          user: true,
        },
        orderBy: { guildXp: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.guildMembership.count({
        where: { guildId },
      }),
    ]);

    const leaderboardItems: LeaderboardEntry[] = items.map((item, index) => ({
      rank: skip + index + 1,
      userId: item.userId,
      username: item.user.username,
      guildXp: item.guildXp,
      guildLevel: this.calculateLevel(item.guildXp),
    }));

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: leaderboardItems,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public async awardBadge(
    userId: string,
    badgeId: string,
    awardedBy?: string,
  ): Promise<boolean> {
    const badge = BADGES[badgeId];
    if (!badge) {
      this.logger.warn('Attempted to award non-existent badge', {
        userId,
        badgeId,
      });
      return false;
    }

    const prisma = this.databaseService.client;

    try {
      // Try to create the badge entry
      await prisma.userBadge.create({
        data: {
          userId,
          badgeId,
          awardedBy,
          awardedAt: new Date(),
        },
      });

      // Invalidate profile cache
      await this.invalidateProfileCache(userId);

      this.logger.info('Awarded badge to user', {
        userId,
        badgeId,
        awardedBy,
      });

      return true;
    } catch (error) {
      // If the error is a unique constraint violation, the user already has the badge
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        return false;
      }
      throw error;
    }
  }

  public async checkAndAwardBadges(userId: string, profile: FullProfile): Promise<void> {
    // Check all badge conditions
    const badgesToAward: string[] = [];

    // Check level badges
    if (profile.level >= 5 && !profile.badges.some((b) => b.badgeId === 'level_5')) {
      badgesToAward.push('level_5');
    }
    if (profile.level >= 10 && !profile.badges.some((b) => b.badgeId === 'level_10')) {
      badgesToAward.push('level_10');
    }
    if (profile.level >= 25 && !profile.badges.some((b) => b.badgeId === 'level_25')) {
      badgesToAward.push('level_25');
    }

    // Check command count badges
    if (profile.totalCommandsUsed >= 100 && !profile.badges.some((b) => b.badgeId === 'command_100')) {
      badgesToAward.push('command_100');
    }
    if (profile.totalCommandsUsed >= 1000 && !profile.badges.some((b) => b.badgeId === 'command_1000')) {
      badgesToAward.push('command_1000');
    }

    // Check early adopter badge (account created before 2024-01-01)
    const earlyAdopterCutoff = new Date('2024-01-01T00:00:00.000Z');
    if (profile.createdAt < earlyAdopterCutoff && !profile.badges.some((b) => b.badgeId === 'early_adopter')) {
      badgesToAward.push('early_adopter');
    }

    // Award all qualifying badges
    for (const badgeId of badgesToAward) {
      await this.awardBadge(userId, badgeId, undefined);
    }
  }

  private async checkAndAwardLevelBadges(userId: string, level: number): Promise<void> {
    const badgesToAward: string[] = [];

    if (level >= 5) {
      badgesToAward.push('level_5');
    }
    if (level >= 10) {
      badgesToAward.push('level_10');
    }
    if (level >= 25) {
      badgesToAward.push('level_25');
    }

    for (const badgeId of badgesToAward) {
      await this.awardBadge(userId, badgeId, undefined);
    }
  }

  public async updatePreferredLocale(userId: string, locale: string): Promise<void> {
    const prisma = this.databaseService.client;

    await prisma.userProfile.update({
      where: { discordId: userId },
      data: { preferredLocale: locale },
    });

    // Invalidate cache
    await this.invalidateProfileCache(userId);
  }

  private calculateLevel(xp: number): number {
    return Math.floor(0.1 * Math.sqrt(xp));
  }

  private getProfileCacheKey(userId: string): string {
    return `profile:${userId}`;
  }

  private async getCachedProfile(cacheKey: string): Promise<FullProfile | null> {
    try {
      const cached = await this.cacheService.get<FullProfile>(cacheKey);
      return cached;
    } catch (error) {
      this.logger.warn('Failed to read profile from cache', {
        cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async cacheProfile(cacheKey: string, profile: FullProfile): Promise<void> {
    try {
      await this.cacheService.set(cacheKey, profile, this.cacheTtl);
    } catch (error) {
      this.logger.warn('Failed to cache profile', {
        cacheKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async invalidateProfileCache(userId: string): Promise<void> {
    const cacheKey = this.getProfileCacheKey(userId);
    try {
      await this.cacheService.delete(cacheKey);
    } catch (error) {
      this.logger.warn('Failed to invalidate profile cache', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toFullProfile(profile: any): FullProfile {
    return {
      id: profile.id,
      discordId: profile.discordId,
      username: profile.username,
      discriminator: profile.discriminator,
      avatarHash: profile.avatarHash,
      preferredLocale: profile.preferredLocale,
      xp: profile.xp,
      level: profile.level,
      totalCommandsUsed: profile.totalCommandsUsed,
      reputation: profile.reputation,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      lastSeenAt: profile.lastSeenAt,
      isBanned: profile.isBanned,
      banReason: profile.banReason,
      badges: profile.badges,
      guildStats: profile.guildMemberships,
    };
  }
}