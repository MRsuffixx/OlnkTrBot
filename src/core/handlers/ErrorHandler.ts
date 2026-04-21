import {
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type SelectMenuInteraction,
  type ModalSubmitInteraction,
  EmbedBuilder,
} from 'discord.js';
import { BotError, RateLimitError, CooldownError } from '../../errors/index.js';
import { type ExtendedClient } from '../client/ExtendedClient.js';
import { type SentryService } from '../../services/SentryService.js';

export async function handleCommandError(
  error: unknown,
  interaction: ChatInputCommandInteraction | ButtonInteraction | SelectMenuInteraction | ModalSubmitInteraction,
  client: ExtendedClient,
  sentryService: SentryService,
): Promise<void> {
  const logger = client.loggerService.child('ErrorHandler');

  try {
    // Check if interaction is already replied to
    const isReplied = interaction.replied || interaction.deferred;

    // Create error embed
    let embed: EmbedBuilder;
    let shouldLogToSentry = true;

    if (error instanceof BotError) {
      if (error.isOperational) {
        // Operational errors don't need Sentry
        shouldLogToSentry = false;
      }

      embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Error')
        .setDescription(error.userMessageKey) // TODO: This should be translated via i18n
        .setTimestamp();

      if (error instanceof RateLimitError) {
        embed.addFields({
          name: 'Retry After',
          value: `${error.retryAfter} seconds`,
        });
      } else if (error instanceof CooldownError) {
        embed.addFields({
          name: 'Remaining',
          value: `${error.remaining} seconds`,
        });
      }
    } else {
      // Unknown error
      const errorId = Math.random().toString(36).substring(2, 10).toUpperCase();
      embed = new EmbedBuilder()
        .setColor(0xED4245) // Red
        .setTitle('Internal Error')
        .setDescription('An unexpected error occurred. Please try again later.')
        .addFields({
          name: 'Error ID',
          value: errorId,
          inline: true,
        })
        .setTimestamp();

      // Log unknown error with ID
      logger.error(`Unknown error (ID: ${errorId})`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        interactionId: interaction.id,
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });
    }

    // Send error response
    if (isReplied) {
      if (interaction.deferred) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.followUp({ embeds: [embed], ephemeral: true });
      }
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // Log to Sentry if needed
    if (shouldLogToSentry) {
      sentryService.captureException(error, {
        interactionId: interaction.id,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: interaction.isCommand() ? interaction.commandName : 'component',
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
      });
    }
  } catch (responseError) {
    // Failed to send error response
    logger.error('Failed to send error response', {
      error: responseError instanceof Error ? responseError.message : String(responseError),
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}