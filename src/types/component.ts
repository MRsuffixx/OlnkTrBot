import type {
  ButtonInteraction,
  SelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

export enum ComponentType {
  BUTTON = 'button',
  SELECT_MENU = 'selectMenu',
  MODAL = 'modal',
}

export type ComponentExecute<T extends ComponentType> = T extends ComponentType.BUTTON
  ? (interaction: ButtonInteraction, client: any) => Promise<void>
  : T extends ComponentType.SELECT_MENU
  ? (interaction: SelectMenuInteraction, client: any) => Promise<void>
  : T extends ComponentType.MODAL
  ? (interaction: ModalSubmitInteraction, client: any) => Promise<void>
  : never;

export interface Component<T extends ComponentType = ComponentType> {
  customId: string | RegExp;
  type: T;
  execute: ComponentExecute<T>;
}