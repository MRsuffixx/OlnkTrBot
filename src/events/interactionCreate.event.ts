import {
  type Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  SelectMenuInteraction,
  ModalSubmitInteraction,
  EmbedBuilder,
} from 'discord.js';
import { type ExtendedClient } from '../core/client/ExtendedClient.js';
import { type Event } from '../types/event.js';
import { handleCommandError } from '../core/handlers/ErrorHandler.js';
import { isShuttingDown, incrementActiveCommands, decrementActiveCommands } from '../core/shutdown.js';
import { ContainerRegistry } from '../core/container.js';
import { type MaintenanceService } from '../services/MaintenanceService.js';
import { type SentryService } from '../services/SentryService.js';
import { type ComponentHandler } from '../core/handlers/ComponentHandler.js';
import { type Component } from '../types/component.js';

const event: Event<'interactionCreate'> = {
  name: 'interactionCreate',
  once: false,
  execute: async (interaction: Interaction, client: ExtendedClient) => {
    const logger = client.loggerService.child('InteractionCreate');

    try {
      // CHECK 1 — SHUTTING DOWN
      if (isShuttingDown) {
        if (interaction.isRepliable()) {
          const embed = new EmbedBuilder()
            .setColor(0xFFA500) // Orange
            .setTitle('Bot Shutting Down')
            .setDescription('The bot is currently shutting down. Please try again shortly.')
            .setTimestamp();

          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        return;
      }

      // CHECK 2 — BOT INTERACTIONS
      if (interaction.user.bot) {
        return; // Silently ignore bot interactions
      }

      // CHECK 3 — MAINTENANCE MODE
      const maintenanceService = ContainerRegistry.resolve<MaintenanceService>('MaintenanceService' as any);
      if (maintenanceService) {
        const isMaintenanceEnabled = await maintenanceService.isEnabled();
        const ownerIds = client.configService.ownerIds || [];
        const isOwner = ownerIds.includes(interaction.user.id);

        if (isMaintenanceEnabled && !isOwner) {
          const statusMessage = await maintenanceService.getStatusMessage();
          const embed = new EmbedBuilder()
            .setColor(0xFFA500) // Orange
            .setTitle('Maintenance Mode')
            .setDescription(statusMessage || 'The bot is currently undergoing maintenance. Please try again later.')
            .setTimestamp();

          if (interaction.isRepliable()) {
            await interaction.reply({ embeds: [embed], ephemeral: true });
          }
          return;
        }
      }

      // CHECK 4 — BLACKLIST CHECK (Phase 4 - skip for now)
      // BlacklistService will be implemented in Phase 4

      // Dispatch based on interaction type
      if (interaction.isChatInputCommand()) {
        await handleCommandInteraction(interaction, client, logger);
      } else if (interaction.isButton() || interaction.isSelectMenu() || interaction.isModalSubmit()) {
        await handleComponentInteraction(interaction as ButtonInteraction | SelectMenuInteraction | ModalSubmitInteraction, client, logger);
      } else {
        // Unknown interaction type
        logger.debug(`Unknown interaction type: ${interaction.type}`);
      }
    } catch (error) {
      logger.error('Unhandled error in interactionCreate', {
        error: error instanceof Error ? error.message : String(error),
        interactionId: interaction.id,
        userId: interaction.user.id,
      });
    }
  },
};

async function handleCommandInteraction(
  interaction: ChatInputCommandInteraction,
  client: ExtendedClient,
  logger: ReturnType<ExtendedClient['loggerService']['child']>,
): Promise<void> {
  const commandName = interaction.commandName;
  const command = client.getCommand(commandName);

  // CHECK 5 — COMMAND NOT FOUND
  if (!command) {
    const embed = new EmbedBuilder()
      .setColor(0xED4245) // Red
      .setTitle('Unknown Command')
      .setDescription(`The command \`/${commandName}\` was not found.`)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // CHECK 6 — GUILD ONLY CHECK
  if (command.guildOnly && !interaction.inGuild()) {
    const embed = new EmbedBuilder()
      .setColor(0xED4245) // Red
      .setTitle('Guild Only')
      .setDescription('This command can only be used in a server.')
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // CHECK 7 — OWNER ONLY CHECK
  if (command.ownerOnly) {
    const ownerIds = client.configService.ownerIds || [];
    if (!ownerIds.includes(interaction.user.id)) {
      const embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Permission Denied')
        .setDescription('This command is only available to bot owners.')
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  }

  // CHECK 8 — USER PERMISSIONS CHECK
  if (command.permissions && command.permissions.length > 0 && interaction.inGuild()) {
    const memberPermissions = interaction.memberPermissions;
    if (!memberPermissions) {
      const embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Permission Error')
        .setDescription('Unable to check your permissions.')
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const missingPermissions = command.permissions.filter(
      (perm) => !memberPermissions.has(perm),
    );

    if (missingPermissions.length > 0) {
      const permissionNames = missingPermissions.map((p) => `\`${p}\``).join(', ');
      const embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Permission Denied')
        .setDescription(`You need the following permissions: ${permissionNames}`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  }

  // CHECK 9 — BOT PERMISSIONS CHECK
  if (command.botPermissions && command.botPermissions.length > 0 && interaction.inGuild()) {
    const botMember = await interaction.guild?.members.fetch(client.user!.id);
    if (!botMember) {
      const embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Bot Error')
        .setDescription('Unable to check bot permissions.')
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const missingBotPermissions = command.botPermissions.filter(
      (perm) => !botMember.permissions.has(perm),
    );

    if (missingBotPermissions.length > 0) {
      const permissionNames = missingBotPermissions.map((p) => `\`${p}\``).join(', ');
      const embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Bot Missing Permissions')
        .setDescription(`The bot needs the following permissions: ${permissionNames}`)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
  }

  // CHECK 10 — RATE LIMIT CHECK (Phase 4 - skip for now)
  // RateLimiterService will be implemented in Phase 4

  // CHECK 11 — COOLDOWN CHECK (Phase 4 - skip for now)
  // CooldownService will be implemented in Phase 4

  // EXECUTE — COMMAND EXECUTION
  incrementActiveCommands();
  const sentryService = ContainerRegistry.resolve<SentryService>('SentryService' as any);

  try {
    logger.info(`Executing command: ${commandName}`, {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });

    await command.execute(interaction, client);

    // TODO: Log to AuditService (Phase 4)
    // TODO: Set cooldown (Phase 4)

  } catch (error) {
    logger.error(`Command execution failed: ${commandName}`, {
      error: error instanceof Error ? error.message : String(error),
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });

    await handleCommandError(error, interaction, client, sentryService);
  } finally {
    decrementActiveCommands();
  }
}

async function handleComponentInteraction(
  interaction: ButtonInteraction | SelectMenuInteraction | ModalSubmitInteraction,
  client: ExtendedClient,
  logger: ReturnType<ExtendedClient['loggerService']['child']>,
): Promise<void> {
  const componentHandler = ContainerRegistry.resolve<ComponentHandler>('ComponentHandler' as any);
  if (!componentHandler) {
    logger.error('ComponentHandler not found');
    return;
  }

  const component = componentHandler.findComponent(client, interaction.customId);

  if (!component) {
    const embed = new EmbedBuilder()
      .setColor(0xED4245) // Red
      .setTitle('Expired Component')
      .setDescription('This component has expired or is no longer valid.')
      .setTimestamp();

    if (interaction.isRepliable()) {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    return;
  }

  incrementActiveCommands();
  const sentryService = ContainerRegistry.resolve<SentryService>('SentryService' as any);

  try {
    logger.info(`Executing component: ${interaction.customId}`, {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      componentType: component.type,
    });

    // Type-safe execution based on component type
    if (component.type === 'button' && interaction.isButton()) {
      await (component as Component<'button'>).execute(interaction as any, client);
    } else if (component.type === 'selectMenu' && interaction.isSelectMenu()) {
      await (component as Component<'selectMenu'>).execute(interaction as any, client);
    } else if (component.type === 'modal' && interaction.isModalSubmit()) {
      await (component as Component<'modal'>).execute(interaction as any, client);
    } else {
      logger.error(`Component type mismatch: ${component.type} vs interaction type`);
      const embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Component Error')
        .setDescription('This component type does not match the interaction.')
        .setTimestamp();

      if (interaction.isRepliable()) {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  } catch (error) {
    logger.error(`Component execution failed: ${interaction.customId}`, {
      error: error instanceof Error ? error.message : String(error),
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });

    await handleCommandError(error, interaction, client, sentryService);
  } finally {
    decrementActiveCommands();
  }
}

export default event;