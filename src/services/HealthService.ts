import { injectable, inject } from 'tsyringe';
import { ConfigService } from '../config/ConfigService.js';
import { LoggerService } from './LoggerService.js';
import { DatabaseService } from './DatabaseService.js';
import { CacheService } from './CacheService.js';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthResult {
  status: HealthStatus;
  uptime: number;
  timestamp: string;
  services: {
    database: boolean;
    cache: 'connected' | 'degraded' | 'disconnected';
    discord: boolean;
  };
}

export interface MetricsResult {
  commandCount: number;
  guildCount: number;
  cacheHitRatio: number;
  redisStatus: 'connected' | 'degraded' | 'disconnected';
  databaseStatus: 'connected' | 'disconnected';
  uptimeSeconds: number;
}

@injectable()
export class HealthService {
  private readonly logger: ReturnType<LoggerService['child']>;
  private readonly startTime: Date;
  private isDiscordReady: boolean = false;
  private commandCount: number = 0;
  private guildCount: number = 0;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private lastHealthCheck: HealthResult | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
    @inject(DatabaseService) private readonly databaseService: DatabaseService,
    @inject(CacheService) private readonly cacheService: CacheService,
  ) {
    this.logger = this.loggerService.child('HealthService');
    this.startTime = new Date();

    // Start periodic health checks
    this.startHealthCheckInterval();
  }

  private startHealthCheckInterval(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        this.lastHealthCheck = await this.checkHealth();
      } catch (error) {
        this.logger.error('Health check interval failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 30000); // 30 seconds

    // Run initial health check
    this.checkHealth().then((result) => {
      this.lastHealthCheck = result;
    }).catch((error) => {
      this.logger.error('Initial health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  public setDiscordReady(ready: boolean): void {
    this.isDiscordReady = ready;
    this.logger.info(`Discord client ${ready ? 'ready' : 'not ready'}`);
  }

  public setCommandCount(count: number): void {
    this.commandCount = count;
  }

  public setGuildCount(count: number): void {
    this.guildCount = count;
  }

  public recordCacheHit(): void {
    this.cacheHits++;
  }

  public recordCacheMiss(): void {
    this.cacheMisses++;
  }

  public async checkHealth(): Promise<HealthResult> {
    const databaseHealthy = await this.databaseService.healthCheck();
    
    // Check cache health
    let cacheStatus: 'connected' | 'degraded' | 'disconnected' = 'disconnected';
    try {
      const cacheHealthy = await this.cacheService.healthCheck();
      cacheStatus = cacheHealthy ? 'connected' : 'degraded';
    } catch {
      cacheStatus = 'disconnected';
    }

    const discordHealthy = this.isDiscordReady;

    // Determine overall status
    let status: HealthStatus = 'healthy';
    if (!databaseHealthy) {
      status = 'unhealthy'; // Database is critical
    } else if (cacheStatus === 'disconnected' || !discordHealthy) {
      status = 'degraded';
    }

    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);

    const result: HealthResult = {
      status,
      uptime,
      timestamp: new Date().toISOString(),
      services: {
        database: databaseHealthy,
        cache: cacheStatus,
        discord: discordHealthy,
      },
    };

    this.lastHealthCheck = result;
    return result;
  }

  public async checkReadiness(): Promise<boolean> {
    const databaseHealthy = await this.databaseService.healthCheck();
    return databaseHealthy && this.isDiscordReady;
  }

  public async getMetrics(): Promise<MetricsResult> {
    const databaseHealthy = await this.databaseService.healthCheck();
    let cacheStatus: 'connected' | 'degraded' | 'disconnected' = 'disconnected';
    try {
      const cacheHealthy = await this.cacheService.healthCheck();
      cacheStatus = cacheHealthy ? 'connected' : 'degraded';
    } catch {
      cacheStatus = 'disconnected';
    }

    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRatio = totalCacheRequests > 0 
      ? this.cacheHits / totalCacheRequests 
      : 0;

    const uptimeSeconds = Math.floor((Date.now() - this.startTime.getTime()) / 1000);

    return {
      commandCount: this.commandCount,
      guildCount: this.guildCount,
      cacheHitRatio,
      redisStatus: cacheStatus,
      databaseStatus: databaseHealthy ? 'connected' : 'disconnected',
      uptimeSeconds,
    };
  }

  public getCachedHealth(): HealthResult | null {
    return this.lastHealthCheck;
  }

  public async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}