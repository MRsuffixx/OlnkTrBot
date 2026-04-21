import type { Collection } from 'discord.js';
import type { Command } from './command';
import type { Component } from './component';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, Command>;
    cooldowns: Collection<string, Collection<string, number>>;
    components: Collection<string | RegExp, Component>;
  }
}