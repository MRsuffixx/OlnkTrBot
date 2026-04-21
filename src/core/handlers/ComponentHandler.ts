import { injectable, inject } from 'tsyringe';
import { glob } from 'glob';
import { LoggerService } from '../../services/LoggerService.js';
import { ExtendedClient } from '../client/ExtendedClient.js';
import { Component, ComponentType } from '../../types/component.js';

@injectable()
export class ComponentHandler {
  private readonly logger: ReturnType<LoggerService['child']>;

  constructor(
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('ComponentHandler');
  }

  public async loadComponents(client: ExtendedClient): Promise<void> {
    this.logger.info('Loading components...');

    try {
      // Find all component files in modules directory
      const componentFiles = await glob('src/modules/**/*.component.ts', {
        absolute: true,
        ignore: 'node_modules/**',
      });

      this.logger.debug(`Found ${componentFiles.length} component files`);

      let loadedCount = 0;
      let skippedCount = 0;

      for (const filePath of componentFiles) {
        try {
          // Import the component module
          const module = await import(filePath);
          const component = module.default as Component;

          // Validate the component
          if (!this.isValidComponent(component)) {
            this.logger.warn(`Invalid component in ${filePath} - skipping`);
            skippedCount++;
            continue;
          }

          // Add to client's component collection
          client.customComponents.set(component.customId, component);

          this.logger.debug(`Loaded component: ${component.customId} (${component.type})`);
          loadedCount++;
        } catch (error) {
          this.logger.error(`Failed to load component from ${filePath}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          skippedCount++;
        }
      }

      this.logger.info(`Components loaded: ${loadedCount} successful, ${skippedCount} skipped`);
    } catch (error) {
      this.logger.error('Failed to load components', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public findComponent(client: ExtendedClient, customId: string): Component | undefined {
    // First try exact string match
    const exactMatch = client.customComponents.get(customId);
    if (exactMatch) {
      return exactMatch;
    }

    // Then try RegExp matches
    for (const [key, component] of client.customComponents) {
      if (key instanceof RegExp && key.test(customId)) {
        return component;
      }
    }

    return undefined;
  }

  private isValidComponent(component: unknown): component is Component {
    if (typeof component !== 'object' || component === null) {
      return false;
    }

    const comp = component as Record<string, unknown>;

    // Check required properties
    if (!comp.customId || (typeof comp.customId !== 'string' && !(comp.customId instanceof RegExp))) {
      return false;
    }

    if (!comp.type || !Object.values(ComponentType).includes(comp.type as ComponentType)) {
      return false;
    }

    if (typeof comp.execute !== 'function') {
      return false;
    }

    return true;
  }
}