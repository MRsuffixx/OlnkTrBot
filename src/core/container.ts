import 'reflect-metadata';
import { container, type DependencyContainer } from 'tsyringe';

// Core services
import { ConfigService } from '../config/ConfigService.js';
import { LoggerService } from '../services/LoggerService.js';
import { SentryService } from '../services/SentryService.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { CacheService } from '../services/CacheService.js';
import { HealthService } from '../services/HealthService.js';
import { MaintenanceService } from '../services/MaintenanceService.js';

export class ContainerRegistry {
  private static initialized = false;

  public static initialize(): DependencyContainer {
    if (this.initialized) {
      return container;
    }

    // Register core services in the correct dependency order
    // 1. ConfigService - no dependencies, must be first
    container.registerSingleton(ConfigService);

    // 2. LoggerService - depends on ConfigService
    container.registerSingleton(LoggerService);

    // 3. SentryService - depends on ConfigService and LoggerService
    container.registerSingleton(SentryService);

    // 4. DatabaseService - depends on ConfigService and LoggerService
    container.registerSingleton(DatabaseService);

    // 5. CacheService - depends on ConfigService and LoggerService
    container.registerSingleton(CacheService);

    // 6. HealthService - depends on ConfigService, LoggerService, DatabaseService, CacheService
    container.registerSingleton(HealthService);

    // 7. MaintenanceService - depends on ConfigService, LoggerService, CacheService
    container.registerSingleton(MaintenanceService);

    // More services will be registered here as they are created:
    // - RateLimiterService
    // - CooldownService
    // - BlacklistService
    // - AuditService
    // - AntiraidService
    // - I18nService

    this.initialized = true;

    return container;
  }

  public static getContainer(): DependencyContainer {
    if (!this.initialized) {
      return this.initialize();
    }
    return container;
  }

  public static resolve<T>(token: any): T {
    const container = this.getContainer();
    return container.resolve<T>(token);
  }

  public static async resolveAll(): Promise<void> {
    const container = this.getContainer();
    
    // Resolve core services to ensure they are instantiated and initialized
    const configService = container.resolve(ConfigService);
    const loggerService = container.resolve(LoggerService);
    const sentryService = container.resolve(SentryService);
    const databaseService = container.resolve(DatabaseService);
    const cacheService = container.resolve(CacheService);
    const healthService = container.resolve(HealthService);
    const maintenanceService = container.resolve(MaintenanceService);

    // Initialize services that require async setup
    try {
      // Initialize Sentry first (it may throw if DSN missing in production)
      await sentryService.initialize();
    } catch (error) {
      loggerService.fatal('Failed to initialize Sentry', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    try {
      await databaseService.connect();
    } catch (error) {
      loggerService.fatal('Failed to connect to database', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    // Note: CacheService auto-connects, but we can verify health
    const cacheHealthy = await cacheService.healthCheck();
    if (!cacheHealthy) {
      loggerService.warn('Cache service is unhealthy, operating in degraded mode');
    }

    // Initialize maintenance service (reads from config and cache)
    await maintenanceService.initialize();

    loggerService.info('All core services initialized');
  }

  public static async shutdown(): Promise<void> {
    const container = this.getContainer();
    const loggerService = container.resolve(LoggerService);
    const sentryService = container.resolve(SentryService);
    const databaseService = container.resolve(DatabaseService);
    const cacheService = container.resolve(CacheService);
    const healthService = container.resolve(HealthService);

    loggerService.info('Starting graceful shutdown of services');

    // Stop health service interval first
    await healthService.stop();

    const shutdownTasks = [
      cacheService.disconnect().catch((error) => {
        loggerService.warn('Cache service disconnect failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
      databaseService.disconnect().catch((error) => {
        loggerService.warn('Database service disconnect failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
      sentryService.flush().catch((error) => {
        loggerService.warn('Sentry flush failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ];

    await Promise.allSettled(shutdownTasks);
    loggerService.info('All services shut down gracefully');
  }
}