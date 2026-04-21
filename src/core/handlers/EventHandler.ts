import { injectable, inject } from 'tsyringe';
import { glob } from 'glob';
import { LoggerService } from '../../services/LoggerService.js';
import { ExtendedClient } from '../client/ExtendedClient.js';
import { Event } from '../../types/event.js';

@injectable()
export class EventHandler {
  private readonly logger: ReturnType<LoggerService['child']>;

  constructor(
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('EventHandler');
  }

  public async loadEvents(client: ExtendedClient): Promise<void> {
    this.logger.info('Loading events...');

    try {
      // Find all event files in events directory and modules
      const eventFiles = await glob(
        ['src/events/**/*.event.ts', 'src/modules/**/*.event.ts'],
        {
          absolute: true,
          ignore: 'node_modules/**',
        },
      );

      this.logger.debug(`Found ${eventFiles.length} event files`);

      let loadedCount = 0;
      let skippedCount = 0;

      for (const filePath of eventFiles) {
        try {
          // Import the event module
          const module = await import(filePath);
          const event = module.default as Event;

          // Validate the event
          if (!this.isValidEvent(event)) {
            this.logger.warn(`Invalid event in ${filePath} - skipping`);
            skippedCount++;
            continue;
          }

          // Register the event with the client
          if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
          } else {
            client.on(event.name, (...args) => event.execute(...args, client));
          }

          this.logger.debug(`Loaded event: ${event.name} (${event.once ? 'once' : 'on'})`);
          loadedCount++;
        } catch (error) {
          this.logger.error(`Failed to load event from ${filePath}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          skippedCount++;
        }
      }

      this.logger.info(`Events loaded: ${loadedCount} successful, ${skippedCount} skipped`);
    } catch (error) {
      this.logger.error('Failed to load events', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private isValidEvent(event: unknown): event is Event {
    if (typeof event !== 'object' || event === null) {
      return false;
    }

    const evt = event as Record<string, unknown>;

    // Check required properties
    if (!evt.name || typeof evt.name !== 'string') {
      return false;
    }

    if (typeof evt.once !== 'boolean') {
      return false;
    }

    if (typeof evt.execute !== 'function') {
      return false;
    }

    return true;
  }
}