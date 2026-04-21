import { injectable, inject } from 'tsyringe';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { ConfigService } from '../config/ConfigService.js';

export type ChildLogger = {
  trace: (message: string, context?: Record<string, unknown>) => void;
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
  fatal: (message: string, context?: Record<string, unknown>) => void;
};

@injectable()
export class LoggerService {
  private readonly logger: Logger;
  private readonly baseContext: Record<string, unknown>;

  constructor(@inject(ConfigService) private readonly configService: ConfigService) {
    const options: LoggerOptions = {
      level: configService.logLevel,
      timestamp: true,
      formatters: {
        level: (label) => ({ level: label }),
      },
    };

    if (configService.isDevelopment) {
      // Development: human-readable output with pino-pretty
      this.logger = pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      });
    } else {
      // Production: JSON output
      this.logger = pino(options);
    }

    this.baseContext = {
      service: 'core',
      env: configService.nodeEnv,
    };
  }

  private logWithContext(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: string,
    context: Record<string, unknown> = {},
  ): void {
    const mergedContext = { ...this.baseContext, ...context };
    this.logger[level](mergedContext, message);
  }

  public trace(message: string, context?: Record<string, unknown>): void {
    this.logWithContext('trace', message, context);
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.logWithContext('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.logWithContext('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.logWithContext('warn', message, context);
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.logWithContext('error', message, context);
  }

  public fatal(message: string, context?: Record<string, unknown>): void {
    this.logWithContext('fatal', message, context);
  }

  public child(serviceContext: string): ChildLogger {
    const childLogger = this.logger.child({ service: serviceContext });
    
    return {
      trace: (message: string, context?: Record<string, unknown>) => {
        childLogger.trace(context || {}, message);
      },
      debug: (message: string, context?: Record<string, unknown>) => {
        childLogger.debug(context || {}, message);
      },
      info: (message: string, context?: Record<string, unknown>) => {
        childLogger.info(context || {}, message);
      },
      warn: (message: string, context?: Record<string, unknown>) => {
        childLogger.warn(context || {}, message);
      },
      error: (message: string, context?: Record<string, unknown>) => {
        childLogger.error(context || {}, message);
      },
      fatal: (message: string, context?: Record<string, unknown>) => {
        childLogger.fatal(context || {}, message);
      },
    };
  }
}