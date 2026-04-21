import type {
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import type { PermissionFlagsBits } from 'discord.js';

export enum CommandCategory {
  MODERATION = 'moderation',
  PROFILE = 'profile',
  ONBOARDING = 'onboarding',
  WEBHOOK = 'webhook',
  UTILITY = 'utility',
  OWNER = 'owner',
  OTHER = 'other',
}

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder;
  category: CommandCategory;
  cooldown?: number; // seconds
  permissions?: (keyof typeof PermissionFlagsBits)[];
  botPermissions?: (keyof typeof PermissionFlagsBits)[];
  guildOnly: boolean;
  ownerOnly: boolean;
  execute: (interaction: any, client: any) => Promise<void>;
}