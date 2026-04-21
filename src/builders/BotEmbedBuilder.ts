import { EmbedBuilder as DiscordEmbedBuilder, type EmbedData } from 'discord.js';
import { ConfigService } from '../config/ConfigService.js';

// TODO: Replace with real i18n service when implemented
const i18nStub = {
  t: (key: string, vars?: object): string => {
    // For now, return the key as the string
    // Phase 6 will replace this with real i18n
    return key;
  },
};

export class BotEmbedBuilder {
  private readonly embed: DiscordEmbedBuilder;
  private readonly configService: ConfigService;

  // Brand colors
  private static readonly SUCCESS_COLOR = 0x57F287; // #57F287
  private static readonly ERROR_COLOR = 0xED4245;   // #ED4245
  private static readonly WARNING_COLOR = 0xFEE75C; // #FEE75C
  private static readonly INFO_COLOR = 0x5865F2;    // #5865F2

  private constructor(configService: ConfigService) {
    this.configService = configService;
    this.embed = new DiscordEmbedBuilder();
  }

  // ========== FACTORY METHODS ==========

  public static success(
    titleKey: string,
    descKey: string,
    i18nVars?: object,
    configService?: ConfigService,
  ): BotEmbedBuilder {
    const builder = new BotEmbedBuilder(configService!);
    const title = i18nStub.t(titleKey, i18nVars);
    const description = i18nStub.t(descKey, i18nVars);
    
    builder.embed
      .setColor(BotEmbedBuilder.SUCCESS_COLOR)
      .setTitle(title)
      .setDescription(description);
    
    return builder.setDefaultFooter();
  }

  public static error(
    titleKey: string,
    descKey: string,
    i18nVars?: object,
    configService?: ConfigService,
  ): BotEmbedBuilder {
    const builder = new BotEmbedBuilder(configService!);
    const title = i18nStub.t(titleKey, i18nVars);
    const description = i18nStub.t(descKey, i18nVars);
    
    builder.embed
      .setColor(BotEmbedBuilder.ERROR_COLOR)
      .setTitle(title)
      .setDescription(description);
    
    return builder.setDefaultFooter();
  }

  public static warning(
    titleKey: string,
    descKey: string,
    i18nVars?: object,
    configService?: ConfigService,
  ): BotEmbedBuilder {
    const builder = new BotEmbedBuilder(configService!);
    const title = i18nStub.t(titleKey, i18nVars);
    const description = i18nStub.t(descKey, i18nVars);
    
    builder.embed
      .setColor(BotEmbedBuilder.WARNING_COLOR)
      .setTitle(title)
      .setDescription(description);
    
    return builder.setDefaultFooter();
  }

  public static info(
    titleKey: string,
    descKey: string,
    i18nVars?: object,
    configService?: ConfigService,
  ): BotEmbedBuilder {
    const builder = new BotEmbedBuilder(configService!);
    const title = i18nStub.t(titleKey, i18nVars);
    const description = i18nStub.t(descKey, i18nVars);
    
    builder.embed
      .setColor(BotEmbedBuilder.INFO_COLOR)
      .setTitle(title)
      .setDescription(description);
    
    return builder.setDefaultFooter();
  }

  public static neutral(
    titleKey: string,
    descKey: string,
    i18nVars?: object,
    configService?: ConfigService,
  ): BotEmbedBuilder {
    const builder = new BotEmbedBuilder(configService!);
    const title = i18nStub.t(titleKey, i18nVars);
    const description = i18nStub.t(descKey, i18nVars);
    
    // Parse brand color from config
    const brandColor = configService?.brandColor || '#5865F2';
    const color = parseInt(brandColor.replace('#', ''), 16);
    
    builder.embed
      .setColor(color)
      .setTitle(title)
      .setDescription(description);
    
    return builder.setDefaultFooter();
  }

  // ========== CHAINABLE METHODS ==========

  public addField(
    nameKey: string,
    valueKey: string,
    inline: boolean = false,
    i18nVars?: object,
  ): this {
    const name = i18nStub.t(nameKey, i18nVars);
    const value = i18nStub.t(valueKey, i18nVars);
    
    this.embed.addFields({ name, value, inline });
    return this;
  }

  public setAuthor(
    name: string,
    iconURL?: string,
  ): this {
    this.embed.setAuthor({ name, iconURL });
    return this;
  }

  public setThumbnail(url: string): this {
    this.embed.setThumbnail(url);
    return this;
  }

  public setImage(url: string): this {
    this.embed.setImage(url);
    return this;
  }

  public setRawDescription(text: string): this {
    this.embed.setDescription(text);
    return this;
  }

  // ========== PRIVATE HELPERS ==========

  private setDefaultFooter(): this {
    // TODO: Get bot name from config or client
    const botName = 'Bot';
    const timestamp = new Date().toISOString();
    
    this.embed
      .setFooter({ text: `${botName} • ${this.formatRelativeTime(timestamp)}` })
      .setTimestamp();
    
    return this;
  }

  private formatRelativeTime(timestamp: string): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) {
      return `${diffSec}s ago`;
    } else if (diffSec < 3600) {
      return `${Math.floor(diffSec / 60)}m ago`;
    } else if (diffSec < 86400) {
      return `${Math.floor(diffSec / 3600)}h ago`;
    } else {
      return `${Math.floor(diffSec / 86400)}d ago`;
    }
  }

  // ========== FINAL BUILD ==========

  public build(): DiscordEmbedBuilder {
    return this.embed;
  }
}
