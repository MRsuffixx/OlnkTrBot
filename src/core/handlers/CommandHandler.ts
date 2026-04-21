import { injectable, inject } from 'tsyringe';
import { REST, Routes } from 'discord.js';
import { glob } from 'glob';
import { ConfigService } from '../../config/ConfigService.js';
import { LoggerService } from '../../services/LoggerService.js';
import { ExtendedClient } from '../client/ExtendedClient.js';
import { Command } from '../../types/command.js';

@injectable()
export class CommandHandler {
  private readonly logger: ReturnType<LoggerService['child']>;

  constructor(
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
  ) {
    this.logger = this.loggerService.child('CommandHandler');
  }

  public async loadCommands(client: ExtendedClient): Promise<void> {
    this.logger.info('Loading commands...');

    try {
      // Find all command files in modules directory
      const commandFiles = await glob('src/modules/**/*.command.ts', {
        absolute: true,
        ignore: 'node_modules/**',
      });

      this.logger.debug(`Found ${commandFiles.length} command files`);

      let loadedCount = 0;
      let skippedCount = 0;

      for (const filePath of commandFiles) {
        try {
          // Import the command module
          const module = await import(filePath);
          const command = module.default as Command;

          // Validate the command
          if (!this.isValidCommand(command)) {
            this.logger.warn(`Invalid command in ${filePath} - skipping`);
            skippedCount++;
            continue;
          }

          // Add to client's command collection
          const commandName = command.data.name;
          client.commands.set(commandName, command);

          this.logger.debug(`Loaded command: ${commandName} (${command.category})`);
          loadedCount++;
        } catch (error) {
          this.logger.error(`Failed to load command from ${filePath}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          skippedCount++;
        }
      }

      this.logger.info(`Commands loaded: ${loadedCount} successful, ${skippedCount} skipped`);
    } catch (error) {
      this.logger.error('Failed to load commands', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public async deployCommands(client: ExtendedClient): Promise<void> {
    this.logger.info('Deploying commands to Discord...');

    try {
      const rest = new REST({ version: '10' }).setToken(this.configService.token);

      // Build command data array
      const commandData = client.commands.map((cmd) => cmd.data.toJSON());

      if (commandData.length === 0) {
        this.logger.warn('No commands to deploy');
        return;
      }

      const clientId = this.configService.clientId;
      const devGuildId = this.configService.devGuildId;
      const isDevelopment = this.configService.isDevelopment;

      if (isDevelopment && devGuildId) {
        // Deploy to dev guild for instant updates
        this.logger.info(`Deploying ${commandData.length} commands to dev guild ${devGuildId}`);

        await rest.put(
          Routes.applicationGuildCommands(clientId, devGuildId),
          { body: commandData },
        );

        this.logger.info(`Successfully deployed ${commandData.length} commands to dev guild`);
      } else {
        // Deploy globally (production)
        this.logger.info(`Deploying ${commandData.length} commands globally`);

        await rest.put(
          Routes.applicationCommands(clientId),
          { body: commandData },
        );

        this.logger.info(`Successfully deployed ${commandData.length} commands globally`);
        this.logger.warn('Global command deployment can take up to 1 hour to propagate');
      }
    } catch (error) {
      this.logger.error('Failed to deploy commands', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private isValidCommand(command: unknown): command is Command {
    if (typeof command !== 'object' || command === null) {
      return false;
    }

    const cmd = command as Record<string, unknown>;

    // Check required properties
    if (!cmd.data || !cmd.category || typeof cmd.guildOnly !== 'boolean' || typeof cmd.ownerOnly !== 'boolean' || typeof cmd.execute !== 'function') {
      return false;
    }

    // Check optional properties
    if (cmd.cooldown !== undefined && typeof cmd.cooldown !== 'number') {
      return false;
    }

    if (cmd.permissions !== undefined && !Array.isArray(cmd.permissions)) {
      return false;
    }

    if (cmd.botPermissions !== undefined && !Array.isArray(cmd.botPermissions)) {
      return false;
    }

    return true;
  }
}