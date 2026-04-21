import type { ClientEvents } from 'discord.js';
import type { ExtendedClient } from '../core/client/ExtendedClient.js';

export interface Event<EventName extends keyof ClientEvents = keyof ClientEvents> {
  name: EventName;
  once?: boolean;
  execute: (...args: [...ClientEvents[EventName], ExtendedClient]) => Promise<void>;
}
