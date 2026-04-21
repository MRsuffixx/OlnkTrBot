import {
  Client,
  type ClientOptions,
  Collection,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type SelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { type ConfigService } from '../../config/ConfigService.js';
import { type LoggerService } from '../../services/LoggerService.js';
import { type HealthService } from '../../services/HealthService.js';
import { type Command } from '../../types/command.js';
import { type Component } from '../../types/component.js';

export class ExtendedClient extends Client {
  public readonly commands = new Collection<string, Command>();
  public readonly customComponents = new Collection<string | RegExp, Component>();
  public readonly commandCooldowns = new Collection<string, number>(); // key: 'commandName:userId', value: timestamp

  private readonly childLogger: ReturnType<LoggerService['child']>;

  constructor(
    public readonly configService: ConfigService,
    public readonly loggerService: LoggerService,
    public readonly healthService: HealthService,
  ) {
    const intents: GatewayIntentBits[] = [
      GatewayIntentBits.Guilds, // Required for guild structure and channel access
      GatewayIntentBits.GuildMembers, // Privileged - required for onboarding flow and antiraid join detection
      GatewayIntentBits.GuildMessages, // Required for message spam detection in antiraid
      GatewayIntentBits.GuildMessageReactions, // Required for future reaction-based features
      GatewayIntentBits.GuildVoiceStates, // Reserved for future voice/music module
      GatewayIntentBits.MessageContent, // Privileged - required for command suggestion fallback and webhook content processing
      GatewayIntentBits.DirectMessages, // Required for sending blacklist notifications and maintenance DMs
    ];

    const options: ClientOptions = {
      intents,
      allowedMentions: {
        parse: ['users', 'roles'],
        repliedUser: true,
      },
      presence: {
        status: 'online',
        activities: [
          {
            name: 'Starting up...',
            type: 0, // Playing
          },
        ],
      },
    };

    super(options);

    this.childLogger = this.loggerService.child('ExtendedClient');
  }

  public async start(): Promise<void> {
    this.childLogger.info('Starting Discord client initialization');

    try {
      // Step 1: Load commands, events, and components
      // (These will be loaded by their respective handlers)
      this.childLogger.info('Client ready for handler loading');

      // Step 2: Login to Discord
      this.childLogger.info('Logging in to Discord...');
      await this.login(this.configService.token);

      // Step 3: Update health service when ready event fires
      // (This will be handled by the ready event handler)

      this.childLogger.info('Client start sequence completed');
    } catch (error) {
      this.childLogger.fatal('Failed to start Discord client', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  public async destroy(): Promise<void> {
    this.childLogger.info('Destroying Discord client connection');
    super.destroy();
  }

  public getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  public getComponent(customId: string): Component | undefined {
    // First try exact string match
    const exactMatch = this.customComponents.get(customId);
    if (exactMatch) {
      return exactMatch;
    }

    // Then try RegExp matches
    for (const [key, component] of this.customComponents) {
      if (key instanceof RegExp && key.test(customId)) {
        return component;
      }
    }

    return undefined;
  }

  public setCooldown(commandName: string, userId: string, durationMs: number): void {
    const key = `${commandName}:${userId}`;
    const expiresAt = Date.now() + durationMs;
    this.commandCooldowns.set(key, expiresAt);

    // Auto-cleanup after cooldown expires
    setTimeout(() => {
      this.commandCooldowns.delete(key);
    }, durationMs);
  }

  public getCooldownRemaining(commandName: string, userId: string): number {
    const key = `${commandName}:${userId}`;
    const expiresAt = this.commandCooldowns.get(key);
    if (!expiresAt) {
      return 0;
    }

    const remaining = expiresAt - Date.now();
    return Math.max(0, remaining);
  }

  public isOnCooldown(commandName: string, userId: string): boolean {
    return this.getCooldownRemaining(commandName, userId) > 0;
  }

  public getGuildCount(): number {
    return this.guilds.cache.size;
  }

  public async getTotalMemberCount(): Promise<number> {
    let total = 0;
    for (const guild of this.guilds.cache.values()) {
      try {
        // Fetch members to ensure we have accurate count
        await guild.members.fetch();
        total += guild.memberCount;
      } catch (error) {
        this.childLogger.warn(`Failed to fetch members for guild ${guild.id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // Use cached count as fallback
        total += guild.memberCount;
      }
    }
    return total;
  }
}