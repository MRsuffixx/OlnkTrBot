import { type Client } from 'discord.js';
import { type FastifyInstance } from 'fastify';
import { type DatabaseService } from '../services/DatabaseService.js';
import { type CacheService } from '../services/CacheService.js';
import { type SentryService } from '../services/SentryService.js';
import { type LoggerService } from '../services/LoggerService.js';

export interface ShutdownServices {
  client: Client;
  database: DatabaseService;
  cache: CacheService;
  sentry: SentryService;
  healthServer: FastifyInstance;
  logger: LoggerService;
}

// Global shutdown state
export let isShuttingDown = false;
export let activeCommandCount = 0;

export function incrementActiveCommands(): void {
  activeCommandCount++;
}

export function decrementActiveCommands(): void {
  if (activeCommandCount > 0) {
    activeCommandCount--;
  }
}

export function setupGracefulShutdown(services: ShutdownServices): void {
  const { client, database, cache, sentry, healthServer, logger } = services;
  const shutdownLogger = logger.child('Shutdown');

  const maxShutdownTime = 30000; // 30 seconds total
  const maxCommandWaitTime = 10000; // 10 seconds for commands to finish

  const shutdownHandler = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      shutdownLogger.warn('Shutdown already in progress, ignoring duplicate signal', { signal });
      return;
    }

    isShuttingDown = true;
    shutdownLogger.warn(`Shutdown initiated, signal: ${signal}`);

    const shutdownStartTime = Date.now();

    try {
      // Step 1: Wait for in-flight commands to finish (max 10 seconds)
      shutdownLogger.info('Waiting for in-flight commands to finish...');
      const commandWaitStart = Date.now();
      while (activeCommandCount > 0 && Date.now() - commandWaitStart < maxCommandWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (activeCommandCount > 0) {
        shutdownLogger.warn(`Forcefully shutting down with ${activeCommandCount} commands still in flight`);
      } else {
        shutdownLogger.info('All commands completed');
      }

      // Step 2: Destroy Discord client
      try {
        shutdownLogger.info('Destroying Discord client...');
        client.destroy();
        shutdownLogger.info('Discord client destroyed');
      } catch (error) {
        shutdownLogger.error('Failed to destroy Discord client', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 3: Disconnect from database
      try {
        shutdownLogger.info('Disconnecting from database...');
        await database.disconnect();
        shutdownLogger.info('Database disconnected');
      } catch (error) {
        shutdownLogger.error('Failed to disconnect from database', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 4: Disconnect from cache
      try {
        shutdownLogger.info('Disconnecting from cache...');
        await cache.disconnect();
        shutdownLogger.info('Cache disconnected');
      } catch (error) {
        shutdownLogger.error('Failed to disconnect from cache', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 5: Close health server
      try {
        shutdownLogger.info('Closing health server...');
        await healthServer.close();
        shutdownLogger.info('Health server closed');
      } catch (error) {
        shutdownLogger.error('Failed to close health server', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Step 6: Flush Sentry events
      try {
        shutdownLogger.info('Flushing Sentry events...');
        await sentry.flush();
        shutdownLogger.info('Sentry events flushed');
      } catch (error) {
        shutdownLogger.error('Failed to flush Sentry events', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const shutdownDuration = Date.now() - shutdownStartTime;
      shutdownLogger.info(`Shutdown complete in ${shutdownDuration}ms`);
      process.exit(0);
    } catch (error) {
      shutdownLogger.error('Unexpected error during shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  // Set up signal handlers
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGUSR2', () => shutdownHandler('SIGUSR2')); // For nodemon

  // Global timeout for entire shutdown process
  const globalTimeout = setTimeout(() => {
    if (isShuttingDown) {
      shutdownLogger.error('Shutdown timed out after 30 seconds, forcing exit');
      process.exit(1);
    }
  }, maxShutdownTime);

  // Clear timeout if shutdown completes normally (though we exit before this)
  const wrappedShutdownHandler = async (signal: string) => {
    clearTimeout(globalTimeout);
    await shutdownHandler(signal);
  };

  // Replace signal handlers with wrapped version
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGUSR2');
  
  process.on('SIGTERM', () => wrappedShutdownHandler('SIGTERM'));
  process.on('SIGINT', () => wrappedShutdownHandler('SIGINT'));
  process.on('SIGUSR2', () => wrappedShutdownHandler('SIGUSR2'));

  shutdownLogger.info('Graceful shutdown handlers registered');
}