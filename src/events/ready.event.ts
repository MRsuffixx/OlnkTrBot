import { type ExtendedClient } from '../core/client/ExtendedClient.js';
import { type Event } from '../types/event.js';

const event: Event<'ready'> = {
  name: 'ready',
  once: true,
  execute: async (discordClient, extendedClient) => {
    const client = extendedClient as ExtendedClient;
    const logger = client.loggerService.child('ReadyEvent');

    logger.info(`Bot is online as ${discordClient.user?.tag} (${discordClient.user?.id})`);
    logger.info(`Serving ${discordClient.guilds.cache.size} guilds`);

    // Update health service
    client.healthService.setDiscordReady(true);
    client.healthService.setGuildCount(discordClient.guilds.cache.size);

    // Update presence
    discordClient.user?.setPresence({
      status: 'online',
      activities: [
        {
          name: `${discordClient.guilds.cache.size} servers`,
          type: 3, // Watching
        },
      ],
    });

    logger.info('Bot is ready and operational');
  },
};

export default event;