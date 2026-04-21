import { injectable, inject } from 'tsyringe';
import { PrismaClient, type Prisma } from '@prisma/client';
import { ConfigService } from '../config/ConfigService.js';
import { LoggerService } from './LoggerService.js';
import { ExternalServiceError } from '../errors/index.js';

@injectable()
export class DatabaseService {
  private readonly prismaClient: PrismaClient;
  private readonly logger: ReturnType<LoggerService['child']>;
  private isConnected = false;

  constructor(
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('DatabaseService');

    // Configure Prisma client
    const logLevel: Prisma.LogLevel[] = this.configService.isDevelopment
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'];

    this.prismaClient = new PrismaClient({
      log: logLevel,
      errorFormat: this.configService.isDevelopment ? 'pretty' : 'minimal',
    });
  }

  public async connect(): Promise<void> {
    const maxRetries = 5;
    const initialDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`Connecting to database (attempt ${attempt}/${maxRetries})`);
        await this.prismaClient.$connect();
        this.isConnected = true;
        this.logger.info('Database connection established');
        return;
      } catch (error) {
        this.logger.error(`Database connection attempt ${attempt} failed`, {
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt === maxRetries) {
          this.logger.fatal('All database connection attempts failed');
          throw new ExternalServiceError('Failed to connect to database', {
            maxRetries,
            lastError: error instanceof Error ? error.message : String(error),
          });
        }

        // Exponential backoff with jitter
        const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
        const jitter = Math.random() * 0.2 * delay; // ±20% jitter
        const waitTime = delay + jitter;

        this.logger.warn(`Retrying database connection in ${Math.round(waitTime)}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected) {
      try {
        await this.prismaClient.$disconnect();
        this.isConnected = false;
        this.logger.info('Database connection closed');
      } catch (error) {
        this.logger.error('Error while disconnecting from database', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't throw during disconnect to allow graceful shutdown
      }
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      // Run a lightweight query to verify connectivity
      await this.prismaClient.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  public get client(): PrismaClient {
    if (!this.isConnected) {
      throw new ExternalServiceError('Database not connected', {
        service: 'database',
      });
    }
    return this.prismaClient;
  }
}