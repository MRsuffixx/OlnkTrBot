#!/usr/bin/env node

import 'reflect-metadata';
import { ContainerRegistry } from './core/container.js';
import { createHealthServer } from './http/server.js';
import { setupGracefulShutdown } from './core/shutdown.js';
import { type Client } from 'discord.js';

/**
 * Main entry point for the Discord bot.
 * Initializes all core services and starts the bot.
 */
async function main(): Promise<void> {
  // Initialize the dependency injection container
  const container = ContainerRegistry.initialize();
  const logger = container.resolve(LoggerService);

  logger.info('Starting Discord bot initialization');

  try {
    // Resolve and initialize all core services
    await ContainerRegistry.resolveAll();

    // At this point, all core services are ready:
    // - ConfigService validated environment variables
    // - LoggerService is configured for the environment
    // - SentryService initialized (or disabled)
    // - DatabaseService connected to PostgreSQL with retry logic
    // - CacheService connected to Redis (or fell back to in-memory)
    // - HealthService started periodic health checks
    // - MaintenanceService initialized (reads from config and cache)

    logger.info('Core infrastructure initialized successfully');

    // Start the health server
    const configService = container.resolve(ConfigService);
    const healthService = container.resolve(HealthService);
    const healthServer = await createHealthServer(healthService, configService, logger);

    // Set up global error handlers
    setupGlobalErrorHandlers(container);

    // TODO: In the next phase, we will:
    // 1. Initialize the Discord ExtendedClient
    // 2. Load command, event, and component handlers
    // 3. Login to Discord
    // 4. Set Discord ready state on HealthService

    logger.info('Bot is ready for Discord client integration');
    logger.info(`Environment: ${configService.nodeEnv}`);
    logger.info(`Health server: http://0.0.0.0:${configService.healthPort}`);

    // For now, keep the process alive
    // In the next phase, we will replace this with actual Discord client lifecycle
    const keepAliveInterval = setInterval(() => {
      // Keep the process alive
    }, 60000);

    // Set up graceful shutdown
    // Note: We don't have a Discord client yet, so we'll pass a dummy client
    const dummyClient = {} as Client;
    setupGracefulShutdown({
      client: dummyClient,
      database: container.resolve(DatabaseService),
      cache: container.resolve(CacheService),
      sentry: container.resolve(SentryService),
      healthServer,
      logger,
    });

    // Clean up interval on shutdown
    process.on('beforeExit', () => {
      clearInterval(keepAliveInterval);
    });

    logger.info('Process is running (Ctrl+C to exit)');

  } catch (error) {
    logger.fatal('Failed to initialize bot', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await gracefulShutdown('initialization_failed');
    process.exit(1);
  }
}

/**
 * Set up global error handlers for unhandled rejections and exceptions.
 */
function setupGlobalErrorHandlers(container: any): void {
  const logger = container.resolve(LoggerService);
  const sentryService = container.resolve(SentryService);

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.stack : String(reason),
      promise: promise.toString(),
    });

    sentryService.captureException(reason, {
      context: 'unhandledRejection',
      promise: promise.toString(),
    });
  });

  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught exception', {
      error: error.message,
      stack: error.stack,
    });

    sentryService.captureException(error, {
      context: 'uncaughtException',
    });

    // Attempt graceful shutdown
    gracefulShutdown('uncaughtException').finally(() => {
      process.exit(1);
    });
  });
}

/**
 * Gracefully shuts down all services.
 * @param reason - The reason for shutdown
 */
async function gracefulShutdown(reason: string): Promise<void> {
  const container = ContainerRegistry.getContainer();
  const logger = container.resolve(LoggerService);

  logger.info(`Graceful shutdown initiated: ${reason}`);

  try {
    await ContainerRegistry.shutdown();
    logger.info('Graceful shutdown completed');
  } catch (error) {
    logger.error('Graceful shutdown failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Import services for type resolution
import { LoggerService } from './services/LoggerService.js';
import { ConfigService } from './config/ConfigService.js';
import { DatabaseService } from './services/DatabaseService.js';
import { CacheService } from './services/CacheService.js';
import { SentryService } from './services/SentryService.js';
import { HealthService } from './services/HealthService.js';

// Only run main if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error during startup:', error);
    process.exit(1);
  });
}