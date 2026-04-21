import { z } from 'zod';

export const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().url('Valid PostgreSQL database URL is required'),
  REDIS_URL: z.string().url('Valid Redis URL is required'),
  SENTRY_DSN: z.string().url('Valid Sentry DSN URL').optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  HEALTH_PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  BOT_PREFIX: z.string().min(1).default('!'),
  MAINTENANCE_MODE: z.coerce.boolean().default(false),
  SHARDING_ENABLED: z.coerce.boolean().default(false),
  BOT_OWNER_IDS: z
    .string()
    .default('')
    .transform((s: string) => s.split(',').map((id: string) => id.trim()).filter(Boolean)),
});

export type AppConfig = z.infer<typeof configSchema>;