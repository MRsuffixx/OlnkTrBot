import { injectable } from 'tsyringe';
import { config } from 'dotenv';
import { configSchema, type AppConfig } from './schema.js';
import { ConfigurationError } from '../errors/index.js';

@injectable()
export class ConfigService {
  private readonly config: AppConfig;

  constructor() {
    // Load environment variables from .env file
    config();

    // Validate the configuration
    const result = configSchema.safeParse(process.env);

    if (!result.success) {
      const errors = result.error.errors.map((error) => {
        const path = error.path.join('.');
        return `${path}: ${error.message}`;
      });

      console.error('Configuration validation failed:');
      console.error(errors.join('\n'));
      throw new ConfigurationError('Configuration validation failed', {
        validationErrors: errors,
      });
    }

    this.config = result.data;
  }

  // Getters for each config value
  get token(): string {
    return this.config.DISCORD_TOKEN;
  }

  get clientId(): string {
    return this.config.DISCORD_CLIENT_ID;
  }

  get devGuildId(): string | undefined {
    return this.config.DISCORD_DEV_GUILD_ID;
  }

  get databaseUrl(): string {
    return this.config.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.config.REDIS_URL;
  }

  get sentryDsn(): string | undefined {
    return this.config.SENTRY_DSN;
  }

  get nodeEnv(): string {
    return this.config.NODE_ENV;
  }

  get logLevel(): string {
    return this.config.LOG_LEVEL;
  }

  get healthPort(): number {
    return this.config.HEALTH_PORT;
  }

  get botPrefix(): string {
    return this.config.BOT_PREFIX;
  }

  get maintenanceMode(): boolean {
    return this.config.MAINTENANCE_MODE;
  }

  get shardingEnabled(): boolean {
    return this.config.SHARDING_ENABLED;
  }

  get ownerIds(): string[] {
    return this.config.BOT_OWNER_IDS;
  }

  // Rate limiting getters
  get rateLimitUserMax(): number {
    return this.config.RL_USER_MAX;
  }

  get rateLimitUserWindowSeconds(): number {
    return this.config.RL_USER_WINDOW_SECONDS;
  }

  get rateLimitGuildMax(): number {
    return this.config.RL_GUILD_MAX;
  }

  get rateLimitGuildWindowSeconds(): number {
    return this.config.RL_GUILD_WINDOW_SECONDS;
  }

  get rateLimitGlobalMax(): number {
    return this.config.RL_GLOBAL_MAX;
  }

  get rateLimitGlobalWindowSeconds(): number {
    return this.config.RL_GLOBAL_WINDOW_SECONDS;
  }

  // Anti-raid getters
  get antiraidJoinThreshold(): number {
    return this.config.ANTIRAID_JOIN_THRESHOLD;
  }

  get antiraidJoinWindowSeconds(): number {
    return this.config.ANTIRAID_JOIN_WINDOW_SECONDS;
  }

  get antiraidMessageThreshold(): number {
    return this.config.ANTIRAID_MSG_THRESHOLD;
  }

  get antiraidMessageWindowSeconds(): number {
    return this.config.ANTIRAID_MSG_WINDOW_SECONDS;
  }

  // Brand color getter
  get brandColor(): string {
    return this.config.BRAND_COLOR;
  }

  // Convenience boolean getters
  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }
}