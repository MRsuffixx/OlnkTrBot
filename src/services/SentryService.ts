import { injectable, inject } from 'tsyringe';
import * as Sentry from '@sentry/node';
import { ConfigService } from '../config/ConfigService.js';
import { LoggerService } from './LoggerService.js';
import { ConfigurationError } from '../errors/index.js';

export type SentrySeverityLevel = Sentry.SeverityLevel;

@injectable()
export class SentryService {
  private isEnabled: boolean = false;
  private readonly logger: ReturnType<LoggerService['child']>;

  constructor(
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('SentryService');
  }

  public async initialize(): Promise<void> {
    const sentryDsn = this.configService.sentryDsn;
    const nodeEnv = this.configService.nodeEnv;

    if (!sentryDsn) {
      if (nodeEnv === 'production') {
        throw new ConfigurationError(
          'SENTRY_DSN is required in production environment for error tracking',
          { environment: nodeEnv },
        );
      }

      this.logger.warn('Sentry is disabled (no SENTRY_DSN configured)');
      this.isEnabled = false;
      return;
    }

    try {
      // Get package.json version for release tracking
      const packageJson = await import('../../package.json', {
        assert: { type: 'json' },
      });

      const release = `discord-bot@${packageJson.default.version}`;

      Sentry.init({
        dsn: sentryDsn,
        environment: nodeEnv,
        tracesSampleRate: nodeEnv === 'production' ? 0.1 : 1.0,
        release,
        beforeSend(event) {
          // Filter out common operational errors that don't need alerting
          if (event.exception?.values?.[0]?.type?.includes('BotError')) {
            const isOperational = event.exception.values[0].value?.includes('isOperational: true');
            if (isOperational) {
              return null; // Drop operational errors
            }
          }
          return event;
        },
      });

      this.isEnabled = true;
      this.logger.info('Sentry initialized', {
        environment: nodeEnv,
        release,
      });
    } catch (error) {
      this.logger.error('Failed to initialize Sentry', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.isEnabled = false;
    }
  }

  public captureException(error: unknown, context: Record<string, unknown> = {}): void {
    if (!this.isEnabled) {
      this.logger.error('Exception (Sentry disabled)', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...context,
      });
      return;
    }

    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });

      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureException(new Error(String(error)));
      }
    });
  }

  public captureMessage(
    message: string,
    level: SentrySeverityLevel = 'info',
    context: Record<string, unknown> = {},
  ): void {
    if (!this.isEnabled) {
      this.logger[level === 'fatal' ? 'fatal' : level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info'](
        `Sentry message (Sentry disabled): ${message}`,
        context,
      );
      return;
    }

    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });

      Sentry.captureMessage(message, level);
    });
  }

  public async flush(): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    try {
      await Sentry.flush(2000); // Wait up to 2 seconds for events to be sent
      this.logger.debug('Sentry events flushed');
    } catch (error) {
      this.logger.warn('Failed to flush Sentry events', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public get enabled(): boolean {
    return this.isEnabled;
  }
}