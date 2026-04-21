import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type ConfigService } from '../config/ConfigService.js';
import { type LoggerService } from '../services/LoggerService.js';
import { type HealthService } from '../services/HealthService.js';

export async function createHealthServer(
  healthService: HealthService,
  configService: ConfigService,
  loggerService: LoggerService,
): Promise<FastifyInstance> {
  const logger = loggerService.child('HealthServer');
  const server = fastify({
    logger: false, // We use our own logger
    disableRequestLogging: true,
  });

  // Health endpoint
  server.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const health = await healthService.checkHealth();
      
      if (health.status === 'unhealthy') {
        reply.code(503);
      } else {
        reply.code(200);
      }
      
      return health;
    } catch (error) {
      logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      reply.code(503);
      return {
        status: 'unhealthy' as const,
        uptime: 0,
        timestamp: new Date().toISOString(),
        services: {
          database: false,
          cache: 'disconnected' as const,
          discord: false,
        },
        error: 'Health check failed',
      };
    }
  });

  // Readiness endpoint
  server.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ready = await healthService.checkReadiness();
      
      if (!ready) {
        reply.code(503);
        return {
          ready: false,
          reason: 'Discord client not connected or database unavailable',
        };
      }
      
      reply.code(200);
      return { ready: true };
    } catch (error) {
      logger.error('Readiness check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      reply.code(503);
      return {
        ready: false,
        reason: 'Readiness check failed',
      };
    }
  });

  // Metrics endpoint
  server.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = await healthService.getMetrics();
      reply.code(200);
      return metrics;
    } catch (error) {
      logger.error('Metrics retrieval failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      reply.code(503);
      return {
        error: 'Metrics retrieval failed',
      };
    }
  });

  // Root endpoint (simple info)
  server.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.code(200);
    return {
      service: 'Discord Bot Health Server',
      version: '1.0.0',
      endpoints: ['/health', '/ready', '/metrics'],
    };
  });

  // Start the server
  const port = configService.healthPort;
  const host = '0.0.0.0';

  try {
    await server.listen({ port, host });
    logger.info(`Health server listening on http://${host}:${port}`);
  } catch (error) {
    logger.error('Failed to start health server', {
      error: error instanceof Error ? error.message : String(error),
      port,
    });
    throw error;
  }

  return server;
}