import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node20',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  external: [
    'node:*',
    '@prisma/client',
    'discord.js',
    'ioredis',
    'pino',
    'pino-pretty',
    'fastify',
    'i18next',
    'i18next-fs-backend',
    '@sentry/node',
    'node-cron',
    'tsyringe',
    'reflect-metadata',
    'zod',
    'dotenv'
  ],
  esbuildOptions(options) {
    options.drop = ['console', 'debugger'];
  },
});